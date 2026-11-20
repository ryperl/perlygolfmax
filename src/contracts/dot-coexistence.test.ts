import { describe, expect, it } from 'vitest';
import { matchGamesFixture } from '../domain/match-games.test-support.js';
import { coexistenceRoundScores } from './dot-coexistence.js';
import { decodeRoundScores, isRoundScores } from './scoring.js';
import { leanRoundScores } from './lean-round-scores.js';
import { isRecord } from './events.js';

describe('write-only coexistence capability contracts', () => {
  it('accepts optional version 2 in full/lean data without changing calculations or weakening strict decoding', () => {
    const f = matchGamesFixture(), old = { ...f.round(), internalGamesSupported: true };
    const current = { ...old, dotsCoexistenceRulesVersion: 2 as const };
    expect(isRoundScores(old)).toBe(true);
    expect(isRoundScores(current)).toBe(true);
    expect(coexistenceRoundScores(current)).toEqual(old);
    expect(coexistenceRoundScores(current, true)).toBe(current);
    const lean = leanRoundScores(current, true, true, true, true, true, true, true, true);
    expect(decodeRoundScores(lean)).toEqual({ ...current, churchyCustomNames: true, dotsCallTargets: true, stringRulesVersion: 2 });
    for (const version of [null, false, 1, 3, '2']) {
      expect(isRoundScores({ ...current, dotsCoexistenceRulesVersion: version })).toBe(false);
      expect(decodeRoundScores({ ...lean, round: { ...lean.round, dotsCoexistenceRulesVersion: version } })).toBeNull();
    }
    expect(isRoundScores({ ...current, internalGamesSupported: false })).toBe(false);
    const card = lean.round.cards[0];
    if (!card) throw new Error('Missing fictional contract card');
    expect(decodeRoundScores({ ...lean, round: { ...lean.round, cards: [{ ...card,
      holes: [{ number: 1, score: { kind: 'strokes', strokes: -1 } }] }] } })).toBeNull();
    const unmarked = leanRoundScores(current, true, true, true, true, true, true, true);
    expect(isRecord(unmarked.round) && Object.hasOwn(unmarked.round, 'dotsCoexistenceRulesVersion')).toBe(false);
  });
});
