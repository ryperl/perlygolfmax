import { describe, expect, it } from 'vitest';
import { dotsAutomaticWriteConflicts, dotsCallResult, dotsDeclarationWriteIssues } from './dots.js';
import type { DotsCall } from './dots.js';
import type { HoleScore } from './scoring.js';
import { churchyV3Fixture } from './churchy-v3.test-support.js';
import { calculateGameResults } from './stableford.js';
import { murphyRoundScores } from './murphy-transport.js';
import { publishedCourseHandicaps } from './playing-handicaps.js';

const call: DotsCall = { id: '00000000-0000-4000-8000-000000000920', kind: 'paree', result: 'pending', pareeTarget: 'par' };
const strokes = (value: number): HoleScore => ({ kind: 'strokes', strokes: value });

describe('explicit score-derived Churchie Paree', () => {
  it('derives only opted-in calls, with blank/unavailable inputs pending and nonnumeric scores missing the target', () => {
    for (const value of [2, 3, 4, 5, 6]) expect(dotsCallResult(call, strokes(value), 4))
      .toBe(value <= 4 ? 'success' : 'failure');
    for (const score of [undefined, { kind: 'unplayed' }] satisfies readonly (HoleScore | undefined)[]) {
      expect(dotsCallResult(call, score, 4)).toBe('pending');
    }
    for (const score of [strokes(3), { kind: 'picked-up', reportedStrokes: 7 }, { kind: 'did-not-finish' }] satisfies readonly HoleScore[]) {
      expect(dotsCallResult(call, score, undefined)).toBe('pending');
    }
    expect(dotsCallResult(call, { kind: 'picked-up', reportedStrokes: 7 }, 4)).toBe('failure');
    expect(dotsCallResult(call, { kind: 'did-not-finish' }, 4)).toBe('failure');
    for (const result of ['pending', 'success', 'failure'] as const) {
      expect(dotsCallResult({ id: call.id, kind: 'paree', result }, strokes(5), 4)).toBe(result);
    }
    const f = churchyV3Fixture(9);
    expect(f.round().games?.results[0]?.churchy?.awards?.filter((award) => award.kind === 'paree')).toEqual([]);
  });

  it('uses captured personal gross par, credits configured units per repeated call and current team, never the default tee or net', () => {
    const f = churchyV3Fixture(9), anchor = f.ids[0], source = f.ids[1];
    if (!anchor || !source) throw new Error('Missing fictional golfers');
    const snapshot = { ...f.snapshot, playerTees: [{ playerId: source, profile: { ...f.snapshot.teeProfile,
      holes: f.snapshot.teeProfile.holes.map((hole) => hole.number === 1 ? { ...hole, par: 5 } : hole) } }] };
    const game = { ...f.game, specials: [{ kind: 'paree' as const, units: 2 }] };
    const declaration = { ...f.declaration(1, f.ids), players: [{ playerId: source, counts: {}, calls: [
      call, { ...call, id: '00000000-0000-4000-8000-000000000921' },
    ] }] };
    for (const [value, result] of [[4, 'success'], [5, 'success'], [6, 'failure']] as const) {
      const cards = f.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => hole.number !== 1 ? hole : {
        ...hole, score: { kind: 'strokes' as const, strokes: card.playerId === source ? value : 4,
          ...(card.playerId === anchor ? { churchy: declaration } : {}) },
      }) }));
      const round = { ...f.round(cards), playerTees: snapshot.playerTees, courseHandicaps: publishedCourseHandicaps(snapshot),
        games: { configuration: { ...f.round().games?.configuration, eventId: f.round().eventId,
          roundId: snapshot.id, etag: 'fictional-games-v3', games: [game] },
        results: calculateGameResults([game], snapshot, cards) } };
      const awards = round.games.results[0]?.churchy?.awards?.filter((award) => award.kind === 'paree');
      expect(awards).toHaveLength(2);
      expect(awards?.every((award) => award.count === 1 && award.dots === 2 && award.earnedBy === source
        && award.reason === `Paree call: ${result}.`
        && JSON.stringify(award.recipientIds) === JSON.stringify(result === 'success'
          ? [f.ids[1], f.ids[2]] : [f.ids[0], f.ids[3]]))).toBe(true);
      expect(murphyRoundScores(round, true).games?.results).toEqual(round.games.results);
      expect(cards.find((card) => card.playerId === anchor)?.holes[0]?.score.churchy).toEqual(declaration);
    }
  });

  it('rejects newly failed same-source claims on a raw peer correction while leaving other sources independent', () => {
    const f = churchyV3Fixture(9), source = f.ids[1], peer = f.ids[0];
    if (!source || !peer) throw new Error('Missing fictional golfers');
    const player = { playerId: source, counts: { sandy: 1 }, calls: [call] };
    expect(dotsDeclarationWriteIssues(player, { score: strokes(5), par: 4 }).conflicts)
      .toContainEqual({ code: 'FAILED_CALL_SPECIAL', kinds: ['paree', 'sandy'] });
    const before = { layout: f.snapshot.teeProfile.holes, groups: f.snapshot.groups, cards: f.cards };
    const after = { ...before, cards: f.cards.map((card) => card.playerId === source ? { ...card,
      holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score: strokes(5) } : hole) } : card) };
    const records = [{ ...f.declaration(1, f.ids), players: [player] }];
    expect(dotsAutomaticWriteConflicts(f.game, before, after, records, records)).toEqual([source]);
    const independent = [{ ...f.declaration(1, f.ids), players: [
      { ...player, counts: {} }, { playerId: peer, counts: { sandy: 1 }, calls: [] },
    ] }];
    expect(dotsAutomaticWriteConflicts(f.game, before, after, independent, independent)).toEqual([]);
  });
});
