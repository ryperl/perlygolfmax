import { describe, expect, it } from 'vitest';
import { calculateChurchyResults, churchyPairs, churchySettlement } from './churchy.js';
import { churchyFixture } from './churchy.test-support.js';
import { strokeGameCards } from './stroke-games.test-support.js';
import { calculateGameResults } from './stableford.js';
import type { HoleScore, Scorecard } from './scoring.js';

describe('Churchy earned dots, independent carries and shared pot', () => {
  it('uses explicit three-block partner rotation, repeating after the turn', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(churchyPairs(ids, 1)).toEqual([['a', 'b'], ['c', 'd']]);
    expect(churchyPairs(ids, 4)).toEqual([['a', 'c'], ['b', 'd']]);
    expect(churchyPairs(ids, 7)).toEqual([['a', 'd'], ['b', 'c']]);
    for (let hole = 1; hole <= 9; hole++) expect(churchyPairs(ids, hole + 9)).toEqual(churchyPairs(ids, hole));
  });
  it('subtracts lowest captured Course Handicap without changing other games; plus and personal allocations work', () => {
    const f = churchyFixture();
    const inputs = f.snapshot.players.map((player, index) => ({ playerId: player.playerId,
      displayName: player.displayName, layout: f.snapshot.teeProfile.holes, handicap: [10, 8, 4, 4, 0, 0, 0, 0][index] ?? 0 }));
    const results = calculateChurchyResults(f.game, inputs, f.cards);
    expect(results.players.map((player) => player.playingHandicap)).toEqual([6, 4, 0, 0]);
    expect(results.players[0]?.holes.reduce((sum, hole) => sum + (hole.strokesReceived ?? 0), 0)).toBe(6);
    const plus = calculateChurchyResults(f.game, inputs.map((input, index) => ({ ...input, handicap: index ? 2 : -2,
      layout: index === 1 ? [...input.layout].reverse().map((hole, i) => ({ ...hole, allocation: i + 1 })) : input.layout })), f.cards);
    expect(plus.players.map((player) => player.playingHandicap)).toEqual([0, 4, 4, 4]);
    expect(plus.players[1]?.holes[0]?.strokesReceived).toBe(0);
  });
  it('carries both lanes through partner changes and turn; sweep is current stake only; ties leave final carries unawarded', () => {
    const f = churchyFixture();
    const scores = strokeGameCards(f.cards, 10, [{ kind: 'strokes', strokes: 2 }, { kind: 'strokes', strokes: 3 }]);
    const result = calculateGameResults([f.game], f.snapshot, scores)[0];
    expect(result?.churchy?.holes[9]).toMatchObject({ stake: 1, high: { dots: 19, carry: 0 }, low: { dots: 19, carry: 0 } });
    expect(result?.churchy?.holes[9]?.specials).toContainEqual(expect.objectContaining({ special: 'Sweep', dots: 1 }));
    expect(result?.players.map((player) => player.totalPoints)).toEqual([40, 40, 0, 0]);
    expect(result?.churchy).toMatchObject({ unawardedHigh: 17, unawardedLow: 17 });
    expect(result?.churchy?.settlement.map((entry) => [entry.paysMinor, entry.collectsMinor])).toEqual([[0, 4000], [0, 4000], [4000, 0], [4000, 0]]);
  });
  it('independent High and Low wins do not sweep or net earned dots', () => {
    const f = churchyFixture();
    const cards = strokeGameCards(f.cards, 1, [3, 6, 4, 5].map((strokes) => ({ kind: 'strokes', strokes })));
    const result = calculateGameResults([f.game], f.snapshot, cards)[0];
    expect(result?.churchy?.holes[0]).toMatchObject({ high: { winners: f.game.playerIds.slice(2), dots: 1 },
      low: { winners: f.game.playerIds.slice(0, 2), dots: 1 } });
    expect(result?.churchy?.holes[0]?.specials.some((award) => award.special === 'Sweep')).toBe(false);
    expect(result?.players.map((player) => player.totalPoints)).toEqual([2, 2, 1, 1]);
  });
  it('earlier unplayed scores block carry awards, never turning unknown into ties', () => {
    const f = churchyFixture();
    let cards = strokeGameCards(f.cards, 1, [{ kind: 'unplayed' }]);
    cards = strokeGameCards(cards, 2, [{ kind: 'strokes', strokes: 2 }, { kind: 'strokes', strokes: 3 }]);
    const result = calculateGameResults([f.game], f.snapshot, cards)[0];
    expect(result?.churchy?.holes[1]).toMatchObject({ high: { status: 'pending', dots: null }, low: { status: 'pending', dots: null } });
    expect(result?.churchy?.holes[1]?.dotStatus).toBe('partial');
    expect(result?.players.map((player) => player.totalPoints)).toEqual([1, 1, 0, 0]);
    expect(result?.churchy?.status).toBe('in-progress');
  });
  it('credits each partner a saved special immediately without fabricating pending main-lane awards or unplayed zero ranks', () => {
    const f = churchyFixture();
    const blank = f.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'unplayed' as const } })) }));
    const cards = strokeGameCards(blank, 1, [{ kind: 'strokes', strokes: 4,
      churchy: { ...f.extras, murphy: true, murphyPresses: 2 } }]);
    const result = calculateGameResults([f.game], f.snapshot, cards)[0];
    expect(result?.players.map((player) => player.totalPoints)).toEqual([3, 3, null, null]);
    expect(result?.churchy?.holes[0]).toMatchObject({ dotStatus: 'partial',
      high: { status: 'pending', dots: null }, low: { status: 'pending', dots: null } });
    expect(result?.churchy?.settlement.every((entry) => entry.paysMinor === null)).toBe(true);
  });
  it('pickup loses High but a numeric partner competes Low; X7 is not completed numeric seven', () => {
    const f = churchyFixture();
    const cards = strokeGameCards(f.cards, 1, [{ kind: 'picked-up', reportedStrokes: 7, churchy: { ...f.extras, paree: true, murphy: true, murphyPresses: 2 } },
      { kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 5 }]);
    const result = calculateGameResults([f.game], f.snapshot, cards)[0];
    expect(result?.churchy?.holes[0]).toMatchObject({ high: { winners: f.game.playerIds.slice(2) },
      low: { winners: f.game.playerIds.slice(0, 2) } });
    expect(result?.churchy?.holes[0]?.specials).toContainEqual(expect.objectContaining({ special: 'Murphy', outcome: 'missed', dots: 3, winners: f.game.playerIds.slice(2) }));
    expect(result?.players.map((player) => player.totalPoints)).toEqual([2, 2, 5, 5]);
  });
  it.each([
    [{ kind: 'picked-up' }, { kind: 'strokes', strokes: 4 }, { kind: 'did-not-finish' }, { kind: 'strokes', strokes: 4 }],
    [{ kind: 'picked-up' }, { kind: 'did-not-finish' }, { kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 4 }],
  ] satisfies readonly HoleScore[][])('leaves unapproved incomplete-pair comparisons unavailable, not tied or penalized: %j', (...scores) => {
    const f = churchyFixture();
    const result = calculateGameResults([f.game], f.snapshot, strokeGameCards(f.cards, 1, scores))[0];
    expect(result?.churchy?.status).toBe('unavailable');
    expect(result?.churchy?.settlement.every((entry) => entry.collectsMinor === null)).toBe(true);
  });
  it('gross special calls stack at one each, Murphy 1/2/3, birdie exactly one under, no eagle', () => {
    const f = churchyFixture();
    let cards: readonly Scorecard[] = f.cards;
    for (const [index, presses] of ([0, 1, 2] as const).entries()) cards = strokeGameCards(cards, index + 1, [{
      kind: 'strokes', strokes: 4, churchy: { ...f.extras, paree: true, murphy: true, murphyPresses: presses, sandy: true, pully: true },
    }]);
    cards = strokeGameCards(cards, 4, [{ kind: 'strokes', strokes: 3, churchy: { ...f.extras, sandy: true, pully: true } }]);
    cards = strokeGameCards(cards, 5, [{ kind: 'strokes', strokes: 2 }]);
    const result = calculateGameResults([f.game], f.snapshot, cards)[0];
    expect(result?.churchy?.holes.slice(0, 3).map((hole) => hole.specials.find((award) => award.special === 'Murphy')?.dots)).toEqual([1, 2, 3]);
    expect(result?.churchy?.holes[0]?.specials.map((award) => award.special)).toEqual(['Paree', 'Murphy', 'Sandy', 'Pully']);
    expect(result?.churchy?.holes[3]?.specials.filter((award) => award.special !== 'Sweep' && award.outcome !== 'ineligible').map((award) => award.special)).toEqual(['Birdie']);
    expect(result?.churchy?.holes[3]?.specials.filter((award) => award.outcome === 'ineligible').map((award) => award.special)).toEqual(['Sandy', 'Pully']);
    expect(result?.churchy?.holes[4]?.specials.filter((award) => award.special !== 'Sweep')).toEqual([]);
  });
  it('distinguishes NH/missing allocation/stale group from scratch, without fabricating dots or money', () => {
    const f = churchyFixture();
    const missing = { ...f.snapshot, players: f.snapshot.players.map((player, index) => index === 0 ? { ...player, handicapIndex: null } : player) };
    expect(calculateGameResults([f.game], missing, f.cards)[0]?.churchy?.status).toBe('unavailable');
    const stale = { ...f.snapshot, groups: [] };
    expect(calculateGameResults([f.game], stale, f.cards)[0]?.churchy?.status).toBe('unavailable');
    expect(calculateGameResults([f.game], { ...f.snapshot, teeProfile: { ...f.snapshot.teeProfile, strokeAllocation: false } }, f.cards)[0]?.churchy?.status).toBe('unavailable');
    expect(calculateGameResults([f.game], f.snapshot, f.cards)[0]?.players.map((player) => player.totalPoints)).toEqual([0, 0, 0, 0]);
  });
  it('settles shared-pot earned dots exactly, not double bilateral transfers; rejects odd/overflow/missing totals', () => {
    expect(churchySettlement([21, 21, 0, 0], 100)).toEqual([2100, 2100, -2100, -2100]);
    expect(churchySettlement([45, 61, 81, 69], 100)).toEqual([-3800, -600, 3400, 1000]);
    expect(churchySettlement([1, 0, 0, 0], 100)).toEqual([null, null, null, null]);
    expect(churchySettlement([null, 0, 0, 0], 100)).toEqual([null, null, null, null]);
    expect(churchySettlement([21, 21, 0, 0], Number.MAX_SAFE_INTEGER)).toEqual([null, null, null, null]);
  });
});
