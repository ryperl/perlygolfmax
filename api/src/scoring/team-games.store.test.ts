import { describe, expect, it } from 'vitest';
import type { RoundGameDefinition, TeamGameDefinition, TeamGameFormat } from '../../../src/domain/games.js';
import { maximumGameConfigurationBytes } from '../../../src/domain/games.js';
import { stablefordPoints } from '../../../src/domain/stableford.js';
import { isGameWriteResult, isRoundScores } from '../../../src/contracts/scoring.js';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event } from '../../test/fixtures.js';
import { canonical } from '../catalog/entities.js';
import { gameConfigurationKey } from './games.js';

type Fixture = Awaited<ReturnType<typeof scoringFixture>>;

function teamGame(playerIds: readonly string[], format: TeamGameFormat = 'two-net-better-ball',
  preset: 'standard' | 'modified' = 'standard', id = 700): TeamGameDefinition {
  const size = format === 'four-two-net' ? 4 : 2;
  return {
    id: identifier(id), name: `Fictional ${format}`, format, preset, basis: 'net',
    handicapAllowancePercent: 100, points: stablefordPoints(preset),
    teams: Array.from({ length: playerIds.length / size }, (_, index) => ({
      id: identifier(id + 100 + index), name: `Fictional Team ${String(index + 1)}`,
      playerIds: playerIds.slice(index * size, (index + 1) * size),
    })),
  };
}

function capturedZeroIndices(f: Fixture): readonly string[] {
  const round = f.saved.rounds[0];
  if (!round) throw new Error('Missing fictional round.');
  f.seed({
    partitionKey: event.id, rowKey: `round:${f.roundId}`, content: canonical({
      ...round, players: round.players.map((player, index) => ({
        ...player, handicapIndex: {
          id: identifier(900 + index), value: '0.0', effectiveDate: '2026-01-01', source: 'Fictional capture',
          recordedAt: '2026-01-01T00:00:00Z', recordedBy: creator, previousObservationId: null,
        },
      })),
    }),
  });
  return round.players.map((player) => player.playerId);
}

describe('authoritative team games persistence', () => {
  it.each([
    ['two-net-better-ball', 'standard', [2, 3]],
    ['two-net-aggregate', 'standard', [3, 3]],
    ['four-two-net', 'standard', [5]],
    ['four-two-net', 'modified', [2]],
  ] as const)('calculates saved %s/%s team points without rewriting any stroke card', async (format, preset, expected) => {
    const f = await scoringFixture();
    const ids = capturedZeroIndices(f);
    const definition = teamGame(ids, format, preset);
    const configured = await f.scores.saveGames(creator, event.id, f.roundId, [definition], null, identifier(1000));
    expect(isGameWriteResult(configured)).toBe(true);
    expect(configured.round.games?.results[0]?.teams?.every((team) => team.totalPoints === null)).toBe(true);
    for (const [index, playerId] of ids.entries()) {
      const strokes = [4, 5, 3, 6][index];
      if (strokes === undefined) throw new Error('Missing fictional strokes.');
      const saved = await f.scores.write(creator, event.id, f.roundId, playerId, 1,
        { kind: 'strokes', strokes }, null, identifier(1100 + index));
      expect(isRoundScores(saved.round)).toBe(true);
      if (format === 'four-two-net' && index < 3) {
        expect(saved.round.games?.results[0]?.teams?.[0]?.totalPoints).toBeNull();
      }
    }
    const loaded = await f.scores.get(creator, event.id, f.roundId);
    expect(loaded.games?.results[0]?.teams?.map((team) => team.totalPoints)).toEqual(expected);
    expect(loaded.games?.results[0]?.teams?.every((team) => team.holesScored === 1 && team.status === 'in-progress')).toBe(true);
    const cards = loaded.cards;
    const changed = {
      ...definition, points: { ...definition.points,
        rows: definition.points.rows.map((row) => row.scoreToPar === 0 ? { ...row, points: 10 } : row),
      },
    };
    const revised = await f.scores.saveGames(creator, event.id, f.roundId, [changed],
      loaded.games?.configuration.etag ?? null, identifier(1200));
    expect(isGameWriteResult(revised)).toBe(true);
    expect(revised.round.cards).toEqual(cards);
    expect(revised.change.before).toEqual([definition]);
    expect(revised.change.after).toEqual([changed]);
  });

  it('rejects new incomplete, duplicate and foreign assignments without creating settings or audit rows', async () => {
    const f = await scoringFixture();
    const ids = capturedZeroIndices(f);
    const definition = teamGame(ids);
    const first = definition.teams[0];
    if (!first) throw new Error('Missing fictional team.');
    const invalid: readonly TeamGameDefinition[] = [
      { ...definition, teams: [first] },
      { ...definition, teams: definition.teams.map((team, index) => index === 0
        ? { ...team, playerIds: [first.playerIds[0] ?? '', identifier(999)] } : team) },
      { ...definition, teams: definition.teams.map((team) => ({ ...team, playerIds: first.playerIds })) },
    ];
    for (const game of invalid) {
      await expect(f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(1000)))
        .rejects.toMatchObject({ status: 400 });
    }
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.rows.has(`${event.id}|${gameConfigurationKey(f.roundId)}`)).toBe(false);
  });

  it('includes exact assignments in definitive retries and rejects request-ID reuse for different partners', async () => {
    const f = await scoringFixture();
    const definition = teamGame(capturedZeroIndices(f));
    const saved = await f.scores.saveGames(creator, event.id, f.roundId, [definition], null, identifier(1000));
    expect(await f.scores.saveGames(creator, event.id, f.roundId, [definition], null, identifier(1000))).toEqual(saved);
    const first = definition.teams[0];
    const second = definition.teams[1];
    if (!first || !second) throw new Error('Missing fictional partners.');
    const changed = { ...definition, teams: [
      { ...first, playerIds: second.playerIds }, { ...second, playerIds: first.playerIds },
    ] };
    await expect(f.scores.saveGames(creator, event.id, f.roundId, [changed], null, identifier(1000)))
      .rejects.toMatchObject({ status: 409, code: 'GAME_REQUEST_CONFLICT' });
    expect(f.submit).toHaveBeenCalledOnce();
  });

  it('keeps stale teams visible but unscored and permits sequential repair without altering another stale game', async () => {
    const f = await scoringFixture();
    const originalIds = capturedZeroIndices(f);
    const games = [teamGame(originalIds), teamGame(originalIds, 'two-net-aggregate', 'standard', 710)];
    const original = await f.scores.saveGames(creator, event.id, f.roundId, games, null, identifier(1000));
    const additions = await Promise.all([204, 205].map((id) =>
      f.players.create(creator, identifier(id), `Fictional Golfer ${String(id)}`)));
    const ids = [...originalIds, ...additions.map((player) => player.id)];
    const current = await f.workspace.get(creator, event.id);
    await f.workspace.save(creator, event.id, {
      ...f.input, playerIds: ids, rounds: f.input.rounds.map((round) => ({
        ...round, groups: [{ number: 1, playerIds: ids.slice(0, 4) }, { number: 2, playerIds: ids.slice(4) }],
      })),
    }, current.etag);
    const stale = await f.scores.get(creator, event.id, f.roundId);
    expect(isRoundScores(stale)).toBe(true);
    expect(stale.games?.results.every((result) => result.teamSetupRequired === true && result.teams?.length === 0)).toBe(true);
    const replay = await f.scores.saveGames(creator, event.id, f.roundId, games, null, identifier(1000));
    expect(replay.change).toEqual(original.change);
    expect(replay.round).toEqual(stale);
    const second = games[1];
    if (!second) throw new Error('Missing fictional peer game.');
    const count = f.submit.mock.calls.length;
    await expect(f.scores.saveGames(creator, event.id, f.roundId, [{ ...teamGame(originalIds), name: 'Fictional renamed stale game' }, second],
      stale.games?.configuration.etag ?? null, identifier(1001))).rejects.toMatchObject({ status: 400, code: 'INVALID_GAME_TEAMS' });
    expect(f.submit).toHaveBeenCalledTimes(count);
    const firstRepair = [teamGame(ids), second];
    const repaired = await f.scores.saveGames(creator, event.id, f.roundId, firstRepair,
      stale.games?.configuration.etag ?? null, identifier(1002));
    expect(isGameWriteResult(repaired)).toBe(true);
    expect(repaired.round.games?.configuration.games[1]).toEqual(second);
    expect(repaired.round.games?.results[0]?.teamSetupRequired).toBeUndefined();
    expect(repaired.round.games?.results[1]).toMatchObject({ teamSetupRequired: true, teams: [] });
    const complete = await f.scores.saveGames(creator, event.id, f.roundId,
      [teamGame(ids), teamGame(ids, 'two-net-aggregate', 'standard', 710)],
      repaired.round.games?.configuration.etag ?? null, identifier(1003));
    expect(isGameWriteResult(complete)).toBe(true);
    expect(complete.round.games?.results.every((result) => result.teamSetupRequired === undefined)).toBe(true);
    expect(complete.round.cards.every((card) => card.etag === null)).toBe(true);
  });

  it('bounds direct configuration saves and rejects oversized stored settings before projecting results', async () => {
    const f = await scoringFixture();
    const base = teamGame(capturedZeroIndices(f));
    const large: readonly RoundGameDefinition[] = Array.from({ length: 16 }, (_, index) => ({
      ...base, id: identifier(700 + index), points: {
        ...base.points, rows: Array.from({ length: 32 }, (_, row) => ({ scoreToPar: row, points: 1_000_000_000_000 })),
      },
    }));
    expect(Buffer.byteLength(JSON.stringify({ games: large }), 'utf8')).toBeGreaterThan(maximumGameConfigurationBytes);
    await expect(f.scores.saveGames(creator, event.id, f.roundId, large, null, identifier(1000)))
      .rejects.toMatchObject({ status: 413, code: 'REQUEST_TOO_LARGE' });
    expect(f.submit).not.toHaveBeenCalled();
    await f.scores.saveGames(creator, event.id, f.roundId, [base], null, identifier(1001));
    const key = `${event.id}|${gameConfigurationKey(f.roundId)}`;
    const stored = f.rows.get(key);
    if (!stored) throw new Error('Missing fictional configuration.');
    f.seed({ ...stored, content: canonical({ eventId: event.id, roundId: f.roundId, games: large }) });
    await expect(f.scores.get(creator, event.id, f.roundId)).rejects.toMatchObject({ status: 503, code: 'INVALID_STORED_GAMES' });
    expect(f.submit).toHaveBeenCalledOnce();
  });
});
