import { describe, expect, it, vi } from 'vitest';
import type { PursePlan } from '../../../src/domain/purse.js';
import { isEventPurseView, isPurseWriteResult } from '../../../src/contracts/purse-settings.js';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import { TableEventStore } from '../events/store.js';
import { TablePurseStore } from './store.js';

async function fixture() {
  const f = await scoringFixture();
  const store = new TablePurseStore(f.table, f.workspace, f.scores);
  const charge = vi.fn().mockResolvedValue(undefined);
  const plan: PursePlan = {
    eventId: event.id, currency: 'USD', funding: { kind: 'fixed', budgetMinor: 12000 },
    pools: [{ id: identifier(700), name: 'Fictional side pot', source: { kind: 'manual' },
      awardUnit: 'pot', amountMinor: 9001, recipientIds: f.input.playerIds.slice(0, 3) }],
  };
  return { ...f, store, charge, plan };
}

describe('owner purse settings and authoritative winnings', () => {
  it('starts unconfigured and atomically saves exact individual shares, remainder and immutable receipt', async () => {
    const f = await fixture();
    const initial = await f.store.get(creator, event.id, f.charge);
    expect(isEventPurseView(initial)).toBe(true);
    expect(initial.configuration).toEqual({ eventId: event.id, etag: null, plan: null, resolutions: [] });
    expect(initial.view).toBeNull();
    const saved = await f.store.save(creator, event.id, f.plan, [], null, identifier(800), f.charge);
    expect(isPurseWriteResult(saved)).toBe(true);
    expect(saved.change.before).toEqual({ plan: null, resolutions: [] });
    expect(saved.current.view?.calculation).toMatchObject({
      plannedBudgetMinor: 12000, allocatedMinor: 9000, unallocatedMinor: 1, remainingMinor: 2999,
    });
    expect(saved.current.view?.calculation.players.map((player) => player.totalMinor)).toEqual([3000, 3000, 3000, 0]);
    expect(saved.current.roundScores.every((round) => round.cards.every((card) => card.etag === null))).toBe(true);
    const actions = f.submit.mock.calls[0]?.[0];
    expect(actions?.map((action) => action[0])).toEqual(['update', 'update', 'create', 'create']);
    expect(actions?.[0]?.[3]?.etag).toBe(f.saved.etag);
    expect(actions?.[1]?.[3]?.etag).toEqual(expect.any(String));
    expect(f.rows.has(`${event.id}|purse-change:${identifier(800)}`)).toBe(true);
  });
  it('replays lost responses, rejects changed operation identity and distinguishes original acknowledgements from later plans', async () => {
    const f = await fixture();
    f.submit.mockImplementationOnce((actions) => {
      f.apply(actions);
      return Promise.reject(new Error('Fictional lost response'));
    });
    const first = await f.store.save(creator, event.id, f.plan, [], null, identifier(800), f.charge);
    expect(await f.store.save(creator, event.id, f.plan, [], null, identifier(800), f.charge)).toEqual(first);
    const edited = { ...f.plan, funding: { kind: 'fixed' as const, budgetMinor: 15000 } };
    const latest = await f.store.save(creator, event.id, edited, [], first.current.configuration.etag, identifier(801), f.charge);
    const replay = await f.store.save(creator, event.id, f.plan, [], null, identifier(800), f.charge);
    expect(replay.change).toEqual(first.change);
    expect(replay.current).toEqual(latest.current);
    await expect(f.store.save(creator, event.id, edited, [], null, identifier(800), f.charge))
      .rejects.toMatchObject({ status: 409, code: 'PURSE_REQUEST_CONFLICT' });
    expect(f.submit).toHaveBeenCalledTimes(2);
  });
  it('uses event ownership rather than catalog authority, denies ordinary members, and keeps archives read-only', async () => {
    const f = await fixture();
    await expect(f.store.get(member, event.id, f.charge)).rejects.toMatchObject({ status: 404 });
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'member' });
    await expect(f.store.get(member, event.id, f.charge)).rejects.toMatchObject({ status: 403 });
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'owner' });
    const saved = await f.store.save(member, event.id, f.plan, [], null, identifier(800), f.charge);
    const workspace = await f.workspace.get(creator, event.id);
    await new TableEventStore(f.table).setStatus(creator, event.id, 'archived', workspace.etag);
    expect(isEventPurseView(await f.store.get(member, event.id, f.charge))).toBe(true);
    await expect(f.store.save(member, event.id, f.plan, [], saved.current.configuration.etag, identifier(801), f.charge))
      .rejects.toMatchObject({ status: 409, code: 'EVENT_ARCHIVED' });
  });
  it.each(['event', 'grant'] as const)('rolls back configuration/audit when the %s changes at publication', async (kind) => {
    const f = await fixture();
    f.submit.mockImplementationOnce((actions) => {
      const key = `${event.id}|${kind === 'event' ? 'event' : `member:${creator.objectId}`}`;
      const row = f.rows.get(key);
      if (!row) throw new Error('Missing fictional authority.');
      f.seed({ ...row });
      f.apply(actions);
      return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
    });
    await expect(f.store.save(creator, event.id, f.plan, [], null, identifier(800), f.charge)).rejects.toMatchObject({ status: 409 });
    expect(f.rows.has(`${event.id}|purse`)).toBe(false);
    expect(f.rows.has(`${event.id}|purse-change:${identifier(800)}`)).toBe(false);
  });
  it('does not publish if the event becomes archived before the source snapshot begins', async () => {
    const f = await fixture();
    const get = f.workspace.get.bind(f.workspace);
    vi.spyOn(f.workspace, 'get').mockImplementationOnce(async (...args) => {
      const row = f.rows.get(`${event.id}|event`);
      if (!row) throw new Error('Missing fictional event.');
      f.seed({ ...row, status: 'archived' });
      return get(...args);
    });
    await expect(f.store.save(creator, event.id, f.plan, [], null, identifier(800), f.charge))
      .rejects.toMatchObject({ status: 409 });
    expect(f.rows.has(`${event.id}|purse`)).toBe(false);
  });
  it('rejects invalid targets and preserves missing/corrupt purse evidence rather than inventing an empty plan', async () => {
    const f = await fixture();
    await expect(f.store.save(creator, event.id, { ...f.plan, eventId: identifier(999) }, [], null, identifier(800), f.charge))
      .rejects.toMatchObject({ status: 400 });
    const saved = await f.store.save(creator, event.id, f.plan, [], null, identifier(801), f.charge);
    await expect(f.store.save(creator, event.id, f.plan, [], null, identifier(802), f.charge)).rejects.toMatchObject({ status: 409 });
    expect(saved.current.configuration.etag).not.toBeNull();
    f.rows.delete(`${event.id}|purse`);
    await expect(f.store.get(creator, event.id, f.charge)).rejects.toMatchObject({ status: 503 });
    const metadata = f.rows.get(`${event.id}|event`);
    if (!metadata) throw new Error('Missing fictional event.');
    const { purseConfigured: omitted, ...withoutFlag } = metadata;
    void omitted;
    f.seed(withoutFlag);
    await expect(f.store.get(creator, event.id, f.charge)).rejects.toMatchObject({ status: 503 });
  });
  it('makes a configured future round prize explicitly projected, not paid or silently zero', async () => {
    const f = await fixture();
    const game = { id: identifier(710), name: 'Fictional future game', preset: 'standard' as const, basis: 'gross' as const,
      handicapAllowancePercent: 95, points: { rows: [{ scoreToPar: 0, points: 2 }], betterScorePoints: 3, worseScorePoints: 0 } };
    await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(711));
    const plan: PursePlan = { ...f.plan, pools: [{ id: identifier(700), name: 'Fictional round prize',
      source: { kind: 'round-game', roundId: f.roundId, gameId: game.id }, awardUnit: 'per-golfer',
      tiePolicy: 'pooled', prizes: [{ place: 1, amountMinor: 9000 }] }] };
    const saved = await f.store.save(creator, event.id, plan, [], null, identifier(800), f.charge);
    expect(isPurseWriteResult(saved)).toBe(true);
    expect(saved.current.view?.calculation.status).toBe('projected');
    expect(saved.current.view?.calculation.allocatedMinor).toBe(0);
    expect(saved.current.view?.calculation.reservedMinor).toBe(9000);
  });
});
