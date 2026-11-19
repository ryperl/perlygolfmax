import { describe, expect, it } from 'vitest';
import { dotsAutomaticWriteConflicts, dotsCallResult, dotsDeclarationWriteIssues } from './dots.js';
import type { DotsCall, DotsPlayerDeclaration } from './dots.js';
import type { HoleScore } from './scoring.js';
import { churchyV3Fixture } from './churchy-v3.test-support.js';
import { calculateGameResults } from './stableford.js';
import { murphyRoundScores } from './murphy-transport.js';
import { publishedCourseHandicaps } from './playing-handicaps.js';

const call: DotsCall = { id: '00000000-0000-4000-8000-000000000910', kind: 'murphy', result: 'pending', murphyTarget: 'par' };
const strokes = (value: number): HoleScore => ({ kind: 'strokes', strokes: value });
const failed = (playerId: string): DotsPlayerDeclaration => ({ playerId, counts: { sandy: 1, pully: 1 }, calls: [call] });

describe('score-derived Churchie Murphy targets', () => {
  it.each(['par', 'birdie'] as const)('resolves %s from personal gross only, with pending inputs and explicit nonnumeric failures', (murphyTarget) => {
    const marked = { ...call, murphyTarget };
    for (const value of [2, 3, 4, 5, 6]) expect(dotsCallResult(marked, strokes(value), 4))
      .toBe(value <= (murphyTarget === 'par' ? 4 : 3) ? 'success' : 'failure');
    expect(dotsCallResult(marked, undefined, 4)).toBe('pending');
    expect(dotsCallResult(marked, { kind: 'unplayed' }, 4)).toBe('pending');
    expect(dotsCallResult(marked, strokes(3), undefined)).toBe('pending');
    expect(dotsCallResult(marked, { kind: 'picked-up', reportedStrokes: 7 }, undefined)).toBe('failure');
    expect(dotsCallResult(marked, { kind: 'did-not-finish' }, 4)).toBe('failure');
  });

  it('never derives unmarked legacy calls or invents a call from the score', () => {
    expect(dotsCallResult({ id: call.id, kind: 'murphy', result: 'failure' }, strokes(3), 4)).toBe('failure');
    expect(dotsCallResult({ id: call.id, kind: 'murphy', result: 'pending' }, strokes(3), 4)).toBe('pending');
    const f = churchyV3Fixture(9);
    expect(f.round().games?.results[0]?.churchy?.awards?.filter((award) => award.kind === 'murphy')).toEqual([]);
  });

  it.each([0, 1, 2] as const)('scales total stake by %i + 1 and recalculates cross-card calls without changing their canonical value', (murphyPresses) => {
    const f = churchyV3Fixture(9), anchor = f.ids[0], source = f.ids[1];
    if (!anchor || !source) throw new Error('Missing fictional golfers');
    const marked = { ...call, murphyPresses };
    const declaration = { ...f.declaration(1, f.ids), players: [{ playerId: source, counts: {}, calls: [marked,
      { ...marked, id: '00000000-0000-4000-8000-000000000911' }] }] };
    const cards = f.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => hole.number !== 1 ? hole : {
      ...hole, score: { kind: 'strokes' as const, strokes: 4, ...(card.playerId === anchor ? { churchy: declaration } : {}) },
    }) }));
    for (const [value, result] of [[4, 'success'], [5, 'failure']] as const) {
      const current = cards.map((card) => card.playerId === source ? { ...card,
        holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score: strokes(value) } : hole) } : card);
      const awards = f.round(current).games?.results[0]?.churchy?.awards?.filter((award) => award.kind === 'murphy');
      expect(awards).toHaveLength(2);
      expect(awards?.every((award) => award.count === 1 + murphyPresses && award.dots === 1 + murphyPresses
        && award.reason === `Murphy call: ${result}.` && award.recipientIds.includes(source) === (result === 'success'))).toBe(true);
      expect(current.find((card) => card.playerId === anchor)?.holes[0]?.score.churchy).toEqual(declaration);
    }
  });

  it('allows a missed birdie at gross par with valid par specials/made calls/String, without permitting bogey or pickup claims', () => {
    const declaration = { ...failed('fictional-source'), calls: [
      { ...call, murphyTarget: 'birdie' as const }, { id: 'made', kind: 'paree' as const, result: 'success' as const },
    ] };
    expect(dotsDeclarationWriteIssues(declaration, { score: strokes(4), par: 4, automaticKinds: ['string'] }).conflicts).toEqual([]);
    expect(dotsDeclarationWriteIssues(declaration, { score: strokes(5), par: 4 }).conflicts)
      .toContainEqual({ code: 'FAILED_CALL_SPECIAL', kinds: ['murphy', 'sandy'] });
    expect(dotsDeclarationWriteIssues(declaration, { score: { kind: 'picked-up', reportedStrokes: 7 }, par: 4 }).conflicts)
      .toContainEqual({ code: 'FAILED_CALL_SPECIAL', kinds: ['murphy', 'pully'] });
    expect(dotsDeclarationWriteIssues({ ...declaration, counts: { dime: 1 } }, { score: strokes(4), par: 4 }).conflicts)
      .toContainEqual({ code: 'FAILED_CALL_SPECIAL', kinds: ['murphy', 'dime'] });
  });

  it('checks a pending call resolving to failure even when its manual specials and canonical card were unchanged', () => {
    const f = churchyV3Fixture(9), source = f.ids[1];
    if (!source) throw new Error('Missing fictional source');
    const records = [{ ...f.declaration(1, f.ids), players: [failed(source)] }];
    const after = { layout: f.snapshot.teeProfile.holes, groups: f.snapshot.groups, cards: f.cards };
    const before = { ...after, cards: after.cards.map((card) => card.playerId === source ? { ...card,
      holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score: { kind: 'unplayed' as const } } : hole) } : card) };
    const bogey = { ...after, cards: after.cards.map((card) => card.playerId === source ? { ...card,
      holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score: strokes(5) } : hole) } : card) };
    expect(dotsAutomaticWriteConflicts(f.game, before, after, records, records)).toEqual([]);
    expect(dotsAutomaticWriteConflicts(f.game, before, bogey, records, records)).toEqual([source]);
  });

  it('uses the captured personal tee par, not the default tee or handicap allowance, and projects identical legacy outcomes', () => {
    const f = churchyV3Fixture(9), anchor = f.ids[0], source = f.ids[1];
    if (!anchor || !source) throw new Error('Missing fictional golfers');
    const snapshot = { ...f.snapshot, playerTees: [{ playerId: source, profile: { ...f.snapshot.teeProfile,
      holes: f.snapshot.teeProfile.holes.map((hole) => hole.number === 1 ? { ...hole, par: 5 } : hole) } }] };
    const declaration = { ...f.declaration(1, f.ids), players: [{ playerId: source, counts: {},
      calls: [{ ...call, murphyTarget: 'birdie' as const }] }] };
    const cards = f.cards.map((card) => card.playerId === anchor ? { ...card,
      holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score: { ...hole.score, churchy: declaration } } : hole) } : card);
    const round = { ...f.round(cards), playerTees: snapshot.playerTees, courseHandicaps: publishedCourseHandicaps(snapshot),
      games: { configuration: { eventId: f.round().eventId, roundId: snapshot.id, etag: 'fictional-games-v3', games: [f.game] },
        results: calculateGameResults([f.game], snapshot, cards) } };
    const award = round.games.results[0]?.churchy?.awards?.find((award) => award.kind === 'murphy');
    expect(award).toMatchObject({ kind: 'murphy', earnedBy: source, reason: 'Murphy call: success.' });
    expect(award?.recipientIds).toContain(source);
    expect(murphyRoundScores(round).games?.results).toEqual(round.games.results);
    expect(round.cards.find((card) => card.playerId === anchor)?.holes[0]?.score.churchy).toEqual(declaration);
  });
});
