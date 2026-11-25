import { describe, expect, it } from 'vitest';
import { isRoundGameDefinition } from './games.js';
import { isNinesDefinition, isNinesResult } from './nines.js';
import { containsNinesGame, withoutNinesGameKind } from './nines-negotiation.js';
import { calculateGameResults } from '../domain/stableford.js';
import { strokeGameFixture, strokeGameId } from '../domain/stroke-games.test-support.js';
import type { NinesGameDefinition } from '../domain/nines.js';
import { roundGameKinds } from '../domain/games.js';
import { matchGamesFixture } from '../domain/match-games.test-support.js';
import { isRoundScores } from './scoring.js';

function fixture() {
  const f = strokeGameFixture(9, 3);
  const ids = f.snapshot.players.map((player) => player.playerId);
  const game: NinesGameDefinition = { id: strokeGameId(1500), name: 'Fictional Nines', kind: 'nines', version: 1,
    basis: 'gross', groupNumber: 1, playerIds: ids, stakeMinor: 100 };
  const [result] = calculateGameResults([game], f.snapshot, f.cards);
  return { ...f, ids, game, result };
}

describe('Nines definition contract', () => {
  it('accepts gross without a handicap rule, and net with full CH or strokes off the low golfer', () => {
    const { game } = fixture();
    expect(isNinesDefinition(game)).toBe(true);
    expect(isRoundGameDefinition(game)).toBe(true);
    expect(isNinesDefinition({ ...game, basis: 'net', handicapRule: 'full-course-v1' })).toBe(true);
    expect(isNinesDefinition({ ...game, basis: 'net', handicapRule: 'group-low-v1' })).toBe(true);
    expect(isNinesDefinition({ ...game, stakeMinor: null })).toBe(true);
  });

  it('rejects net without a rule, gross with one, wrong golfer counts, negative stakes and unknown fields', () => {
    const { game, ids } = fixture();
    for (const invalid of [
      { ...game, basis: 'net' }, { ...game, handicapRule: 'full-course-v1' }, { ...game, playerIds: ids.slice(0, 2) },
      { ...game, playerIds: [...ids, strokeGameId(9)] }, { ...game, playerIds: [ids[0], ids[0], ids[1]] },
      { ...game, stakeMinor: -1 }, { ...game, stakeMinor: 1.5 }, { ...game, groupNumber: 0 }, { ...game, version: 2 },
      { ...game, extra: true }, { ...game, basis: 'net', handicapRule: 'group-low-v9' },
    ]) expect(isNinesDefinition(invalid)).toBe(false);
  });
});

describe('Nines result contract', () => {
  it('accepts the calculated result, and rejects tampered points or totals', () => {
    const { game, result } = fixture();
    expect(isNinesResult(result, game)).toBe(true);
    const firstPlayer = result?.players[0];
    if (!result || !firstPlayer) throw new Error('Expected a calculated result.');
    expect(isNinesResult({ ...result, players: [{ ...firstPlayer, totalPoints: 99 }, ...result.players.slice(1)] }, game)).toBe(false);
    const holes = result.nines?.holes ?? [];
    const tampered = holes.map((hole, index) => index === 0
      ? { ...hole, points: hole.points.map((entry, position) => ({ ...entry, points: position === 0 ? 5 : entry.points })) } : hole);
    expect(isNinesResult({ ...result, nines: { ...result.nines, holes: tampered } }, game)).toBe(false);
  });
});

describe('Nines negotiation helpers', () => {
  it('finds Nines definitions or results anywhere in a response, and nothing else', () => {
    const { game, result } = fixture();
    expect(containsNinesGame({ round: { games: { configuration: { games: [game] } } } })).toBe(true);
    expect(containsNinesGame([{ results: [result] }])).toBe(true);
    expect(containsNinesGame({ games: [{ kind: 'wolf' }, { kind: 'dots' }], note: 'nines' })).toBe(false);
  });

  it('hides nines from advertised game kinds for older clients, keeping every other kind', () => {
    expect(withoutNinesGameKind(roundGameKinds)).toEqual(roundGameKinds.filter((kind) => kind !== 'nines'));
  });
});

describe('Nines in a round with other playing groups', () => {
  it('decodes a round with a foursome and a Nines threesome, where Nines lists only its own three golfers', () => {
    // Seven golfers: group 1 is a foursome, group 2 the threesome playing Nines.
    const f = matchGamesFixture(7);
    expect(f.snapshot.groups.map((group) => group.playerIds.length)).toEqual([4, 3]);
    const threesome = f.snapshot.groups[1]?.playerIds ?? [];
    const game: NinesGameDefinition = { id: strokeGameId(1500), name: 'Nines', kind: 'nines', version: 1,
      basis: 'gross', groupNumber: 2, playerIds: threesome, stakeMinor: null };
    const round = f.round(f.cards, [game]);
    expect(round.games?.results[0]?.players).toHaveLength(3);
    expect(round.cards).toHaveLength(7);
    expect(isRoundScores(round)).toBe(true);
  });
});
