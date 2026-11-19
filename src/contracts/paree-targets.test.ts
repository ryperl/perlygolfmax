import { describe, expect, it } from 'vitest';
import type { DotsCall } from '../domain/dots.js';
import type { ScoreChange } from '../domain/scoring.js';
import { churchyV3Fixture } from '../domain/churchy-v3.test-support.js';
import { murphyRoundScores, murphyScoreChange } from '../domain/murphy-transport.js';
import { isChurchySpecials } from './churchy.js';
import { isDotsHoleRecord } from './dots.js';
import { decodeRoundScores, isRoundScores, isScoreChange } from './scoring.js';
import { leanRoundScores, leanScoreWriteResult } from './lean-round-scores.js';

function fixture() {
  const f = churchyV3Fixture(9), anchor = f.ids[0];
  if (!anchor) throw new Error('Missing fictional golfer');
  const paree: DotsCall = { id: '00000000-0000-4000-8000-000000000920', kind: 'paree', result: 'pending', pareeTarget: 'par' };
  const murphy: DotsCall = { id: '00000000-0000-4000-8000-000000000921', kind: 'murphy', result: 'pending', murphyTarget: 'birdie' };
  const extras = { ...f.declaration(1, f.ids), players: [{ playerId: anchor, counts: {}, calls: [paree, murphy] }] };
  const score = { kind: 'strokes' as const, strokes: 4, churchy: extras };
  const round = f.round(f.cards.map((card) => card.playerId === anchor ? { ...card,
    holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score } : hole) } : card));
  const change: ScoreChange = { id: '00000000-0000-4000-8000-000000000922', eventId: round.eventId, roundId: round.roundId,
    playerId: anchor, holeNumber: 1, before: score, after: score, expectedEtag: null,
    recordedAt: '2026-01-01T00:00:00.000Z', recordedBy: { kind: 'public-score', eventId: round.eventId } };
  return { extras, score, round, change, paree };
}

describe('Paree strict contracts and independent compatibility', () => {
  it('accepts canonical pending par markers in Churchie v3 and ordinary Dots, never manual marked results', () => {
    const f = fixture();
    expect(isChurchySpecials(f.extras)).toBe(true);
    for (const patch of [{ result: 'success' }, { result: 'failure' }, { pareeTarget: 'birdie' },
      { pareeTarget: null }, { kind: 'murphy' }, { kind: 'pully-murphy' }, { murphyTarget: 'par' }, { murphyPresses: 1 }]) {
      expect(isChurchySpecials({ ...f.extras, players: [{ ...f.extras.players[0],
        calls: [{ ...f.paree, ...patch }] }] })).toBe(false);
    }
    expect(isDotsHoleRecord(Object.fromEntries(Object.entries(f.extras).filter(([key]) => key !== 'version')))).toBe(true);
    expect(isChurchySpecials({ ...f.extras, version: 2 })).toBe(false);
    expect(isChurchySpecials({ ...f.extras, version: 1 })).toBe(false);
    expect(isRoundScores({ ...f.round, churchyPareeTargets: false })).toBe(false);
    expect(isRoundScores({ ...f.round, churchyEnabled: false, churchyPareeTargets: true })).toBe(false);
  });

  it('round-trips full/lean reads and writes for all four independent negotiations, without mutating canonical inputs', () => {
    const f = fixture(), original = JSON.stringify(f);
    for (const murphy of [false, true]) for (const paree of [false, true]) {
      const projected = murphyRoundScores(f.round, murphy, paree);
      expect(projected.churchyMurphyTargets).toBe(murphy ? true : undefined);
      expect(projected.churchyPareeTargets).toBe(paree ? true : undefined);
      expect(JSON.stringify(projected).includes('"murphyTarget"')).toBe(murphy);
      expect(JSON.stringify(projected).includes('"pareeTarget"')).toBe(paree);
      expect(isRoundScores(projected)).toBe(true);
      expect(projected.games?.results).toEqual(f.round.games?.results);
      expect(decodeRoundScores(leanRoundScores(f.round, murphy, paree))).toEqual(projected);
      const write = leanScoreWriteResult({ round: f.round, change: f.change }, murphy, paree);
      expect(decodeRoundScores(write.round)).toEqual(projected);
      expect(isScoreChange(write.change)).toBe(true);
      expect(write.change).toMatchObject({ after: { churchy: { players: [{ calls: [
        { result: paree ? 'pending' : 'success', ...(paree ? { pareeTarget: 'par' } : {}) },
        { result: murphy ? 'pending' : 'failure', ...(murphy ? { murphyTarget: 'birdie' } : {}) },
      ] }] } } });
      const history = murphyScoreChange(f.change, murphy, undefined, paree);
      expect(isScoreChange(history)).toBe(true);
      expect(history.after.churchy?.version === 3 && history.after.churchy.players[0]?.calls.every((call) => call.result === 'pending')).toBe(true);
      expect(murphyRoundScores(projected, murphy, paree)).toEqual(projected);
    }
    expect(JSON.stringify(f)).toBe(original);
  });
});
