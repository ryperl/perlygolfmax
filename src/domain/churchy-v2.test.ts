import { describe, expect, it } from 'vitest';
import { calculateChurchyResults, churchySpecialsMatchGame, emptyChurchySpecials, sameChurchySpecials } from './churchy.js';
import { churchyFixture } from './churchy.test-support.js';
import { churchyV2Fixture } from './churchy-v2.test-support.js';
import { strokeGameCards, strokeGameId } from './stroke-games.test-support.js';
import { calculateGameResults } from './stableford.js';
import { sameGameDefinitions } from './games.js';
import type { HoleScore } from './scoring.js';

describe('Churchy version 2 independent awards and money', () => {
  it('shares each exact Birdie/Eagle independently with the current partner, without doubling an Eagle', () => {
    const f = churchyV2Fixture();
    const cards = strokeGameCards(f.cards, 1, [{ kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 2 }]);
    const result = calculateGameResults([f.game], f.snapshot, cards)[0];
    expect(result?.version).toBe(2);
    expect(result?.churchy?.holes[0]?.specials).toEqual([
      { special: 'Sweep', playerId: null, outcome: 'made', winners: f.game.playerIds.slice(0, 2), dots: 1 },
      { special: 'Birdie', playerId: f.game.playerIds[0], outcome: 'made', winners: f.game.playerIds.slice(0, 2), dots: 2 },
      { special: 'Eagle', playerId: f.game.playerIds[1], outcome: 'made', winners: f.game.playerIds.slice(0, 2), dots: 4 },
    ]);
    expect(result?.players.map((player) => player.totalPoints)).toEqual([9, 9, 0, 0]);
    expect(calculateGameResults([churchyFixture().game], f.snapshot, cards)[0]?.players.map((player) => player.totalPoints))
      .toEqual([4, 4, 0, 0]);
  });

  it('counts repeated Sandys at exact par only and shares teammates’ separate Sandy/Other/Sticky achievements once each', () => {
    const f = churchyV2Fixture();
    const cards = strokeGameCards(f.cards, 1, [
      { kind: 'strokes', strokes: 4, churchy: { ...f.extras, sandyCount: 3, pully: true, sticky: true, otherDots: 2 } },
      { kind: 'strokes', strokes: 4, churchy: { ...f.extras, sandyCount: 2, otherDots: 3 } },
    ]);
    const result = calculateGameResults([f.game], f.snapshot, cards)[0];
    expect(result?.players.map((player) => player.totalPoints)).toEqual([12, 12, 0, 0]);
    expect(result?.churchy?.internalSettlement?.players[0]).toMatchObject({ baseDots: 0, specialDots: 12, totalDots: 12 });
    const birdie = calculateGameResults([f.game], f.snapshot,
      strokeGameCards(cards, 1, [{ kind: 'strokes', strokes: 3, churchy: { ...f.extras, sandyCount: 5, pully: true } }]))[0];
    expect(birdie?.churchy?.holes[0]?.specials).toContainEqual(expect.objectContaining({ special: 'Sandy', outcome: 'ineligible', dots: 0 }));
    expect(birdie?.churchy?.holes[0]?.specials).toContainEqual(expect.objectContaining({ special: 'Pully', outcome: 'made', dots: 1 }));
  });

  it.each(['unplayed', 'picked-up', 'did-not-finish'] as const)(
    'keeps scorer-decided Sticky/Other known for %s without inventing score-dependent awards', (kind) => {
      const f = churchyV2Fixture();
      const blank = f.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'unplayed' as const } })) }));
      const cards = strokeGameCards(blank, 1, [{ kind, churchy: { ...f.extras, sticky: true, otherDots: 2,
        paree: true, murphy: true, murphyPresses: 2, sandyCount: 2, pully: true } }]);
      const result = calculateGameResults([f.game], f.snapshot, cards)[0];
      expect(result?.churchy?.holes[0]).toMatchObject({ high: { status: 'pending', dots: null },
        low: { status: 'pending', dots: null }, dotStatus: 'partial' });
      expect(result?.churchy?.holes[0]?.specials.filter((award) => award.outcome === 'made').map((award) => award.special))
        .toEqual(['Sticky', 'Other']);
      expect(result?.players.slice(0, 2).map((player) => player.totalPoints)).toEqual([3, 3]);
      expect(result?.churchy?.internalSettlement?.status).toBe(kind === 'unplayed' ? 'pending' : 'projected');
      if (kind === 'unplayed') expect(result?.churchy?.holes[0]?.specials.map((award) => award.special)).toEqual(['Sticky', 'Other']);
      else expect(result?.churchy?.holes[0]?.specials).toContainEqual(expect.objectContaining({ special: 'Murphy', outcome: 'missed', dots: 3 }));
    },
  );

  it('preserves legacy unplayed-special skipping, par-or-better calls and 1/2/3 Murphy stages', () => {
    const old = churchyFixture(9);
    const cards = strokeGameCards(old.cards, 1, [{ kind: 'unplayed', churchy: { ...old.extras, paree: true } }]);
    expect(calculateGameResults([old.game], old.snapshot, cards)[0]?.churchy?.holes[0]?.specials).toEqual([]);
    const f = churchyV2Fixture();
    for (const stage of [0, 1, 2] as const) {
      const result = calculateGameResults([f.game], f.snapshot, strokeGameCards(f.cards, 1, [
        { kind: 'strokes', strokes: 3, churchy: { ...f.extras, paree: true, murphy: true, murphyPresses: stage } },
      ]))[0];
      expect(result?.churchy?.holes[0]?.specials).toContainEqual(expect.objectContaining({ special: 'Murphy', outcome: 'made', dots: 1 + stage }));
    }
  });

  it('settles exact cents with the new bilateral formula, split base/special sources, and supports points-only', () => {
    const f = churchyV2Fixture();
    const cards = strokeGameCards(f.cards, 1, [{ kind: 'strokes', strokes: 3 }]);
    const result = calculateGameResults([{ ...f.game, amountPerDotMinor: 50 }], f.snapshot, cards)[0];
    expect(result?.churchy?.internalSettlement).toMatchObject({ status: 'complete', totalToSettleMinor: 600,
      players: [
        { baseDots: 1, specialDots: 2, totalDots: 3, netMinor: 300 },
        { baseDots: 1, specialDots: 2, totalDots: 3, netMinor: 300 },
        { baseDots: 0, specialDots: 0, totalDots: 0, netMinor: -300 },
        { baseDots: 0, specialDots: 0, totalDots: 0, netMinor: -300 },
      ] });
    expect(result?.churchy?.settlement.map((entry) => [entry.paysMinor, entry.collectsMinor]))
      .toEqual([[0, 300], [0, 300], [300, 0], [300, 0]]);
    expect(calculateGameResults([{ ...f.game, amountPerDotMinor: 0 }], f.snapshot, cards)[0]?.churchy?.internalSettlement?.status)
      .toBe('points-only');
    const zero = calculateGameResults([f.game], f.snapshot, f.cards)[0];
    expect(zero?.churchy?.internalSettlement).toMatchObject({ status: 'complete', totalToSettleMinor: 0 });
    expect(zero?.players.map((player) => player.totalPoints)).toEqual([0, 0, 0, 0]);
  });

  it('retains numeric-block partner rotation, independent turn carries, current-stake Sweep and personal captured inputs', () => {
    const f = churchyV2Fixture(18);
    const result = calculateGameResults([f.game], f.snapshot,
      strokeGameCards(f.cards, 10, [{ kind: 'strokes', strokes: 2 }, { kind: 'strokes', strokes: 3 }]))[0];
    expect(result?.churchy?.holes[9]).toMatchObject({ stake: 1, high: { dots: 19, carry: 0 }, low: { dots: 19, carry: 0 },
      pairs: [f.game.playerIds.slice(0, 2), f.game.playerIds.slice(2)] });
    expect(result?.churchy?.holes[9]?.specials).toContainEqual(expect.objectContaining({ special: 'Sweep', dots: 1 }));
    expect(result?.players.map((player) => player.totalPoints)).toEqual([45, 45, 0, 0]);
    const inputs = f.snapshot.players.map((player, index) => ({ playerId: player.playerId, displayName: player.displayName,
      handicap: [-2, 7, 0, 0][index] ?? 0,
      layout: index === 0 ? f.snapshot.teeProfile.holes.map((hole) => ({ ...hole, par: 3 })) : f.snapshot.teeProfile.holes }));
    const personal = calculateChurchyResults(f.game, inputs, strokeGameCards(f.cards, 1, [{ kind: 'strokes', strokes: 2 }]));
    expect(personal.players.map((player) => player.playingHandicap)).toEqual([0, 9, 2, 2]);
    expect(personal.churchy?.holes[0]?.specials).toContainEqual(expect.objectContaining({ special: 'Birdie', dots: 2 }));
    expect(personal.churchy?.holes[0]?.specials.some((award) => award.special === 'Eagle')).toBe(false);
  });

  it('leaves absent cards, missing captured inputs and unsupported partial comparisons explicit', () => {
    const f = churchyV2Fixture();
    expect(calculateGameResults([f.game], f.snapshot, f.cards.slice(1))[0]?.churchy?.status).toBe('in-progress');
    const inputs = f.snapshot.players.map((player, index) => ({ playerId: player.playerId, displayName: player.displayName,
      layout: f.snapshot.teeProfile.holes, handicap: index === 0 ? null : 0 }));
    expect(calculateChurchyResults(f.game, inputs, f.cards).churchy?.internalSettlement?.status).toBe('unavailable');
    const scores: readonly HoleScore[] = [{ kind: 'picked-up', reportedStrokes: 7 }, { kind: 'strokes', strokes: 3 },
      { kind: 'did-not-finish' }, { kind: 'strokes', strokes: 4 }];
    expect(calculateGameResults([f.game], f.snapshot, strokeGameCards(f.cards, 1, scores))[0]?.churchy?.status).toBe('unavailable');
  });

  it('rejects malformed or overflowing counts and money without coercing them to zero', () => {
    const f = churchyV2Fixture();
    for (const otherDots of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
      expect(churchySpecialsMatchGame({ ...f.extras, otherDots }, f.game)).toBe(false);
      expect(calculateGameResults([f.game], f.snapshot, strokeGameCards(f.cards, 1, [
        { kind: 'strokes', strokes: 4, churchy: { ...f.extras, otherDots } },
      ]))[0]?.churchy?.status).toBe('unavailable');
    }
    const overflow = calculateGameResults([f.game], f.snapshot, strokeGameCards(f.cards, 1, [
      { kind: 'strokes', strokes: 4, churchy: { ...f.extras, otherDots: Number.MAX_SAFE_INTEGER, sticky: true } },
    ]))[0];
    expect(overflow?.players[0]?.holes[0]?.points).toBeNull();
    expect(overflow?.players[0]?.totalPoints).toBeNull();
    expect(overflow?.churchy?.status).toBe('unavailable');
    expect(overflow?.churchy?.internalSettlement?.status).toBe('unavailable');
    expect(overflow?.churchy?.internalSettlement?.players[0]).toMatchObject({ specialDots: null, totalDots: null, netMinor: null });
    expect(calculateGameResults([{ ...f.game, amountPerDotMinor: Number.MAX_SAFE_INTEGER }], f.snapshot,
      strokeGameCards(f.cards, 1, [{ kind: 'strokes', strokes: 3 }]))[0]?.churchy?.internalSettlement?.status).toBe('unavailable');
    let large = f.cards;
    for (const hole of [1, 2]) large = strokeGameCards(large, hole, [{ kind: 'strokes', strokes: 4,
      churchy: { ...f.extras, otherDots: Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1 } }]);
    const totalOverflow = calculateGameResults([f.game], f.snapshot, large)[0];
    expect(totalOverflow?.players[0]?.holes[0]?.points).toBe(Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1);
    expect(totalOverflow?.players[0]?.totalPoints).toBeNull();
    expect(totalOverflow?.churchy?.status).toBe('unavailable');
  });

  it('binds declarations and equality to rules version and enabled selections without converting v1', () => {
    const f = churchyV2Fixture();
    const old = churchyFixture(9);
    expect(emptyChurchySpecials(old.game, old.extras.gameEtag)).toEqual(old.extras);
    expect(emptyChurchySpecials(f.game, f.extras.gameEtag)).toEqual(f.extras);
    expect(churchySpecialsMatchGame(old.extras, f.game)).toBe(false);
    expect(churchySpecialsMatchGame(f.extras, old.game)).toBe(false);
    expect(churchySpecialsMatchGame({ ...f.extras, gameId: strokeGameId(999) }, f.game)).toBe(false);
    const disabled = { ...f.game, enabledSpecials: [] };
    expect(churchySpecialsMatchGame({ ...f.extras, otherDots: 5 }, disabled)).toBe(true);
    expect(churchySpecialsMatchGame({ ...f.extras, sticky: true }, disabled)).toBe(false);
    expect(churchySpecialsMatchGame({ ...f.extras, sandyCount: 1 }, disabled)).toBe(false);
    expect(sameChurchySpecials(old.extras, f.extras)).toBe(false);
    expect(sameChurchySpecials(f.extras, { ...f.extras })).toBe(true);
    expect(sameChurchySpecials(f.extras, { ...f.extras, sandyCount: 1 })).toBe(false);
    expect(sameChurchySpecials(f.extras, { ...f.extras, otherDots: 1 })).toBe(false);
    expect(sameGameDefinitions([old.game], [f.game])).toBe(false);
    expect(sameGameDefinitions([f.game], [disabled])).toBe(false);
    expect(sameGameDefinitions([f.game], [{ ...f.game, enabledSpecials: [...f.game.enabledSpecials].reverse() }])).toBe(true);
    expect(calculateGameResults([disabled], f.snapshot, strokeGameCards(f.cards, 1, [{ kind: 'strokes', strokes: 2 }]))[0]
      ?.churchy?.holes[0]?.specials).toEqual([]);
  });

  it('calculates independent foursomes without sharing awards or money across groups', () => {
    const f = churchyV2Fixture();
    const second = { ...f.game, id: strokeGameId(703), groupNumber: 2, playerIds: f.cards.slice(4).map((card) => card.playerId) };
    const cards = strokeGameCards(f.cards, 1, [{ kind: 'strokes', strokes: 3 }]);
    const results = calculateGameResults([f.game, second], f.snapshot, cards);
    expect(results[0]?.players.map((player) => player.totalPoints)).toEqual([3, 3, 0, 0]);
    expect(results[1]?.players.map((player) => player.totalPoints)).toEqual([0, 0, 0, 0]);
    expect(results[1]?.churchy?.internalSettlement).toMatchObject({ groupNumber: 2, gameIds: [second.id], totalToSettleMinor: 0 });
  });
});
