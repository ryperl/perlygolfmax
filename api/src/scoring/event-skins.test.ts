import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { publicFixture } from '../public-access/test-support.js';
import { TableEventStore } from '../events/store.js';
import { TableTesterAccessStore } from '../test-access/store.js';
import { TablePurseStore } from '../purse/store.js';
import { createScoringHandler } from './handlers.js';
import { ApiError } from '../errors.js';
import { isEventLeaderboardView } from '../../../src/contracts/event-leaderboard.js';
import { isEventSkinsChange } from '../../../src/contracts/event-skins.js';
import { isEventPurseView } from '../../../src/contracts/purse-settings.js';

describe('event-wide skins persisted authority and read consistency', () => {
  it('fails closed on malformed stored settings and refuses stale conditional/header races without an audit or changed configuration', async () => {
    const f = await scoringFixture(1);
    const header = f.rows.get(`${event.id}|workspace`);
    if (!header || typeof header.content !== 'string') throw new Error('Missing fictional header.');
    const saved: unknown = JSON.parse(header.content);
    if (typeof saved !== 'object' || saved === null) throw new Error('Invalid fictional header.');
    for (const eventSkins of [null, { version: 2 }, { version: '1' }, { version: 1, allowance: 95 }]) {
      f.seed({ ...header, content: JSON.stringify({ ...saved, eventSkins }) });
      await expect(f.scores.leaderboard(creator, event.id, vi.fn())).rejects.toMatchObject({ status: 503 });
    }
    f.seed(header);
    f.submit.mockImplementationOnce(async (actions) => {
      f.seed({ ...header, location: 'Fictional concurrent header revision' });
      f.apply(actions);
      return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
    });
    await expect(f.scores.saveEventSkins(creator, event.id, { version: 1 }, f.saved.etag, identifier(8790)))
      .rejects.toMatchObject({ status: 409 });
    expect((await f.workspace.get(creator, event.id)).eventSkins).toBeUndefined();
    expect([...f.rows.values()].filter((row) => row.kind === 'event-skins-change')).toHaveLength(0);
    await f.scores.saveEventSkins(creator, event.id, { version: 1 }, f.saved.etag, identifier(8791));
    await expect(f.scores.saveEventSkins(creator, event.id, null, f.saved.etag, identifier(8792)))
      .rejects.toMatchObject({ status: 409 });
  });
  it('conditionally enables without games/primary competition, audits/replays exact owner intent and preserves legacy setup writes', async () => {
    const f = await scoringFixture(2);
    const change = await f.scores.saveEventSkins(creator, event.id, { version: 1 }, f.saved.etag, identifier(8000));
    expect(isEventSkinsChange(change)).toBe(true);
    expect(change).toMatchObject({ before: null, after: { version: 1 }, expectedEtag: f.saved.etag, recordedBy: creator });
    expect(await f.scores.saveEventSkins(creator, event.id, { version: 1 }, f.saved.etag, change.id)).toEqual(change);
    await expect(f.scores.saveEventSkins(creator, event.id, null, f.saved.etag, change.id)).rejects.toMatchObject({ status: 409 });
    const enabled = await f.workspace.get(creator, event.id);
    expect(enabled).toMatchObject({ eventSkinsSupported: true, eventSkins: { version: 1 } });
    expect(enabled.overallCompetition).toBeUndefined();
    expect((await f.scores.get(creator, event.id, f.roundId)).games?.configuration.games ?? []).toEqual([]);
    await f.workspace.save(creator, event.id, { ...f.input, name: 'Fictional preserved settings' }, enabled.etag);
    const charge = vi.fn().mockResolvedValue(undefined);
    const result = await f.scores.leaderboard(creator, event.id, charge);
    expect(isEventLeaderboardView(result)).toBe(true);
    expect(result.standings.status).toBe('disabled');
    expect(result.eventSkins?.status).toBe('provisional');
    expect(charge).toHaveBeenCalledTimes(1);
    expect([...f.rows.values()].filter((row) => row.kind === 'event-skins-change')).toHaveLength(1);
  });
  it('permits an event owner without global catalog rights, denies nonowners and checks owner grant races atomically', async () => {
    const f = await scoringFixture(2);
    await expect(f.scores.saveEventSkins(member, event.id, { version: 1 }, f.saved.etag, identifier(8100)))
      .rejects.toMatchObject({ status: 404 });
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'member' });
    await expect(f.scores.saveEventSkins(member, event.id, { version: 1 }, f.saved.etag, identifier(8100)))
      .rejects.toMatchObject({ status: 403 });
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'owner' });
    await f.scores.saveEventSkins(member, event.id, { version: 1 }, f.saved.etag, identifier(8100));
    const enabled = await f.workspace.get(member, event.id);
    expect(enabled.eventSkins).toEqual({ version: 1 });
    f.submit.mockImplementationOnce(async (actions) => {
      f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'member' });
      f.apply(actions);
      return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
    });
    await expect(f.scores.saveEventSkins(member, event.id, null, enabled.etag, identifier(8101))).rejects.toMatchObject({ status: 403 });
    expect((await f.workspace.get(creator, event.id)).eventSkins).toEqual({ version: 1 });
  });
  it('uses the captured net inputs after first save, public saved dispositions, and a distinct projected pot with no live budget reallocation', async () => {
    const f = await publicFixture();
    for (const [index, playerId] of f.input.playerIds.entries()) {
      const profile = await f.players.get(creator, playerId);
      await f.players.observe(creator, playerId, identifier(8200 + index),
        { value: index === 1 ? '17' : '0', effectiveDate: '2026-01-01', source: 'Fictional current index' }, profile.etag);
    }
    const before = await f.workspace.get(creator, event.id);
    await f.scores.saveEventSkins(creator, event.id, { version: 1 }, before.etag, identifier(8210));
    for (const [index, playerId] of f.input.playerIds.entries()) {
      await f.scores.write(f.actor, event.id, f.roundId, playerId, 1, index < 2
        ? { kind: 'strokes', strokes: index === 0 ? 3 : 4 } : { kind: 'picked-up', reportedStrokes: 7 }, null, identifier(8220 + index));
    }
    const profile = await f.players.get(creator, f.playerId);
    await f.players.observe(creator, f.playerId, identifier(8230),
      { value: '54', effectiveDate: '2026-01-02', source: 'Fictional later index' }, profile.etag);
    const charge = vi.fn().mockResolvedValue(undefined);
    const owner = await f.scores.leaderboard(creator, event.id, charge);
    const publicView = await f.scores.leaderboard(f.actor, event.id, charge);
    expect(isEventLeaderboardView(owner)).toBe(true);
    expect(isEventLeaderboardView(publicView)).toBe(true);
    expect(publicView.eventSkins).toEqual(owner.eventSkins);
    expect(publicView.eventSkins?.holes[0]).toMatchObject({ winnerId: f.playerId, netStrokes: 3, grossUnderParPriority: true });
    expect(JSON.stringify(publicView)).not.toContain('recordedBy');
    expect(JSON.stringify(publicView)).not.toContain(creator.objectId);
    const plan = { eventId: event.id, currency: 'USD' as const, funding: { kind: 'fixed' as const, budgetMinor: 10001 },
      pools: [{ id: identifier(8240), name: 'Fictional explicit skins', source: { kind: 'event-skins' as const, version: 1 as const },
        awardUnit: 'pot' as const, amountMinor: 10001 }] };
    const saved = await f.purse.save(creator, event.id, plan, [], null, identifier(8241), async () => Promise.resolve());
    expect(saved.current.view?.calculation).toMatchObject({ status: 'projected', projectedMinor: 10001, allocatedMinor: 0 });
    expect(saved.current.view?.calculation.pools[0]?.eventSkins).toMatchObject({
      awardedSkins: 1, pendingHoles: 17, unavailableHoles: 0, totalHoles: 18, perSkinMinor: 10001,
    });
    const winnings = await f.purse.get(f.actor, event.id, charge);
    expect(isEventPurseView(winnings)).toBe(true);
    expect(winnings.configuration.plan).toEqual(plan);
    expect(winnings.view?.calculation.players.find((player) => player.playerId === f.playerId)?.projectedMinor).toBe(10001);
    const now = await f.workspace.get(creator, event.id);
    await f.scores.saveEventSkins(creator, event.id, null, now.etag, identifier(8242));
    const disabled = await f.purse.get(f.actor, event.id, charge);
    expect(disabled.configuration.plan).toEqual(plan);
    expect(disabled.view?.calculation.status).toBe('unavailable');
    expect(disabled.view?.calculation.players[0]?.totalMinor).toBeNull();
    expect(disabled.view?.calculation.pools[0]?.eventSkins).toBeUndefined();
  });
  it.each([1, 6, 8])('charges every one of %i rounds, bounds parallelism and refuses partial quota/version success', async (count) => {
    const f = await scoringFixture(1);
    const first = f.input.rounds[0];
    if (!first) throw new Error('Missing fictional round.');
    const setup = await f.workspace.save(creator, event.id, { ...f.input,
      rounds: Array.from({ length: count }, (_, index) => ({ ...first, id: index === 0 ? first.id : identifier(8300 + index) })),
    }, f.saved.etag);
    await f.scores.saveEventSkins(creator, event.id, { version: 1 }, setup.etag, identifier(8310));
    let active = 0; let max = 0;
    const read = f.scores.get.bind(f.scores);
    const get = vi.spyOn(f.scores, 'get').mockImplementation(async (...args) => {
      active++; max = Math.max(max, active);
      try { return await read(...args); } finally { active--; }
    });
    const charge = vi.fn().mockResolvedValue(undefined);
    const value = await f.scores.leaderboard(creator, event.id, charge);
    expect(isEventLeaderboardView(value)).toBe(true);
    expect(value.eventSkins?.totalHoles).toBe(count * 18);
    expect(charge).toHaveBeenCalledExactlyOnceWith(count);
    expect(max).toBeLessThanOrEqual(3);
    get.mockClear();
    await expect(f.scores.leaderboard(creator, event.id, async () => Promise.reject(new ApiError(429, 'REQUEST_LIMIT_EXCEEDED'))))
      .rejects.toMatchObject({ status: 429 });
    expect(get).not.toHaveBeenCalled();
    get.mockImplementationOnce(async (...args) => {
      const result = await read(...args);
      const row = f.rows.get(`${event.id}|event`);
      if (!row) throw new Error('Missing fictional event.');
      f.seed({ ...row, name: 'Fictional concurrent change' });
      return result;
    });
    await expect(f.scores.leaderboard(creator, event.id, charge)).rejects.toMatchObject({ status: 409 });
  });
  it('denies tester event-wide results/purse/config discovery and denies public archived reads while retaining owner readonly results', async () => {
    const f = await publicFixture();
    const workspace = await f.workspace.get(creator, event.id);
    await f.scores.saveEventSkins(creator, event.id, { version: 1 }, workspace.etag, identifier(8400));
    const links = new TableTesterAccessStore(f.table);
    const existing = await links.list(creator, event.id);
    const secret = Buffer.alloc(32, 29).toString('base64url');
    const linkId = identifier(8401);
    await links.create(creator, event.id, { linkId, tokenHash: createHash('sha256').update(secret).digest('hex') }, existing.etag, identifier(8402));
    const actor = await links.verify(event.id, `Tester ${linkId}.${secret}`);
    const tester = await f.workspace.get(actor, event.id);
    expect(tester.eventSkins).toBeUndefined();
    expect(tester.eventSkinsSupported).toBeUndefined();
    await expect(f.scores.leaderboard(actor, event.id, vi.fn())).rejects.toMatchObject({ status: 403 });
    const current = await f.workspace.get(creator, event.id);
    await new TableEventStore(f.table).setStatus(creator, event.id, 'archived', current.etag);
    await expect(f.scores.leaderboard(f.actor, event.id, vi.fn())).rejects.toMatchObject({ status: 404 });
    const archived = await f.scores.leaderboard(creator, event.id, vi.fn());
    expect(isEventLeaderboardView(archived)).toBe(true);
    expect(archived.workspace.event.status).toBe('archived');
    await expect(f.scores.saveEventSkins(creator, event.id, null, archived.workspace.etag, identifier(8403)))
      .rejects.toMatchObject({ status: 409, code: 'EVENT_ARCHIVED' });
  });
  it('shows overcommitted purse budgets honestly without scaling and refuses duplicate event sources', async () => {
    const f = await scoringFixture(1);
    await f.scores.saveEventSkins(creator, event.id, { version: 1 }, f.saved.etag, identifier(8500));
    const purse = new TablePurseStore(f.table, f.workspace, f.scores);
    const pool = { id: identifier(8501), name: 'Fictional skins', source: { kind: 'event-skins' as const, version: 1 as const },
      awardUnit: 'pot' as const, amountMinor: 100 };
    const plan = { eventId: event.id, currency: 'USD' as const, funding: { kind: 'fixed' as const, budgetMinor: 99 }, pools: [pool] };
    const saved = await purse.save(creator, event.id, plan, [], null, identifier(8502), vi.fn());
    expect(saved.current.configuration.plan?.funding).toEqual({ kind: 'fixed', budgetMinor: 99 });
    expect(saved.current.view?.calculation).toMatchObject({ status: 'unavailable', overBudgetMinor: 1 });
    await expect(purse.save(creator, event.id, { ...plan, funding: { kind: 'fixed', budgetMinor: 200 },
      pools: [pool, { ...pool, id: identifier(8503) }] }, [], saved.current.configuration.etag, identifier(8504), vi.fn())).rejects.toMatchObject({ status: 400 });
  });
  it('registers a JWT-first conditional no-store configuration handler, never a public mutation', async () => {
    const f = await scoringFixture(1);
    const verify = vi.fn().mockResolvedValue(creator);
    const check = vi.fn().mockResolvedValue(undefined);
    const handler = createScoringHandler(() => ({ verify, limiter: { check }, scores: f.scores }), 'event-skins-config');
    const request = (body: unknown, headers: Record<string, string> = {}) => new HttpRequest({
      method: 'PUT', url: `https://fictional.example.test/api/events/${event.id}/event-skins`, params: { id: event.id },
      headers: { authorization: 'Bearer fictional', 'content-type': 'application/json',
        'if-match': f.saved.etag, 'idempotency-key': identifier(8600), ...headers }, body: { string: JSON.stringify(body) },
    });
    const context = new InvocationContext();
    const result = await handler(request({ configuration: { version: 1 } }), context);
    expect(result.status).toBe(200);
    expect(result.headers).toMatchObject({ 'Cache-Control': 'no-store' });
    expect(isEventSkinsChange(result.jsonBody)).toBe(true);
    expect(check).toHaveBeenCalledWith(creator, 'scores-write');
    expect(verify).toHaveBeenCalledWith('Bearer fictional');
    expect((await handler(request({ configuration: { version: 1, other: true } }), context)).status).toBe(400);
    expect((await handler(request({ configuration: null }, { 'if-match': '*' }), context)).status).toBe(400);
    verify.mockRejectedValue(new ApiError(401, 'TOKEN_REQUIRED'));
    expect((await handler(request({ configuration: null }), context)).status).toBe(401);
  });
});
