import { describe, expect, it } from 'vitest';
import { isChurchyDefinition, isChurchyResult, isChurchySpecials } from './churchy.js';
import { isHoleScore, isRoundScores } from './scoring.js';
import { isRoundGameDefinitions } from './games.js';
import { churchyFixture } from '../domain/churchy.test-support.js';
import { strokeGameCards } from '../domain/stroke-games.test-support.js';
import type { ChurchyHoleReceipt } from '../domain/churchy.js';

describe('Churchy wire contracts', () => {
  it.each([null, {}, { toString: null }, [], ['complete'], 42].map((malformed) => ({ malformed })))('rejects malformed status/special values without coercing or throwing: %j', ({ malformed }) => {
    const f = churchyFixture();
    const round = f.round(strokeGameCards(f.cards, 1, [{ kind: 'strokes', strokes: 3,
      churchy: { ...f.extras, murphy: true, murphyPresses: 2 } }]));
    const games = round.games;
    if (!games) throw new Error('Missing fictional games');
    const result = games.results[0];
    if (!result?.churchy) throw new Error('Missing fictional Churchy receipt');
    const data = result.churchy;
    const patchHole = (patch: (hole: ChurchyHoleReceipt) => unknown) => ({
      ...result, churchy: { ...data, holes: data.holes.map((hole, index) => index === 0 ? patch(hole) : hole) },
    });
    const invalid = [
      { ...result, churchy: { ...data, status: malformed } },
      patchHole((hole) => ({ ...hole, specialStatus: malformed })),
      patchHole((hole) => ({ ...hole, dotStatus: malformed })),
      patchHole((hole) => ({ ...hole, high: { ...hole.high, status: malformed } })),
      patchHole((hole) => ({ ...hole, low: { ...hole.low, status: malformed } })),
      patchHole((hole) => ({ ...hole, specials: hole.specials.map((award, index) =>
        index === 0 ? { ...award, special: malformed } : award) })),
    ];
    for (const value of invalid) {
      expect(() => isChurchyResult(value, f.game)).not.toThrow();
      expect(isChurchyResult(value, f.game)).toBe(false);
      const response = { ...round, games: { ...games, results: [value, ...games.results.slice(1)] } };
      expect(() => isRoundScores(response)).not.toThrow();
      expect(isRoundScores(response)).toBe(false);
    }
  });
  it('reads enabled and disabled saved definitions without stripping data; results are recomputed', () => {
    const f = churchyFixture();
    const round = f.round(strokeGameCards(f.cards, 1, [{ kind: 'strokes', strokes: 3, churchy: { ...f.extras, murphy: true, murphyPresses: 2 } }]));
    expect(isRoundScores(round)).toBe(true);
    expect(isRoundScores({ ...round, churchyEnabled: false })).toBe(true);
    expect(isRoundGameDefinitions(round.games?.configuration.games)).toBe(true);
    expect(isRoundScores({ ...round, churchyEnabled: 'true' })).toBe(false);
    const result = round.games?.results[0];
    expect(isChurchyResult(result, f.game)).toBe(true);
    if (!result) throw new Error('Missing fictional game');
    const altered = { ...result, players: result.players.map((player) => ({ ...player, totalPoints: 999 })) };
    expect(isRoundScores({ ...round, games: { ...round.games, results: [altered, ...round.games.results.slice(1)] } })).toBe(false);
    expect(isChurchyResult({ ...result, players: [{ playerId: f.game.playerIds[0] }] }, f.game)).toBe(false);
  });
  it('validates foursome, version, fixed game name, money arithmetic inputs and only one Churchy game', () => {
    const f = churchyFixture();
    expect(isChurchyDefinition(f.game)).toBe(true);
    for (const invalid of [{ ...f.game, version: 2 }, { ...f.game, playerIds: f.game.playerIds.slice(1) },
      { ...f.game, playerIds: f.game.playerIds.map(() => f.game.playerIds[0]) }, { ...f.game, amountPerDotMinor: -1 },
      { ...f.game, amountPerDotMinor: 0.1 }, { ...f.game, name: 'Other' }, { ...f.game, points: {} },
      { ...f.game, awards: [] }, { ...f.game, currency: 'EUR' }]) expect(isChurchyDefinition(invalid)).toBe(false);
    expect(isRoundGameDefinitions([f.game, { ...f.game, id: f.skins.id }])).toBe(false);
  });
  it('accepts only named declarations and 0/1/2 Murphy stages, rejecting awarded dots and presses without a call', () => {
    const f = churchyFixture();
    for (const stage of [0, 1, 2]) expect(isChurchySpecials({ ...f.extras, murphy: true, murphyPresses: stage })).toBe(true);
    for (const invalid of [{ ...f.extras, murphyPresses: 1 }, { ...f.extras, murphy: true, murphyPresses: 3 },
      { ...f.extras, birdie: true }, { ...f.extras, dots: 30 }, { ...f.extras, pareePresses: 1 }]) {
      expect(isChurchySpecials(invalid)).toBe(false);
      expect(isHoleScore({ kind: 'strokes', strokes: 4, churchy: invalid })).toBe(false);
    }
    expect(isHoleScore({ kind: 'picked-up', reportedStrokes: 7, churchy: f.extras })).toBe(true);
  });
});
