import { describe, expect, it } from 'vitest';
import type { DotsGameDefinition } from '../domain/dots.js';
import type { RoundScores } from '../domain/scoring.js';
import { matchGamesFixture } from '../domain/match-games.test-support.js';
import { calculateGameResults } from '../domain/stableford.js';
import { calculateInternalSettlements } from '../domain/internal-games.js';
import { isDotsDefinition, isDotsHoleRecord, isChurchyV3HoleRecord, dotsRecordsMatchGame } from './dots.js';
import { isWolfDefinition } from './wolf.js';
import { isDotAwardAudit } from './dot-audit.js';
import { decodeRoundScores, isRoundScores } from './scoring.js';
import { leanRoundScores } from './lean-round-scores.js';
import { requireSweepRulesInValue, sweepRulesRoundScores, SweepRulesClientUpdateRequired } from './sweep-rules.js';

function fixture(manual = true) {
  const f = matchGamesFixture();
  const game: DotsGameDefinition = { id: f.wolf.id, name: 'Fictional manual Sweep', kind: 'dots', version: 1,
    mode: 'individual', groupNumber: 1, playerIds: f.ids, stakeMinor: 50,
    ...(manual ? { sweepRule: 'manual-v1' } : {}), specials: [{ kind: manual ? 'sweep' : 'other', units: 2 }] };
  const anchor = f.ids[0];
  if (!anchor) throw new Error('Missing fictional Sweep source');
  const record = { number: 1, gameId: game.id, gameEtag: 'fictional-game-revision', contests: [],
    players: [{ playerId: anchor, counts: manual ? { sweep: 2 } : { other: 2 }, calls: [] }] };
  const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
    ...hole, score: { kind: 'strokes' as const, strokes: 4, ...(index === 0 && hole.number === 1 ? { dots: [record] } : {}) },
  })) }));
  const base = f.round(cards, [game]);
  const results = calculateGameResults([game], f.snapshot, cards);
  const round: RoundScores = { ...base, stringRulesVersion: 2, ...(manual ? { sweepRulesVersion: 2 } : {}),
    games: { configuration: { eventId: base.eventId, roundId: base.roundId, games: [game], etag: 'fictional-game-revision' }, results } };
  return { ...f, game, record, round: { ...round, internalSettlements: calculateInternalSettlements([game], results, round) } };
}

describe('explicit independent Sweep contracts', () => {
  it('validates opt-in definition/count shapes without admitting manual counts into legacy or Churchie', () => {
    const f = fixture();
    expect(isDotsDefinition(f.game)).toBe(true);
    expect(isDotsHoleRecord(f.record)).toBe(true);
    expect(isChurchyV3HoleRecord(f.record)).toBe(false);
    expect(dotsRecordsMatchGame([f.record], f.game, f.round)).toBe(true);
    const legacy = { ...f.game };
    delete legacy.sweepRule;
    expect(dotsRecordsMatchGame([f.record], legacy, f.round)).toBe(false);
    for (const sweepRule of [null, true, 'automatic', 1, undefined]) {
      expect(isDotsDefinition({ ...f.game, sweepRule })).toBe(false);
    }
    expect(isDotsDefinition({ ...f.game, specials: [], sweepRule: 'manual-v1' })).toBe(false);
    expect(isWolfDefinition({ ...f.wolf, highLowSweep: true })).toBe(false);
    const wolf = { ...f.wolf, version: 2, stakeMinor: null, highLowSweep: true };
    expect(isWolfDefinition(wolf)).toBe(true);
    for (const highLowSweep of [false, null, 1, undefined]) expect(isWolfDefinition({ ...wolf, highLowSweep })).toBe(false);
    for (const sweep of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isDotsHoleRecord({ ...f.record, players: [{ ...f.record.players[0], counts: { sweep } }] })).toBe(false);
    }
  });

  it('strictly decodes negotiated full/lean rules, rejects missing markers and forged totals, and leaves old context readable', () => {
    const f = fixture();
    expect(isRoundScores(f.round)).toBe(true);
    const lean = leanRoundScores(f.round, true, true, true, true, true, true, true);
    expect(decodeRoundScores(lean)).toEqual({ ...f.round, churchyCustomNames: true });
    expect(isRoundScores({ ...f.round, sweepRulesVersion: undefined })).toBe(false);
    for (const sweepRulesVersion of [null, 1, '2', true]) expect(isRoundScores({ ...f.round, sweepRulesVersion })).toBe(false);
    for (const capability of ['dotsManualSweep', 'wolfHighLowSweep']) {
      expect(isRoundScores({ ...f.round, [capability]: false })).toBe(false);
    }
    if (!lean.round.games) throw new Error('Missing fictional lean game');
    const result = lean.round.games.results[0];
    if (!result) throw new Error('Missing fictional lean result');
    expect(decodeRoundScores({ ...lean, round: { ...lean.round, games: { ...lean.round.games, results: [{
      ...result, players: result.players.map((player) => ({ ...player, totalPoints: 999 })),
    }] } } })).toBeNull();
    expect(() => leanRoundScores(f.round, true, true, true, true, true, true)).toThrow(SweepRulesClientUpdateRequired);
    const old = fixture(false).round;
    expect(isRoundScores(old)).toBe(true);
    const capabilities = { ...old, dotsManualSweep: true as const, wolfHighLowSweep: true as const };
    expect(sweepRulesRoundScores(capabilities)).toEqual(capabilities);
  });

  it('fences nested immutable configurations/counts/audits without changing historical shapes', () => {
    const f = fixture(), old = fixture(false);
    const audit = { gameId: f.game.id, kind: 'dots', version: 1, configuration: f.game, gameEtag: null,
      inputRevision: null, before: [], after: f.round.games?.results[0]?.dots?.awards ?? [], sweepRulesVersion: 2 };
    expect(isDotAwardAudit(audit)).toBe(true);
    expect(isDotAwardAudit({ ...audit, sweepRulesVersion: undefined })).toBe(false);
    expect(isDotAwardAudit({ gameId: old.game.id, kind: 'dots', version: 1, configuration: old.game,
      gameEtag: null, inputRevision: null, before: [], after: [] })).toBe(true);
    for (const value of [{ changes: [{ dotAwardAudit: [audit] }] }, { wrapper: [f.record] }, { roundScores: [f.round] }]) {
      const before = structuredClone(value);
      expect(() => { requireSweepRulesInValue(value); }).toThrow(SweepRulesClientUpdateRequired);
      expect(value).toEqual(before);
    }
    expect(() => { requireSweepRulesInValue({ roundScores: [old.round] }); }).not.toThrow();
  });
});
