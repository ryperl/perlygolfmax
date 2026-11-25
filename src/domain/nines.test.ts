import { describe, expect, it } from 'vitest';
import type { HoleScore, Scorecard } from './scoring.js';
import { calculateGameResults } from './stableford.js';
import { strokeGameFixture, strokeGameId } from './stroke-games.test-support.js';
import { calculateNines, calculateNinesSettlement, ninesGroupMatches, pointsForPlaces, sameNinesDefinition } from './nines.js';
import type { NinesGameDefinition } from './nines.js';

const strokes = (value: number): HoleScore => ({ kind: 'strokes', strokes: value });

/** A three-golfer, 9-hole round where every hole starts unplayed. */
function fixture(handicapIndexes: readonly string[] = ['0', '0', '0']) {
  const f = strokeGameFixture(9, 3);
  const snapshot = {
    ...f.snapshot,
    players: f.snapshot.players.map((player, index) => ({
      ...player, handicapIndex: { ...player.handicapIndex, value: handicapIndexes[index] ?? '0' },
    })),
  };
  const ids = snapshot.players.map((player) => player.playerId);
  const game: NinesGameDefinition = { id: strokeGameId(1500), name: 'Fictional Nines', kind: 'nines', version: 1,
    basis: 'gross', groupNumber: 1, playerIds: ids, stakeMinor: null };
  const unplayed: readonly Scorecard[] = f.cards.map((card) => ({
    ...card, holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'unplayed' as const } })),
  }));
  /** Sets every golfer's score on one hole, in player order. */
  function onHole(cards: readonly Scorecard[], number: number, scores: readonly HoleScore[]): readonly Scorecard[] {
    return cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => hole.number === number
      ? { ...hole, score: scores[index] ?? { kind: 'unplayed' as const } } : hole) }));
  }
  function result(cards: readonly Scorecard[], definition: NinesGameDefinition = game) {
    const [calculated] = calculateGameResults([definition], snapshot, cards);
    if (!calculated?.nines) throw new Error('Expected a Nines result.');
    return calculated;
  }
  function holePoints(cards: readonly Scorecard[], number: number, definition: NinesGameDefinition = game) {
    const hole = result(cards, definition).nines?.holes.find((entry) => entry.number === number);
    return { status: hole?.status, points: ids.map((id) => hole?.points.find((entry) => entry.playerId === id)?.points) };
  }
  return { snapshot, ids, game, unplayed, onHole, result, holePoints };
}

describe('Nines place points', () => {
  it('awards 5, 3 and 1 when all three scores differ', () => {
    const f = fixture();
    expect(f.holePoints(f.onHole(f.unplayed, 1, [strokes(3), strokes(4), strokes(5)]), 1))
      .toEqual({ status: 'complete', points: [5, 3, 1] });
  });

  it('two tie for best: 4 / 4 / 1', () => {
    const f = fixture();
    expect(f.holePoints(f.onHole(f.unplayed, 1, [strokes(4), strokes(4), strokes(6)]), 1).points).toEqual([4, 4, 1]);
  });

  it('two tie for worst: 5 / 2 / 2', () => {
    const f = fixture();
    expect(f.holePoints(f.onHole(f.unplayed, 1, [strokes(3), strokes(5), strokes(5)]), 1).points).toEqual([5, 2, 2]);
  });

  it('all three tie: 3 / 3 / 3', () => {
    const f = fixture();
    expect(f.holePoints(f.onHole(f.unplayed, 1, [strokes(4), strokes(4), strokes(4)]), 1).points).toEqual([3, 3, 3]);
  });

  it('every possible ordering of three golfers totals exactly 9 points', () => {
    for (const values of [[1, 2, 3], [1, 1, 2], [1, 2, 2], [2, 2, 2], [3, 1, 2], [null, 1, 1], [null, null, 1], [null, null, null]]) {
      const entries = values.map((value, index) => ({ playerId: String(index), value }));
      const total = pointsForPlaces(entries).reduce((sum, entry) => sum + entry.points, 0);
      expect(total).toBe(9);
    }
  });
});

describe('Nines pickups, X7, DNF and unplayed holes', () => {
  it('a pickup ranks worst, below every numeric score', () => {
    const f = fixture();
    expect(f.holePoints(f.onHole(f.unplayed, 1, [{ kind: 'picked-up' }, strokes(8), strokes(9)]), 1).points)
      .toEqual([1, 5, 3]);
  });

  it('an X7 (pickup with reported strokes) and a DNF also rank worst, tying with each other', () => {
    const f = fixture();
    const cards = f.onHole(f.unplayed, 1, [{ kind: 'picked-up', reportedStrokes: 7 }, { kind: 'did-not-finish' }, strokes(6)]);
    expect(f.holePoints(cards, 1).points).toEqual([2, 2, 5]);
  });

  it('three pickups share the hole: 3 / 3 / 3', () => {
    const f = fixture();
    const cards = f.onHole(f.unplayed, 1, [{ kind: 'picked-up' }, { kind: 'picked-up' }, { kind: 'did-not-finish' }]);
    expect(f.holePoints(cards, 1).points).toEqual([3, 3, 3]);
  });

  it('a hole stays pending until all three golfers have saved a score', () => {
    const f = fixture();
    const cards = f.onHole(f.unplayed, 1, [strokes(3), strokes(4), { kind: 'unplayed' }]);
    expect(f.holePoints(cards, 1)).toEqual({ status: 'pending', points: [undefined, undefined, undefined] });
    const player = f.result(cards).players[0];
    expect(player).toMatchObject({ status: 'in-progress', holesScored: 0, totalPoints: null });
  });
});

describe('Nines gross and net', () => {
  it('gross ignores handicaps', () => {
    const f = fixture(['0', '18.0', '36.0']);
    expect(f.holePoints(f.onHole(f.unplayed, 1, [strokes(4), strokes(5), strokes(6)]), 1).points).toEqual([5, 3, 1]);
  });

  it('net with full Course Handicap uses each golfer\'s strokes on the hole', () => {
    // On 9 holes these indexes give Course Handicaps 0, 9 and 18, so hole 1 (the hardest) gives
    // 0, 1 and 2 strokes. Gross 4 / 5 / 6 becomes net 4 / 4 / 4: a three-way tie.
    const f = fixture(['0', '18.0', '36.0']);
    const net: NinesGameDefinition = { ...f.game, basis: 'net', handicapRule: 'full-course-v1' };
    const cards = f.onHole(f.unplayed, 1, [strokes(4), strokes(5), strokes(6)]);
    const players = f.result(cards, net).players;
    expect(players.map((player) => player.playingHandicap)).toEqual([0, 9, 18]);
    expect(players.map((player) => player.holes[0]?.strokesReceived)).toEqual([0, 1, 2]);
    expect(f.holePoints(cards, 1, net).points).toEqual([3, 3, 3]);
  });

  it('net with strokes off the low golfer gives the lowest handicap no strokes', () => {
    const f = fixture(['10.0', '10.0', '20.0']);
    const strokesOff: NinesGameDefinition = { ...f.game, basis: 'net', handicapRule: 'group-low-v1' };
    const full: NinesGameDefinition = { ...f.game, basis: 'net', handicapRule: 'full-course-v1' };
    const players = f.result(f.unplayed, strokesOff).players;
    expect(players.map((player) => player.playingHandicap)).toEqual([0, 0,
      (f.result(f.unplayed, full).players[2]?.playingHandicap ?? 0) - (f.result(f.unplayed, full).players[0]?.playingHandicap ?? 0)]);
  });

  it('net without a usable handicap is unavailable, never treated as scratch', () => {
    const f = fixture();
    const snapshot = { ...f.snapshot, players: f.snapshot.players.map((player, index) => index === 0
      ? { ...player, handicapIndex: null } : player) };
    const net: NinesGameDefinition = { ...f.game, basis: 'net', handicapRule: 'full-course-v1' };
    const [result] = calculateGameResults([net], snapshot, f.onHole(f.unplayed, 1, [strokes(3), strokes(4), strokes(5)]));
    expect(result?.nines?.holes[0]?.status).toBe('unavailable');
    expect(result?.players[0]).toMatchObject({ status: 'unavailable', totalPoints: null });
  });
});

describe('Nines totals and setup', () => {
  it('adds up points over the round, with front and back nines', () => {
    const f = fixture();
    let cards = f.unplayed;
    for (let number = 1; number <= 9; number++) cards = f.onHole(cards, number, [strokes(3), strokes(4), strokes(5)]);
    const players = f.result(cards).players;
    expect(players.map((player) => player.totalPoints)).toEqual([45, 27, 9]);
    expect(players.map((player) => player.status)).toEqual(['complete', 'complete', 'complete']);
    expect(players[0]).toMatchObject({ frontPoints: 45, backPoints: null, holesScored: 9, totalHoles: 9 });
  });

  it('only scores the saved group of exactly three; a changed group is stale, not silently re-ranked', () => {
    const f = fixture();
    expect(ninesGroupMatches(f.game, f.snapshot.groups)).toBe(true);
    const changed = { ...f.game, playerIds: [f.ids[0] ?? '', f.ids[1] ?? '', strokeGameId(999)] };
    const result = calculateNines(changed, [], f.unplayed, f.snapshot.groups);
    expect(result.nines?.status).toBe('stale-group');
    expect(ninesGroupMatches(f.game, [{ number: 1, playerIds: f.ids.slice(0, 2) }])).toBe(false);
  });
});

describe('Nines money', () => {
  function playedRound(f: ReturnType<typeof fixture>) {
    let cards = f.unplayed;
    for (let number = 1; number <= 9; number++) cards = f.onHole(cards, number, [strokes(3), strokes(4), strokes(5)]);
    return cards;
  }
  const name = (playerId: string) => `Golfer ${playerId.slice(-1)}`;

  it('settles the point differences once at the stake: 45 / 27 / 9 points at $1 a point', () => {
    const f = fixture();
    const game = { ...f.game, stakeMinor: 100 };
    const settlement = calculateNinesSettlement(game, f.result(playedRound(f), game), name);
    // Each golfer's net is (3 x their points - 81 total) x $1.00.
    expect(settlement.status).toBe('complete');
    expect(settlement.players.map((player) => player.netMinor)).toEqual([5400, 0, -5400]);
    expect(settlement.totalToSettleMinor).toBe(5400);
    expect(settlement.pairwise.map((entry) => entry.amountMinor)).toEqual([1800, 3600, 1800]);
  });

  it('a blank stake plays for points only, and an unfinished round is a projection', () => {
    const f = fixture();
    expect(calculateNinesSettlement(f.game, f.result(playedRound(f)), name).status).toBe('points-only');
    const game = { ...f.game, stakeMinor: 100 };
    const partial = f.onHole(f.unplayed, 1, [strokes(3), strokes(4), strokes(5)]);
    expect(calculateNinesSettlement(game, f.result(partial, game), name).status).toBe('projected');
  });

  it('a stale group never settles money', () => {
    const f = fixture();
    const game = { ...f.game, stakeMinor: 100, playerIds: [f.ids[0] ?? '', f.ids[1] ?? '', strokeGameId(999)] };
    expect(calculateNinesSettlement(game, calculateNines(game, [], f.unplayed, f.snapshot.groups), name).status)
      .toBe('unavailable');
  });

  it('treats any change to stake, basis, handicap rule, group or golfers as a different game', () => {
    const f = fixture();
    expect(sameNinesDefinition(f.game, { ...f.game })).toBe(true);
    for (const changed of [{ stakeMinor: 50 }, { basis: 'net' as const }, { handicapRule: 'group-low-v1' as const },
      { groupNumber: 2 }, { playerIds: [...f.ids].reverse() }, { name: 'Renamed' }]) {
      expect(sameNinesDefinition(f.game, { ...f.game, ...changed })).toBe(false);
    }
  });
});
