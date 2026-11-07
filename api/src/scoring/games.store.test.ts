import { describe, expect, it } from 'vitest';
import type { RoundGameDefinition } from '../../../src/domain/games.js';
import { stablefordPoints } from '../../../src/domain/stableford.js';
import { isGameWriteResult, isRoundScores } from '../../../src/contracts/scoring.js';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import { canonical } from '../catalog/entities.js';
import { TableEventStore } from '../events/store.js';
import { gameChangeKey, gameConfigurationKey } from './games.js';

function game(number = 700, basis: 'gross' | 'net' = 'gross', preset: 'standard' | 'modified' = 'standard'): RoundGameDefinition {
  return { id: identifier(number), name: `Fictional ${basis} ${preset}`, preset, basis,
    handicapAllowancePercent: 95, points: stablefordPoints(preset) };
}
describe('saved round games and authoritative results', () => {
  it('creates multiple games atomically with conditional owner/event checks, audit and registry, without writing strokes or locking setup', async () => {
    const f = await scoringFixture();
    const definitions = [game(), game(701, 'net', 'modified')];
    const result = await f.scores.saveGames(creator, event.id, f.roundId, definitions, null, identifier(800));
    expect(isGameWriteResult(result)).toBe(true);
    expect(isRoundScores(result.round)).toBe(true);
    expect(result.change.before).toEqual([]);
    expect(result.change.after).toEqual(definitions);
    expect(result.round.setupLocked).toBe(false);
    expect(result.round.cards.every((card) => card.etag === null)).toBe(true);
    expect(result.round.games?.configuration.games).toEqual(definitions);
    expect(result.round.games?.results[0]?.players[0]).toMatchObject({ status: 'in-progress', totalPoints: null, holesScored: 0 });
    expect(result.round.games?.results[1]?.players[0]).toMatchObject({ status: 'unavailable', unavailableReason: 'missing-handicap-index', totalPoints: null });
    const actions = f.submit.mock.calls[0]?.[0];
    expect(actions).toHaveLength(4);
    expect(actions?.map((action) => action[0])).toEqual(['update', 'update', 'create', 'create']);
    expect(actions?.[0]?.[3]).toEqual({ etag: f.saved.etag });
    expect(actions?.[1]?.[3]?.etag).toEqual(expect.any(String));
    expect(actions?.every((action) => action[1].partitionKey === event.id)).toBe(true);
    expect(actions?.some((action) => action[1].rowKey.startsWith('score-'))).toBe(false);
    expect(f.rows.has(`${event.id}|${gameChangeKey(f.roundId, identifier(800))}`)).toBe(true);
  });

  it('recalculates results from saved strokes and edited rules without rewriting cards, and distinguishes the original acknowledgement from later configuration', async () => {
    const f = await scoringFixture();
    const first = await f.scores.saveGames(creator, event.id, f.roundId, [game()], null, identifier(800));
    const scored = await f.write();
    expect(scored.round.games?.results[0]?.players[0]?.totalPoints).toBe(2);
    const cardKey = `${event.id}|score-card:${f.roundId}:${f.playerId}`;
    const card = f.rows.get(cardKey);
    const edited = { ...game(), points: { ...game().points, rows: game().points.rows.map((row) => row.scoreToPar === 0 ? { ...row, points: 10 } : row) } };
    const updated = await f.scores.saveGames(creator, event.id, f.roundId, [edited], first.round.games?.configuration.etag ?? null, identifier(801));
    expect(updated.round.games?.results[0]?.players[0]?.totalPoints).toBe(10);
    expect(f.rows.get(cardKey)).toEqual(card);
    expect(updated.round.setupLocked).toBe(true);
    const replay = await f.scores.saveGames(creator, event.id, f.roundId, [game()], null, identifier(800));
    expect(replay.change).toEqual(first.change);
    expect(replay.round).toEqual(updated.round);
    expect(f.submit).toHaveBeenCalledTimes(3);
    await expect(f.scores.saveGames(creator, event.id, f.roundId, [edited], null, identifier(800)))
      .rejects.toMatchObject({ status: 409, code: 'GAME_REQUEST_CONFLICT' });
  });

  it('uses captured handicap inputs and saved Total ratings, not current global catalog data', async () => {
    const f = await scoringFixture();
    const saved = f.saved.rounds[0];
    if (!saved) throw new Error('Missing fictional round.');
    const captured = {
      ...saved, players: saved.players.map(({ playerId, displayName }) => ({ playerId, displayName, handicapIndex: {
        id: identifier(900), value: '18.0', effectiveDate: '2026-01-01', source: 'Fictional capture',
        recordedAt: '2026-01-01T00:00:00Z', recordedBy: creator, previousObservationId: null,
      } })),
    };
    f.seed({ partitionKey: event.id, rowKey: `round:${f.roundId}`, content: canonical(captured) });
    await f.scores.saveGames(creator, event.id, f.roundId, [game(700, 'net')], null, identifier(800));
    const result = await f.write();
    expect(result.round.games?.results[0]?.players[0]).toMatchObject({ playingHandicap: 18, totalPoints: 3 });
    f.get.mockClear();
    const loaded = await f.scores.get(creator, event.id, f.roundId);
    expect(loaded.games?.results[0]?.players[0]).toMatchObject({ playingHandicap: 18, totalPoints: 3 });
    expect(f.get.mock.calls.every(([partition, row]) => partition === event.id
      || partition === 'catalog:players' && row.startsWith('player:'))).toBe(true);
  });

  it('replays a lost committed response with the same request and rejects stale revisions or removal of configured games', async () => {
    const f = await scoringFixture();
    f.submit.mockImplementationOnce((actions) => {
      f.apply(actions);
      return Promise.reject(new Error('Fictional lost game response.'));
    });
    const definitions = [game(), game(701, 'gross', 'modified')];
    const first = await f.scores.saveGames(creator, event.id, f.roundId, definitions, null, identifier(800));
    expect(await f.scores.saveGames(creator, event.id, f.roundId, definitions, null, identifier(800))).toEqual(first);
    expect(f.submit).toHaveBeenCalledOnce();
    await expect(f.scores.saveGames(creator, event.id, f.roundId, definitions, null, identifier(801))).rejects.toMatchObject({ code: 'GAMES_CHANGED' });
    await expect(f.scores.saveGames(creator, event.id, f.roundId, [game()], first.round.games?.configuration.etag ?? null, identifier(802)))
      .rejects.toMatchObject({ code: 'GAME_REMOVAL_NOT_SUPPORTED' });
    expect(f.submit).toHaveBeenCalledOnce();
  });

  it('requires authoritative ownership but not global catalog management, denies members and keeps archives read-only', async () => {
    const f = await scoringFixture();
    await expect(f.scores.saveGames(member, event.id, f.roundId, [game()], null, identifier(800))).rejects.toMatchObject({ status: 404 });
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'member' });
    await expect(f.scores.saveGames(member, event.id, f.roundId, [game()], null, identifier(800))).rejects.toMatchObject({ status: 403 });
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'owner' });
    const first = await f.scores.saveGames(member, event.id, f.roundId, [game()], null, identifier(800));
    const current = await f.workspace.get(creator, event.id);
    await new TableEventStore(f.table).setStatus(creator, event.id, 'archived', current.etag);
    expect((await f.scores.get(member, event.id, f.roundId)).games?.configuration.games).toEqual([game()]);
    await expect(f.scores.saveGames(member, event.id, f.roundId, [game()], first.round.games?.configuration.etag ?? null, identifier(801)))
      .rejects.toMatchObject({ status: 409, code: 'EVENT_ARCHIVED' });
  });

  it.each(['event', 'grant'] as const)('conditionally rolls back every game entity when the %s changes during a save', async (kind) => {
    const f = await scoringFixture();
    f.submit.mockImplementationOnce((actions) => {
      const key = `${event.id}|${kind === 'event' ? 'event' : `member:${creator.objectId}`}`;
      const row = f.rows.get(key);
      if (!row) throw new Error('Missing fictional authority row.');
      f.seed({ ...row, etag: undefined });
      f.apply(actions);
      return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
    });
    await expect(f.scores.saveGames(creator, event.id, f.roundId, [game()], null, identifier(800))).rejects.toMatchObject({ status: 409 });
    expect(f.rows.has(`${event.id}|${gameConfigurationKey(f.roundId)}`)).toBe(false);
    expect(f.rows.has(`${event.id}|${gameChangeKey(f.roundId, identifier(800))}`)).toBe(false);
  });

  it('fails closed on missing/corrupt configured games and surviving history rather than treating them as no games', async () => {
    const f = await scoringFixture();
    await f.scores.saveGames(creator, event.id, f.roundId, [game()], null, identifier(800));
    const key = `${event.id}|${gameConfigurationKey(f.roundId)}`;
    const row = f.rows.get(key);
    if (!row) throw new Error('Missing fictional game configuration.');
    f.rows.delete(key);
    await expect(f.scores.get(creator, event.id, f.roundId)).rejects.toMatchObject({ status: 503 });
    await expect(f.write()).rejects.toMatchObject({ status: 503 });
    expect(f.submit).toHaveBeenCalledOnce();
    const metadata = f.rows.get(`${event.id}|event`);
    if (!metadata) throw new Error('Missing fictional event.');
    const { gameRoundIds: _removed, ...withoutRegistry } = metadata;
    void _removed;
    f.seed(withoutRegistry);
    await expect(f.scores.get(creator, event.id, f.roundId)).rejects.toMatchObject({ status: 503 });
    f.rows.set(key, row);
    await expect(f.scores.get(creator, event.id, f.roundId)).rejects.toMatchObject({ status: 503 });
  });
});
