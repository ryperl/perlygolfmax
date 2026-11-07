import { describe, expect, it } from 'vitest';
import { calculateGameResults, stablefordPoints } from './stableford.js';
import { ballDropFormat, strokeGameCards, strokeGameFixture } from './stroke-games.test-support.js';
import type { HoleScore } from './scoring.js';
import { maximumExactHoleStrokes } from './scoring.js';
import { gameResultTotal } from './games.js';

const numeric = (values: readonly number[]): readonly HoleScore[] => values.map((strokes) => ({ kind: 'strokes', strokes }));

describe('Ball Drop captured stroke competition', () => {
  it.each([
    ['ball-drop-net-gross', -3], ['ball-drop-two-net', -6], ['ball-drop-two-gross', 1],
  ] as const)('optimizes distinct golfers for %s, not independent greedy minima', (format, expected) => {
    const f = strokeGameFixture(18);
    const indices = ['72', '0', '72', '0'];
    const snapshot = { ...f.snapshot, players: f.snapshot.players.map((player, index) => ({
      ...player, handicapIndex: { ...player.handicapIndex, value: indices[index] ?? '0' },
    })) };
    const cards = strokeGameCards(f.cards, 1, numeric([4, 5, 6, 7]));
    const result = calculateGameResults([ballDropFormat(f.ballDrop, format)], snapshot, cards)[0];
    const hole = result?.teams?.[0]?.strokeGame?.holes[0];
    expect(hole?.value).toBe(expected);
    expect(new Set(hole?.countingPlayerIds).size).toBe(2);
    if (format === 'ball-drop-net-gross') {
      expect(hole?.countingPlayerIds).toEqual([f.cards[0]?.playerId, f.cards[1]?.playerId]);
      expect(hole?.value).not.toBe(-4);
    }
    expect(result?.teams?.[0]?.totalPoints).toBeNull();
  });

  it('uses scratch, plus and each personal tee at 100%, leaving Stableford 95% unchanged', () => {
    const f = strokeGameFixture(18);
    const snapshot = { ...f.snapshot,
      players: f.snapshot.players.map((player, index) => ({ ...player, handicapIndex: {
        ...player.handicapIndex, value: ['19', '+2', '0', '0'][index] ?? '0',
      } })),
      playerTees: [{ playerId: f.snapshot.players[0]?.playerId ?? '', profile: {
        ...f.snapshot.teeProfile, holes: f.snapshot.teeProfile.holes.map((hole) => ({ ...hole, par: hole.number === 1 ? 5 : hole.par })),
        totalPar: 73, ratings: f.snapshot.teeProfile.ratings.map((rating) => ({ ...rating, course: rating.type === 'Total' ? 73 : rating.course })),
      } }],
    };
    const legacy = { id: f.skins.id, name: 'Fictional Stableford', preset: 'standard' as const, basis: 'net' as const,
      handicapAllowancePercent: 95, points: stablefordPoints('standard') };
    const results = calculateGameResults([f.ballDrop, legacy], snapshot, f.cards);
    expect(results[0]?.players.map((player) => player.playingHandicap)).toEqual([19, -2, 0, 0]);
    expect(results[1]?.players[0]?.playingHandicap).toBe(18);
    expect(results[0]?.players[0]?.strokeGame?.holes[0]).toMatchObject({ par: 5, grossToPar: -1, netToPar: -3 });
    expect(results[0]?.players[1]?.strokeGame?.holes[17]?.netToPar).toBe(1);
  });

  it('waits for all saved dispositions, excludes X7/DNF, and is unavailable without two numeric balls', () => {
    const f = strokeGameFixture();
    let cards = strokeGameCards(f.cards, 1, [{ kind: 'picked-up', reportedStrokes: 7 }, { kind: 'did-not-finish' },
      { kind: 'strokes', strokes: 3 }, { kind: 'unplayed' }]);
    expect(calculateGameResults([f.ballDrop], f.snapshot, cards)[0]?.teams?.[0]?.strokeGame?.holes[0]?.status).toBe('pending');
    cards = strokeGameCards(cards, 1, [{ kind: 'picked-up', reportedStrokes: 7 }, { kind: 'did-not-finish' },
      { kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 5 }]);
    expect(calculateGameResults([f.ballDrop], f.snapshot, cards)[0]?.teams?.[0]?.strokeGame?.holes[0]?.value).toBe(0);
    cards = strokeGameCards(cards, 1, [{ kind: 'picked-up', reportedStrokes: 7 }, { kind: 'did-not-finish' },
      { kind: 'picked-up' }, { kind: 'strokes', strokes: 5 }]);
    expect(calculateGameResults([f.ballDrop], f.snapshot, cards)[0]?.teams?.[0]).toMatchObject({
      status: 'unavailable', strokeGame: { unavailableReason: 'invalid-stroke-score' },
    });
  });

  it('keeps missing net inputs and stale roster assignments unavailable, never zero', () => {
    const f = strokeGameFixture();
    const missing = { ...f.snapshot, players: f.snapshot.players.map((player, index) => index ? player : { ...player, handicapIndex: null }) };
    expect(calculateGameResults([f.ballDrop], missing, f.cards)[0]?.teams?.[0]?.status).toBe('unavailable');
    expect(calculateGameResults([ballDropFormat(f.ballDrop, 'ball-drop-two-gross')], missing, f.cards)[0]?.teams?.[0]?.status).toBe('complete');
    expect(calculateGameResults([f.ballDrop], { ...f.snapshot, players: f.snapshot.players.slice(1) }, f.cards)[0])
      .toMatchObject({ teams: [], teamSetupRequired: true });
  });

  it('preserves the maximum stroke input and reports overflow rather than rounding a two-ball total', () => {
    const f = strokeGameFixture(18);
    const cards = f.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'strokes' as const, strokes: maximumExactHoleStrokes },
    })) }));
    const team = calculateGameResults([ballDropFormat(f.ballDrop, 'ball-drop-two-gross')], f.snapshot, cards)[0]?.teams?.[0];
    expect(team).toMatchObject({ status: 'unavailable', strokeGame: { total: null, unavailableReason: 'arithmetic-range' } });
    expect(team?.strokeGame?.holes[0]?.value).toBe(2 * (maximumExactHoleStrokes - 4));
  });
});

describe('Skins round-wide awards', () => {
  it.each([false, true])('counts consecutive ties with carryovers %s and leaves final tied skins unawarded', (carryovers) => {
    const f = strokeGameFixture();
    let cards = strokeGameCards(f.cards, 1, numeric([3, 3, 5, 6]));
    cards = strokeGameCards(cards, 2, numeric([4, 4, 5, 6]));
    cards = strokeGameCards(cards, 3, numeric([5, 4, 6, 7]));
    const result = calculateGameResults([{ ...f.skins, carryovers }], f.snapshot, cards)[0];
    expect(result?.players.map(gameResultTotal)).toEqual([0, carryovers ? 3 : 1, 0, 0]);
    expect(result?.unawardedSkins).toBe(carryovers ? 6 : 8);
    expect(result?.pendingSkins).toBe(0);
    expect(result?.players.every((player) => player.status === 'complete')).toBe(true);
  });

  it('blocks later carry awards behind an earlier unknown; resolving it changes the later prize', () => {
    const f = strokeGameFixture();
    let cards = strokeGameCards(f.cards, 1, [{ kind: 'unplayed' }, ...numeric([3, 5, 6])]);
    cards = strokeGameCards(cards, 2, numeric([5, 4, 6, 7]));
    const pending = calculateGameResults([f.skins], f.snapshot, cards)[0];
    expect(pending?.players.map(gameResultTotal)).toEqual([null, null, null, null]);
    expect(pending?.pendingSkins).toBe(9);
    expect(pending?.unawardedSkins).toBe(0);
    const noCarry = calculateGameResults([{ ...f.skins, carryovers: false }], f.snapshot, cards)[0];
    expect(noCarry?.players[1]?.strokeGame?.holes[1]?.value).toBe(1);
    const tied = calculateGameResults([f.skins], f.snapshot, strokeGameCards(cards, 1, numeric([3, 3, 5, 6])))[0];
    expect(tied?.players[1]?.strokeGame?.holes[1]?.value).toBe(2);
    const won = calculateGameResults([f.skins], f.snapshot, strokeGameCards(cards, 1, numeric([2, 3, 5, 6])))[0];
    expect(won?.players[0]?.strokeGame?.total).toBe(1);
    expect(won?.players[1]?.strokeGame?.holes[1]?.value).toBe(1);
  });

  it('excludes picked-up reported strokes and DNF but resolves known zero wins', () => {
    const f = strokeGameFixture();
    const cards = strokeGameCards(f.cards, 1, [{ kind: 'picked-up', reportedStrokes: 7 }, { kind: 'did-not-finish' },
      { kind: 'strokes', strokes: 8 }, { kind: 'strokes', strokes: 9 }]);
    const result = calculateGameResults([f.skins], f.snapshot, cards)[0];
    expect(result?.players[2]?.strokeGame?.holes[0]?.value).toBe(1);
    expect(result?.players[0]?.strokeGame?.total).toBe(0);
    expect(result?.players[0]?.status).toBe('complete');
  });

  it('compares net strokes, not net-to-par, on personal tees and fails closed on missing net data', () => {
    const f = strokeGameFixture(18);
    const snapshot = { ...f.snapshot, players: f.snapshot.players.map((player, index) => ({
      ...player, handicapIndex: { ...player.handicapIndex, value: index === 0 ? '10' : '0' },
    })), playerTees: [{ playerId: f.snapshot.players[1]?.playerId ?? '', profile: {
      ...f.snapshot.teeProfile, totalPar: 73, holes: f.snapshot.teeProfile.holes.map((hole) => ({ ...hole, par: hole.number === 1 ? 5 : 4 })),
    } }] };
    const cards = strokeGameCards(f.cards, 1, numeric([4, 4, 5, 6]));
    const result = calculateGameResults([{ ...f.skins, basis: 'net' }], snapshot, cards)[0];
    expect(result?.players[0]?.playingHandicap).toBe(10);
    expect(result?.players[0]?.strokeGame?.holes[0]?.value).toBe(1);
    const missing = { ...snapshot, players: snapshot.players.map((player, index) => index ? player : { ...player, handicapIndex: null }) };
    const blocked = calculateGameResults([{ ...f.skins, basis: 'net' }], missing, cards)[0];
    expect(blocked?.players.every((player) => player.status === 'unavailable')).toBe(true);
    expect(blocked?.players.map(gameResultTotal)).toEqual([null, null, null, null]);
  });
});
