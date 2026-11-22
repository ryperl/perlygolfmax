import { describe, expect, it } from 'vitest';
import { calculateDotsHighLow } from './dots-high-low.js';
import { calculateInternalGameResults, calculateInternalSettlements } from './internal-games.js';
import { dotsRecordsFor } from './game-declarations.js';
import type { RoundGameScoringContext } from './game-declarations.js';
import type { DotsGameDefinition } from './dots.js';
import type { GameHandicapRule } from './game-handicaps.js';
import type { HoleScore, Scorecard } from './scoring.js';
import { matchGamesFixture } from './match-games.test-support.js';
import { isDotsDefinition } from '../contracts/dots.js';
import { sameGameDefinitions } from './games.js';

function fixture(rule: GameHandicapRule = 'group-low-v1', start = 1, count = 18) {
  const f = matchGamesFixture();
  const game: DotsGameDefinition = { id: f.wolf.id, name: 'Fictional Modified Sixes', kind: 'dots', version: 2,
    mode: 'rotating', rotationHoles: 3, groupNumber: 1, playerIds: f.ids, specials: [], stakeMinor: 100,
    highLow: { version: 1, handicapRule: rule } };
  const layout = f.snapshot.teeProfile.holes.slice(0, count).map((hole, index) => ({ ...hole, par: 4, allocation: index + 1 }));
  const cards: readonly Scorecard[] = f.cards.map((card, index) => ({ ...card, holes: layout.map((hole) => ({
    number: hole.number, score: { kind: 'strokes', strokes: [5, 4, 6, 5][index] ?? 5,
      ...(index === 0 && hole.number === start ? { dots: [{ number: start, gameId: game.id,
        gameEtag: 'fictional-game-revision', rotation: { playerIds: f.ids }, players: [], contests: [] }] } : {}) },
  })) }));
  const context: RoundGameScoringContext = { ...f.round(cards, [game]), layout, cards, teeStrokeAllocation: true,
    groups: [{ number: 1, playerIds: f.ids, startingHole: start }],
    courseHandicaps: f.ids.map((playerId, index) => ({ playerId, courseHandicap: [11, 4, 8, 3][index] ?? 3 })) };
  return { ...f, game, context, records: dotsRecordsFor(game, context.groups, context.cards) };
}

describe('opt-in Modified Sixes net High/Low', () => {
  it('uses whole saved-group SO, one dot per winning teammate per lane, without carry or deductions', () => {
    const f = fixture(), result = calculateDotsHighLow(f.game, f.context, f.records);
    expect(result.players.map((player) => player.playingHandicap)).toEqual([8, 1, 5, 0]);
    expect(result.holes.find((hole) => hole.number === 4)?.contests).toEqual([
      { kind: 'high', status: 'tied', winnerIds: [], aScore: 5, bScore: 5 },
      { kind: 'low', status: 'tied', winnerIds: [], aScore: 4, bScore: 4 },
    ]);
    const first = result.holes[0];
    expect(first?.contests).toEqual([
      { kind: 'high', status: 'won', winnerIds: f.ids.slice(0, 2), aScore: 4, bScore: 5 },
      { kind: 'low', status: 'won', winnerIds: f.ids.slice(0, 2), aScore: 3, bScore: 5 },
    ]);
    expect(result.awards.filter((award) => award.number === 1).map((award) =>
      [award.kind, award.recipientIds, award.dots, award.multiplier])).toEqual([
      ['high', f.ids.slice(0, 2), 1, 1], ['low', f.ids.slice(0, 2), 1, 1],
    ]);
  });

  it.each(['full-course-v1', 'group-low-v1'] as const)('uses %s, signed plus and zero and never halves published nine-hole CH', (rule) => {
    const f = fixture(rule, 7, 9);
    const context = { ...f.context, courseHandicaps: f.ids.map((playerId, index) =>
      ({ playerId, courseHandicap: [-2, 0, 6, 3][index] ?? 3 })) };
    const result = calculateDotsHighLow(f.game, context, f.records);
    expect(result.players.map((player) => player.playingHandicap)).toEqual(
      rule === 'group-low-v1' ? [0, 2, 8, 5] : [-2, 0, 6, 3]);
    expect(result.holes.map((hole) => hole.number)).toEqual([7, 8, 9, 1, 2, 3, 4, 5, 6]);
    expect(result.holes[0]?.sides).toEqual([f.ids.slice(0, 2), f.ids.slice(2, 4)]);
    expect(result.holes[3]?.sides).toEqual([[f.ids[0], f.ids[2]], [f.ids[1], f.ids[3]]]);
    expect(result.holes.find((hole) => hole.number === 8)?.contests[0]?.aScore).toBe(rule === 'full-course-v1' ? 6 : 5);
  });

  it('keeps missing inputs/order pending or unavailable, and pickup numeric Low separate from High', () => {
    const f = fixture();
    expect(calculateDotsHighLow(f.game, f.context, []).status).toBe('in-progress');
    expect(calculateDotsHighLow(f.game, { ...f.context, courseHandicaps: [] }, f.records).status).toBe('unavailable');
    const replace = (score: HoleScore) => ({ ...f.context, cards: f.context.cards.map((card, index) =>
      index === 0 ? { ...card, holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score } : hole) } : card) });
    expect(calculateDotsHighLow(f.game, replace({ kind: 'unplayed' }), f.records).holes[0]?.status).toBe('pending');
    expect(calculateDotsHighLow(f.game, replace({ kind: 'picked-up', reportedStrokes: 7 }), f.records).holes[0]?.contests)
      .toMatchObject([{ kind: 'high', status: 'won', winnerIds: f.ids.slice(2, 4) },
        { kind: 'low', status: 'won', winnerIds: f.ids.slice(0, 2) }]);
  });

  it('uses captured personal allocations without qualifying gross bogeys for String or settling specials twice', () => {
    const f = fixture();
    const game = { ...f.game, specials: [{ kind: 'string' as const, units: 1 }] };
    const gross = calculateInternalGameResults([game], f.context).get(game.id);
    expect(gross?.dotsHighLow?.holes[0]?.contests[0]?.aScore).toBe(4);
    expect(gross?.dots?.awards.some((award) => award.earnedBy === f.ids[0])).toBe(false);
    const context = { ...f.context, stringRulesVersion: 2 as const, playerTees: [{
      playerId: f.ids[0] ?? '', profile: { ...f.snapshot.teeProfile,
        holes: f.context.layout.map((hole) => ({ ...hole, allocation: 19 - hole.allocation })) },
    }] };
    const result = calculateInternalGameResults([game], context).get(game.id);
    expect(result?.dots?.awards.some((award) => award.earnedBy === f.ids[0])).toBe(false);
    expect(result?.dotsHighLow?.holes[0]?.contests[0]?.aScore).toBe(5);
    const settlements = calculateInternalSettlements([game], result ? [result] : [], context);
    expect(settlements).toHaveLength(1);
    for (const player of settlements[0]?.players ?? []) {
      const base = result?.dotsHighLow?.players.find((entry) => entry.playerId === player.playerId)?.totalPoints;
      const special = result?.dots?.players.find((entry) => entry.playerId === player.playerId)?.totalPoints;
      expect(player.baseDots).toBe(base);
      expect(player.specialDots).toBe(special);
    }
  });

  it('requires explicit rotation-3 opt-in and preserves legacy definitions/results', () => {
    const f = fixture();
    expect(isDotsDefinition(f.game)).toBe(true);
    expect(isDotsDefinition({ ...f.game, rotationHoles: 6 })).toBe(false);
    expect(isDotsDefinition({ ...f.game, highLow: { version: 1, handicapRule: 'guess' } })).toBe(false);
    const { highLow, ...legacy } = f.game;
    expect(highLow).toBeDefined();
    expect(sameGameDefinitions([legacy], [f.game])).toBe(false);
    const result = calculateInternalGameResults([legacy], f.context).get(legacy.id);
    expect(result?.dotsHighLow).toBeUndefined();
    expect(result?.players).toEqual(result?.dots?.players);
  });

  it('does not publish a success-shaped combined total when separately exact base and specials overflow', () => {
    const f = fixture(), game = { ...f.game, specials: [{ kind: 'other' as const, units: Number.MAX_SAFE_INTEGER }] };
    const record = f.records[0];
    if (!record || !f.ids[0]) throw new Error('Missing fictional order');
    const context = { ...f.context, cards: f.context.cards.map((card, index) => index !== 0 ? card : {
      ...card, holes: card.holes.map((hole) => hole.number !== 1 ? hole : { ...hole, score: { ...hole.score, dots: [{
        ...record, players: [{ playerId: f.ids[0] ?? '', counts: { other: 1 }, calls: [] }],
      }] } }),
    }) };
    const result = calculateInternalGameResults([game], context).get(game.id);
    expect(result?.dots?.players[0]?.totalPoints).toBe(Number.MAX_SAFE_INTEGER);
    expect(result?.players[0]).toMatchObject({ status: 'unavailable', totalPoints: null });
    expect(calculateInternalSettlements([game], result ? [result] : [], context)[0]?.status).toBe('unavailable');
  });
});
