import { describe, expect, it } from 'vitest';
import type { DotsGameDefinition } from '../domain/dots.js';
import { calculateGameResults } from '../domain/stableford.js';
import { matchGamesFixture } from '../domain/match-games.test-support.js';
import type { RoundScores } from '../domain/scoring.js';
import { decodeRoundScores, isRoundScores } from './scoring.js';
import { leanRoundScores } from './lean-round-scores.js';
import { stringRoundScores, StringRulesClientUpdateRequired } from './string-rules.js';
import { calculateInternalSettlements } from '../domain/internal-games.js';
import { churchyV3Fixture } from '../domain/churchy-v3.test-support.js';

function fixture(affected = true) {
  const f = matchGamesFixture();
  const game: DotsGameDefinition = { id: f.wolf.id, name: 'Fictional String', kind: 'dots', version: 1,
    groupNumber: 1, playerIds: f.ids, mode: 'individual', stakeMinor: 50,
    specials: [{ kind: 'string', units: 1 }, { kind: 'birdy-string', units: 2 }] };
  const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
    ...hole, score: { kind: 'strokes' as const, strokes: affected && index === 0 && hole.number === 2 ? 3 : 4 },
  })) }));
  const base = f.round(cards, [game]);
  const current: RoundScores = { ...base, stringRulesVersion: 2,
    internalSettlements: calculateInternalSettlements([game], base.games?.results ?? [], base) };
  const legacy: RoundScores = { ...base, games: { configuration: base.games?.configuration ?? {
    eventId: base.eventId, roundId: base.roundId, etag: null, games: [game] },
    results: calculateGameResults([game], f.snapshot, cards, 1) } };
  return { current, legacy };
}

describe('per-round String calculation protocol', () => {
  it('propagates the enclosing round version through Churchie full validation and lean evidence restoration', () => {
    const f = churchyV3Fixture(9, 1, 'tee');
    const game = { ...f.game, specials: [{ kind: 'string' as const, units: 1 }] };
    const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'strokes' as const, strokes: index === 0 && hole.number === 2 ? 3 : 4 },
    })) }));
    const base = f.round(cards);
    if (!base.games) throw new Error('Missing fictional games');
    const legacy = { ...base, games: { configuration: { ...base.games.configuration, games: [game] },
      results: calculateGameResults([game], f.snapshot, cards, 1) } };
    const modern = { ...legacy, stringRulesVersion: 2 as const, games: { ...legacy.games,
      results: calculateGameResults([game], f.snapshot, cards) } };
    expect(isRoundScores(legacy)).toBe(true);
    expect(isRoundScores(modern)).toBe(true);
    expect(decodeRoundScores(leanRoundScores(modern, false, false, true))).toEqual(modern);
    expect(decodeRoundScores(leanRoundScores(legacy))).toEqual(legacy);
    expect(() => leanRoundScores(modern)).toThrow(StringRulesClientUpdateRequired);
  });
  it('decodes absent legacy and marked current full/lean results strictly without accepting mismatched calculations', () => {
    const f = fixture();
    expect(isRoundScores(f.current)).toBe(true);
    expect(isRoundScores(f.legacy)).toBe(true);
    expect(isRoundScores({ ...f.current, stringRulesVersion: undefined })).toBe(false);
    expect(isRoundScores({ ...f.legacy, stringRulesVersion: 2 })).toBe(false);
    expect(decodeRoundScores(leanRoundScores(f.current, false, false, true))).toEqual(f.current);
    expect(decodeRoundScores(leanRoundScores(f.legacy))).toEqual(f.legacy);
    for (const stringRulesVersion of [null, 1, 3, '2']) {
      expect(isRoundScores({ ...f.current, stringRulesVersion })).toBe(false);
    }
    expect(isRoundScores(f.current)).toBe(true);
    expect(isRoundScores(f.legacy)).toBe(true);
  });

  it('never sends alternate legacy points; rejects affected old reads and preserves coherent unaffected reads', () => {
    const affected = fixture();
    expect(() => stringRoundScores(affected.current)).toThrow(StringRulesClientUpdateRequired);
    expect(() => leanRoundScores(affected.current)).toThrow(StringRulesClientUpdateRequired);
    expect(stringRoundScores(affected.current, true)).toEqual(affected.current);
    const unaffected = fixture(false);
    expect(stringRoundScores(unaffected.current)).toEqual({ ...unaffected.legacy,
      internalSettlements: unaffected.current.internalSettlements });
    expect(stringRoundScores(unaffected.current)).not.toHaveProperty('stringRulesVersion');
  });
});
