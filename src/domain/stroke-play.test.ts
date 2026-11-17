import { describe, expect, it } from 'vitest';
import type { StrokePlayGameDefinition } from './games.js';
import { gameResultDirection, gameResultRankValue, gameResultTotal, sameGameDefinitions } from './games.js';
import { calculateGameResults } from './stableford.js';
import { maximumExactHoleStrokes } from './scoring.js';
import { strokeGameCards, strokeGameFixture, strokeGameId } from './stroke-games.test-support.js';

const game: StrokePlayGameDefinition = {
  id: strokeGameId(702), name: 'Fictional Stroke Play', kind: 'stroke-play', version: 1, basis: 'gross',
};

describe('saved round Stroke Play', () => {
  it('keeps strokes separate from ranking to personal par', () => {
    const f = strokeGameFixture();
    const personal = { ...f.snapshot.teeProfile, totalPar: 45,
      holes: f.snapshot.teeProfile.holes.map((hole) => ({ ...hole, par: 5 })) };
    const snapshot = { ...f.snapshot, playerTees: [{ playerId: f.cards[0]?.playerId ?? '', profile: personal }] };
    const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'strokes' as const, strokes: index === 0 ? 5 : index === 3 ? 5 : 4 },
    })) }));
    const result = calculateGameResults([game], snapshot, cards)[0];
    expect(result?.players.map(gameResultTotal)).toEqual([45, 36, 36, 45]);
    expect(result?.players.map(gameResultRankValue)).toEqual([0, 0, 0, 9]);
    expect(result?.players.every((player) => player.totalPoints === null)).toBe(true);
    expect(gameResultDirection(game)).toBe(1);
    expect(sameGameDefinitions([game], [{ ...game }])).toBe(true);
    expect(sameGameDefinitions([game], [{ ...game, basis: 'net' }])).toBe(false);
  });

  it.each([9, 18] as const)('uses full captured %s-hole Course Handicap, including scratch and plus on personal tees', (count) => {
    const f = strokeGameFixture(count);
    const snapshot = { ...f.snapshot, players: f.snapshot.players.map((player, index) => ({
      ...player, handicapIndex: { ...player.handicapIndex, value: ['19', '+2', '0', '0'][index] ?? '0' },
    })) };
    const results = calculateGameResults([{ ...game, basis: 'net' }], snapshot, f.cards)[0];
    expect(results?.players.map((player) => player.playingHandicap)).toEqual(count === 18 ? [19, -2, 0, 0] : [10, -1, 0, 0]);
    expect(results?.players.map(gameResultTotal)).toEqual(count === 18 ? [53, 74, 72, 72] : [26, 37, 36, 36]);
  });

  it('retains pending partial subtotals, never ranks empty cards, and disqualifies pickup/X7/DNF without penalties', () => {
    const f = strokeGameFixture();
    const pending = f.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'unplayed' as const },
    })) }));
    const cards = strokeGameCards(pending, 1, [{ kind: 'strokes', strokes: 4 }, { kind: 'picked-up', reportedStrokes: 7 },
      { kind: 'did-not-finish' }, { kind: 'unplayed' }]);
    const result = calculateGameResults([game], f.snapshot, cards)[0];
    expect(result?.players[0]).toMatchObject({ status: 'in-progress', holesScored: 1,
      strokeGame: { total: 4, relativeToPar: 0 } });
    expect(result?.players.slice(1, 3).map((player) => player.strokeGame)).toEqual([
      expect.objectContaining({ total: null, unavailableReason: 'invalid-stroke-score' }),
      expect.objectContaining({ total: null, unavailableReason: 'invalid-stroke-score' }),
    ]);
    expect(result?.players[3]).toMatchObject({ status: 'in-progress', holesScored: 0,
      strokeGame: { total: null, relativeToPar: null } });
    const disqualified = calculateGameResults([game], f.snapshot,
      strokeGameCards(f.cards, 1, [{ kind: 'picked-up', reportedStrokes: 7 }]))[0]?.players[0];
    expect(disqualified).toMatchObject({ status: 'unavailable', holesScored: 8,
      strokeGame: { total: 32, relativeToPar: 0, unavailableReason: 'invalid-stroke-score' } });
  });

  it('does not replace missing net inputs with scratch and reports exact overflow', () => {
    const f = strokeGameFixture(18);
    const missing = { ...f.snapshot, players: f.snapshot.players.map((player) => ({ ...player, handicapIndex: null })) };
    const result = calculateGameResults([{ ...game, basis: 'net' }], missing, f.cards)[0]?.players[0];
    expect(result).toMatchObject({ status: 'unavailable', holesScored: 18,
      strokeGame: { total: null, relativeToPar: null, unavailableReason: 'missing-handicap-index' } });
    const noAllocation = { ...f.snapshot, teeProfile: { ...f.snapshot.teeProfile, strokeAllocation: false } };
    expect(calculateGameResults([{ ...game, basis: 'net' }], noAllocation, f.cards)[0]?.players[0])
      .toMatchObject({ status: 'unavailable', strokeGame: { unavailableReason: 'missing-stroke-index' } });
    const cards = f.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'strokes' as const, strokes: maximumExactHoleStrokes },
    })) }));
    const plus = { ...f.snapshot, players: f.snapshot.players.map((player) => ({
      ...player, handicapIndex: { ...player.handicapIndex, value: '+54' },
    })) };
    expect(calculateGameResults([{ ...game, basis: 'net' }], plus, cards)[0]?.players[0])
      .toMatchObject({ status: 'unavailable', strokeGame: { total: null, unavailableReason: 'arithmetic-range' } });
  });
});
