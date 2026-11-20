import { describe, expect, it } from 'vitest';
import { churchyFixture } from '../domain/churchy.test-support.js';
import { churchyV2Fixture } from '../domain/churchy-v2.test-support.js';
import { churchyV3Fixture } from '../domain/churchy-v3.test-support.js';
import { isChurchyDefinition } from './churchy.js';
import { ChurchyNamesClientUpdateRequired, churchyNamesRoundScores, requireChurchyNames, requireChurchyNamesInValue } from './churchy-names.js';
import { decodeRoundScores, isRoundScores } from './scoring.js';
import { leanRoundScores } from './lean-round-scores.js';

describe('Churchie custom-name compatibility', () => {
  it('accepts bounded custom names in every unchanged rules version and retains all old literal names', () => {
    for (const game of [churchyFixture().game, churchyV2Fixture().game, churchyV3Fixture().game]) {
      expect(isChurchyDefinition(game)).toBe(true);
      expect(() => { requireChurchyNames([game], false); }).not.toThrow();
      const custom = { ...game, name: 'Fictional group challenge' };
      expect(isChurchyDefinition(custom)).toBe(true);
      expect(() => { requireChurchyNames([custom], false); }).toThrow(ChurchyNamesClientUpdateRequired);
      expect(() => { requireChurchyNames([custom], true); }).not.toThrow();
      for (const name of ['', ' ', 'x'.repeat(101), 'Fictional\nname']) {
        expect(isChurchyDefinition({ ...game, name })).toBe(false);
      }
    }
    expect(() => { requireChurchyNames([{ ...churchyV3Fixture().game, name: 'Churcie' }], false); }).not.toThrow();
  });

  it('round-trips marked full/lean custom names without loosening result coherence or guessing a missing capability', () => {
    const f = churchyV3Fixture();
    const base = f.round();
    if (!base.games) throw new Error('Missing fictional games.');
    const current = { ...base, churchyCustomNames: true as const, games: { ...base.games,
      configuration: { ...base.games.configuration, games: [{ ...f.game, name: 'Fictional custom Churchie' }] } } };
    expect(isRoundScores(current)).toBe(true);
    expect(decodeRoundScores(leanRoundScores(current, false, false, false, false, false, true))).toEqual(current);
    expect(() => churchyNamesRoundScores(current)).toThrow(ChurchyNamesClientUpdateRequired);
    expect(() => leanRoundScores(current, true, true, true, true, true)).toThrow(ChurchyNamesClientUpdateRequired);
    expect(isRoundScores({ ...current, churchyCustomNames: undefined })).toBe(false);
    for (const churchyCustomNames of [false, null, 1, 'true']) {
      expect(isRoundScores({ ...current, churchyCustomNames })).toBe(false);
    }
    expect(isRoundScores({ ...current, games: { ...current.games,
      results: current.games.results.map((result) => ({ ...result, players: result.players.map((player) => ({ ...player, totalPoints: 999 })) })),
    } })).toBe(false);
    expect(churchyNamesRoundScores({ ...base, churchyCustomNames: true })).toEqual(base);
    expect(churchyNamesRoundScores(base, true)).toEqual({ ...base, churchyCustomNames: true });
  });

  it('fences custom names in nested immutable configurations and historical audit evidence without rewriting them', () => {
    const game = { ...churchyV3Fixture().game, name: 'Fictional historical game' };
    const history = { changes: [{ dotAwardAudit: [{ configuration: game }] }] };
    const original = JSON.stringify(history);
    expect(() => { requireChurchyNamesInValue(history); }).toThrow(ChurchyNamesClientUpdateRequired);
    expect(JSON.stringify(history)).toBe(original);
    expect(() => { requireChurchyNamesInValue({ before: [churchyFixture().game], after: [churchyV3Fixture().game] }); }).not.toThrow();
  });
});
