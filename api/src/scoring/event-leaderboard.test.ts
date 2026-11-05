import { describe, expect, it, vi } from 'vitest';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { isEventLeaderboardView } from '../../../src/contracts/event-leaderboard.js';
import { calculateEventStandings } from '../../../src/domain/event-leaderboard.js';
import { stablefordPoints } from '../../../src/domain/stableford.js';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import { ApiError } from '../errors.js';
import { TableEventStore } from '../events/store.js';
import { createScoringHandler } from './handlers.js';

describe('saved owner-only overall leaderboard service', () => {
  it('keeps legacy/disabled events empty without reading or charging round scores', async () => {
    const f = await scoringFixture();
    const get = vi.spyOn(f.scores, 'get');
    const charge = vi.fn().mockResolvedValue(undefined);
    const result = await f.scores.leaderboard(creator, event.id, charge);
    expect(isEventLeaderboardView(result)).toBe(true);
    expect(result.workspace.overallCompetition).toBeUndefined();
    expect(result.roundScores).toEqual([]);
    expect(get).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('fails closed on corrupt stored competition configuration instead of interpreting it as disabled', async () => {
    const f = await scoringFixture();
    const row = f.rows.get(`${event.id}|workspace`);
    if (!row || typeof row.content !== 'string') throw new Error('Missing fictional workspace.');
    const saved: unknown = JSON.parse(row.content);
    if (typeof saved !== 'object' || saved === null) throw new Error('Invalid fictional workspace.');
    for (const overallCompetition of [null, { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 0 }]) {
      f.seed({ ...row, content: JSON.stringify({ ...saved, overallCompetition }) });
      await expect(f.scores.leaderboard(creator, event.id, vi.fn().mockResolvedValue(undefined)))
        .rejects.toMatchObject({ status: 503 });
    }
    expect(f.submit).not.toHaveBeenCalled();
  });

  it.each([1, 3, 8])('includes all %i saved rounds with at most three parallel score reads and charges every round', async (count) => {
    const f = await scoringFixture();
    const first = f.input.rounds[0];
    if (!first) throw new Error('Missing fictional round.');
    await f.workspace.save(creator, event.id, {
      ...f.input, overallCompetition: { kind: 'stroke-play', basis: 'gross' },
      rounds: Array.from({ length: count }, (_, index) => ({
        ...first, id: identifier(500 + index), name: `Fictional Round ${String(index + 1)}`,
      })),
    }, f.saved.etag);
    const read = f.scores.get.bind(f.scores);
    let active = 0;
    let maximum = 0;
    vi.spyOn(f.scores, 'get').mockImplementation(async (...args) => {
      active++;
      maximum = Math.max(maximum, active);
      try { return await read(...args); } finally { active--; }
    });
    const charge = vi.fn().mockResolvedValue(undefined);
    const writes = f.submit.mock.calls.length;
    const result = await f.scores.leaderboard(creator, event.id, charge);
    expect(isEventLeaderboardView(result)).toBe(true);
    expect(result.roundScores.map((round) => round.roundId)).toEqual(Array.from({ length: count }, (_, index) => identifier(500 + index)));
    expect(result.standings).toEqual(calculateEventStandings(result.workspace, result.roundScores));
    expect(charge).toHaveBeenCalledTimes(count);
    expect(maximum).toBe(Math.min(3, count));
    expect(f.submit).toHaveBeenCalledTimes(writes);
  });

  it('persists actual saved-game bindings, preserves them for old clients and explicitly disables without rewriting scores', async () => {
    const f = await scoringFixture();
    const game = { id: identifier(700), name: 'Fictional counting game', preset: 'standard' as const,
      basis: 'gross' as const, handicapAllowancePercent: 95, points: stablefordPoints('standard') };
    await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(800));
    await f.write();
    const before = await f.workspace.get(creator, event.id);
    const config = { kind: 'stableford' as const, credit: 'individual' as const,
      roundGames: [{ roundId: f.roundId, gameId: game.id }] };
    const saved = await f.workspace.save(creator, event.id, { ...f.input, overallCompetition: config }, before.etag);
    expect(saved.overallCompetition).toEqual(config);
    const result = await f.scores.leaderboard(creator, event.id, vi.fn().mockResolvedValue(undefined));
    expect(isEventLeaderboardView(result)).toBe(true);
    expect(result.roundScores[0]?.games?.results[0]?.players[0]?.totalPoints).toBe(2);
    const cards = result.roundScores[0]?.cards;
    const renamed = await f.workspace.save(creator, event.id, { ...f.input, name: 'Fictional renamed event' }, saved.etag);
    expect(renamed.overallCompetition).toEqual(config);
    const disabled = await f.workspace.save(creator, event.id, { ...f.input, overallCompetition: null }, renamed.etag);
    expect(disabled.overallCompetition).toBeUndefined();
    expect((await f.scores.get(creator, event.id, f.roundId)).cards).toEqual(cards);
  });

  it('rejects unknown counted rounds/games and preserves the existing setup authority', async () => {
    const f = await scoringFixture();
    for (const binding of [
      { roundId: identifier(999), gameId: identifier(700) },
      { roundId: f.roundId, gameId: identifier(999) },
    ]) {
      await expect(f.workspace.save(creator, event.id, {
        ...f.input, overallCompetition: { kind: 'stableford', credit: 'team', roundGames: [binding] },
      }, f.saved.etag)).rejects.toMatchObject({ status: 400 });
    }
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'owner' });
    await expect(f.workspace.save(member, event.id, {
      ...f.input, overallCompetition: { kind: 'stroke-play', basis: 'gross' },
    }, f.saved.etag)).rejects.toMatchObject({ status: 403 });
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('uses captured net allowances and invalidates stroke standings for a reported pickup without changing recorded strokes', async () => {
    const f = await scoringFixture();
    for (const playerId of f.input.playerIds) {
      const player = await f.players.get(creator, playerId);
      await f.players.observe(creator, playerId, identifier(2000 + f.input.playerIds.indexOf(playerId)), {
        value: '18.0', effectiveDate: '2026-01-01', source: 'Fictional index observation',
      }, player.etag);
    }
    const captured = await f.workspace.refreshIndices(creator, event.id, f.roundId, identifier(2100), f.saved.etag);
    await f.workspace.save(creator, event.id, {
      ...f.input, overallCompetition: { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 95 },
    }, captured.etag);
    const scored = await f.write();
    const initial = await f.scores.leaderboard(creator, event.id, vi.fn().mockResolvedValue(undefined));
    expect(isEventLeaderboardView(initial)).toBe(true);
    const first = initial.standings.players.find((player) => player.playerId === f.playerId);
    expect(first?.cells[0]?.relativeToPar).toBe(-1);
    expect(first?.rank).toBe(1);
    await f.scores.write(creator, event.id, f.roundId, f.playerId, 2,
      { kind: 'picked-up', reportedStrokes: 7 }, scored.round.cards[0]?.etag ?? null, identifier(2200));
    const pickup = await f.scores.leaderboard(creator, event.id, vi.fn().mockResolvedValue(undefined));
    expect(isEventLeaderboardView(pickup)).toBe(true);
    expect(pickup.standings.players.find((player) => player.playerId === f.playerId)?.rank).toBeNull();
    expect(pickup.roundScores[0]?.cards[0]?.holes[1]?.score).toEqual({ kind: 'picked-up', reportedStrokes: 7 });
  });

  it('denies nonowners and preserves archived owner read-only access', async () => {
    const f = await scoringFixture();
    const charge = vi.fn().mockResolvedValue(undefined);
    await expect(f.scores.leaderboard(member, event.id, charge)).rejects.toMatchObject({ status: 404 });
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'member' });
    await expect(f.scores.leaderboard(member, event.id, charge)).rejects.toMatchObject({ status: 403 });
    await f.workspace.save(creator, event.id, {
      ...f.input, overallCompetition: { kind: 'stroke-play', basis: 'gross' },
    }, f.saved.etag);
    const workspace = await f.workspace.get(creator, event.id);
    await new TableEventStore(f.table).setStatus(creator, event.id, 'archived', workspace.etag);
    const result = await f.scores.leaderboard(creator, event.id, charge);
    expect(isEventLeaderboardView(result)).toBe(true);
    expect(result.workspace.event.status).toBe('archived');
    await expect(f.scores.leaderboard(member, event.id, charge)).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a mixed-version aggregate and propagates quota failures instead of returning partial success', async () => {
    const f = await scoringFixture();
    await f.workspace.save(creator, event.id, {
      ...f.input, overallCompetition: { kind: 'stroke-play', basis: 'gross' },
    }, f.saved.etag);
    const read = f.scores.get.bind(f.scores);
    vi.spyOn(f.scores, 'get').mockImplementationOnce(async (...args) => {
      const result = await read(...args);
      const row = f.rows.get(`${event.id}|event`);
      if (!row) throw new Error('Missing fictional event.');
      f.seed({ ...row, name: 'Fictional concurrent rename' });
      return result;
    });
    await expect(f.scores.leaderboard(creator, event.id, vi.fn().mockResolvedValue(undefined)))
      .rejects.toMatchObject({ status: 409, code: 'EVENT_CHANGED' });
    await expect(f.scores.leaderboard(creator, event.id, vi.fn().mockRejectedValue(new ApiError(429, 'REQUEST_LIMIT_EXCEEDED'))))
      .rejects.toMatchObject({ status: 429 });
  });

  it('registers a JWT-first no-store GET without a round parameter and charges the existing score quota', async () => {
    const f = await scoringFixture();
    const api = { verify: vi.fn().mockResolvedValue(creator), limiter: { check: vi.fn().mockResolvedValue(undefined) }, scores: f.scores };
    const context = new InvocationContext({ invocationId: 'fictional-overall', logHandler: () => undefined });
    const request = (method = 'GET') => new HttpRequest({
      method, url: 'https://fictional.example.test/api/fixture', params: { id: event.id }, headers: { authorization: 'fictional-token' },
    });
    const handler = createScoringHandler(() => api, 'event-leaderboard');
    expect(await handler(request(), context)).toMatchObject({ status: 200, headers: { 'Cache-Control': 'no-store' } });
    expect(api.limiter.check).toHaveBeenCalledWith(creator, 'scores-read');
    expect(await handler(request('PUT'), context)).toMatchObject({ status: 405 });
    await f.workspace.save(creator, event.id, {
      ...f.input, overallCompetition: { kind: 'stroke-play', basis: 'gross' },
    }, f.saved.etag);
    api.limiter.check.mockClear();
    const enabled = await handler(request(), context);
    expect(enabled.status).toBe(200);
    expect(isEventLeaderboardView(enabled.jsonBody)).toBe(true);
    expect(api.limiter.check).toHaveBeenCalledTimes(2);
    api.limiter.check.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError(429, 'REQUEST_LIMIT_EXCEEDED'));
    expect(await handler(request(), context)).toMatchObject({ status: 429, headers: { 'Retry-After': '60' } });
    api.verify.mockRejectedValueOnce(new ApiError(401, 'INVALID_TOKEN'));
    expect(await handler(request(), context)).toMatchObject({ status: 401, headers: { 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer' } });
  });
});
