import { describe, expect, it } from 'vitest';
import { churchyV3Fixture } from '../domain/churchy-v3.test-support.js';
import { murphyRoundScores, murphyScoreChange } from '../domain/murphy-transport.js';
import type { ScoreChange } from '../domain/scoring.js';
import { isChurchySpecials } from './churchy.js';
import { isDotsHoleRecord } from './dots.js';
import { decodeRoundScores, isHoleScore, isRoundScores, isScoreChange } from './scoring.js';
import { leanRoundScores, leanScoreWriteResult } from './lean-round-scores.js';

function fixture() {
  const f = churchyV3Fixture(9), anchor = f.ids[0];
  if (!anchor) throw new Error('Missing fictional anchor');
  const extras = { ...f.declaration(1, f.ids), players: [{ playerId: anchor, counts: { sandy: 1, pully: 1 }, calls: [{
    id: '00000000-0000-4000-8000-000000000910', kind: 'murphy' as const, result: 'pending' as const,
    murphyTarget: 'birdie' as const, murphyPresses: 2 as const,
  }] }] };
  const score = { kind: 'strokes' as const, strokes: 4, churchy: extras };
  const cards = f.cards.map((card) => card.playerId === anchor ? { ...card,
    holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score } : hole) } : card);
  const round = f.round(cards);
  const change: ScoreChange = { id: '00000000-0000-4000-8000-000000000911', eventId: round.eventId, roundId: round.roundId,
    playerId: anchor, holeNumber: 1, before: { kind: 'unplayed' }, after: score, expectedEtag: null,
    recordedAt: '2026-01-01T00:00:00.000Z', recordedBy: { kind: 'public-score', eventId: round.eventId } };
  return { ...f, extras, score, round, change };
}

describe('score-derived Murphy strict codecs and legacy projections', () => {
  it('accepts only canonical pending par/birdie markers on Churchie v3 and ordinary Dots Murphy calls', () => {
    const f = fixture();
    for (const murphyTarget of ['par', 'birdie']) {
      expect(isChurchySpecials({ ...f.extras, players: f.extras.players.map((player) => ({ ...player,
        calls: player.calls.map((call) => ({ ...call, murphyTarget })) })) })).toBe(true);
    }
    for (const patch of [{ result: 'success' }, { result: 'failure' }, { murphyTarget: 'bogey' },
      { murphyTarget: null }, { kind: 'paree' }, { kind: 'pully-murphy' }, { murphyPresses: 3 }]) {
      expect(isChurchySpecials({ ...f.extras, players: f.extras.players.map((player) => ({ ...player,
        calls: player.calls.map((call) => ({ ...call, ...patch })) })) })).toBe(false);
    }
    const dots = Object.fromEntries(Object.entries(f.extras).filter(([key]) => key !== 'version'));
    expect(isDotsHoleRecord(dots)).toBe(true);
    expect(isHoleScore({ kind: 'strokes', strokes: 4, dots: [dots] })).toBe(true);
    expect(isHoleScore(f.score)).toBe(true);
  });

  it('round-trips full/lean negotiated targets and capability without exposing unknown fields to default legacy codecs', () => {
    const f = fixture();
    const original = JSON.stringify(f.round);
    const modern = murphyRoundScores(f.round, true);
    expect(modern.churchyMurphyTargets).toBe(true);
    expect(isRoundScores(modern)).toBe(true);
    expect(decodeRoundScores(leanRoundScores(f.round, true))).toEqual(modern);
    const legacy = murphyRoundScores(modern);
    expect(legacy).not.toHaveProperty('churchyMurphyTargets');
    expect(JSON.stringify(legacy)).not.toContain('murphyTarget');
    expect(isRoundScores(legacy)).toBe(true);
    expect(decodeRoundScores(leanRoundScores(modern))).toEqual(legacy);
    expect(legacy.games?.results).toEqual(modern.games?.results);
    const call = legacy.cards[0]?.holes[0]?.score.churchy;
    expect(call?.version === 3 && call.players[0]?.calls[0]).toEqual({
      id: f.extras.players[0]?.calls[0]?.id, kind: 'murphy', result: 'failure', murphyPresses: 2,
    });
    expect(JSON.stringify(f.round)).toBe(original);
    expect(isRoundScores({ ...modern, churchyMurphyTargets: false })).toBe(false);
  });

  it('projects current write acknowledgements but never fabricates historical outcomes from the present scorecard', () => {
    const f = fixture();
    const legacy = leanScoreWriteResult({ round: f.round, change: f.change });
    const modern = leanScoreWriteResult({ round: f.round, change: f.change }, true);
    expect(decodeRoundScores(legacy.round)?.churchyMurphyTargets).toBeUndefined();
    expect(decodeRoundScores(modern.round)?.churchyMurphyTargets).toBe(true);
    expect(isScoreChange(legacy.change)).toBe(true);
    expect(legacy.change).toMatchObject({ after: { churchy: { players: [{ calls: [{ result: 'failure', murphyPresses: 2 }] }] } } });
    expect(modern.change).toMatchObject({ after: { churchy: { players: [{ calls: [{ result: 'pending', murphyTarget: 'birdie' }] }] } } });
    expect(murphyScoreChange(f.change)).toMatchObject({ after: { churchy: { players: [{ calls: [{ result: 'pending', murphyPresses: 2 }] }] } } });
    expect(JSON.stringify(murphyScoreChange(f.change))).not.toContain('murphyTarget');
  });
});
