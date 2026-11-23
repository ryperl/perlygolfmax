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
import { dotsInputFromScores, mergeDotsRecords } from './game-declarations.js';
import { calculateDots, dotsRecordsMatchGame } from './dots.js';

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

  function rotatingV3(rotationHoles: 3 | 6 = 3, orderMode: 'tee-flip' | 'approach' = 'tee-flip',
    rule: GameHandicapRule = 'full-course-v1', start = 1, count = 18) {
    const f = fixture(rule, start, count);
    const game: DotsGameDefinition = { ...f.game, version: 3, rotationHoles, orderMode,
      highLow: { version: 2, handicapRule: rule } };
    return { ...f, game };
  }

  describe('explicit rotating Dots v3 net High/Low', () => {
    it.each([3, 6] as const)('uses pure saved scores and %i-hole blocks for both order methods', (size) => {
      for (const mode of ['tee-flip', 'approach'] as const) {
        const f = rotatingV3(size, mode, 'full-course-v1', 16);
        const context = { ...f.context, courseHandicaps: f.ids.map((playerId) => ({ playerId, courseHandicap: 0 })) };
        const result = calculateDotsHighLow(f.game, context, f.records);
        const pairings = [
          [f.ids.slice(0, 2), f.ids.slice(2)],
          [[f.ids[0], f.ids[2]], [f.ids[1], f.ids[3]]],
          [[f.ids[0], f.ids[3]], [f.ids[1], f.ids[2]]],
        ];
        const totals = [[3, 3, 0, 0], [0, 3, 0, 3], [1, 1, 1, 1]];
        expect(result.status).toBe('complete');
        expect(result.holes.map((hole) => hole.number)).toEqual([16, 17, 18, ...Array.from({ length: 15 }, (_, i) => i + 1)]);
        for (const [index, hole] of result.holes.entries()) {
          const block = Math.floor(index / size) % 3;
          const pattern = mode === 'approach' ? 2 - block : block;
          expect(hole.sides).toEqual(pairings[pattern]);
          expect(result.players.map((player) => player.holes[index]?.points)).toEqual(totals[pattern]);
          expect(result.awards.filter((award) => award.number === hole.number && award.kind === 'high-low-sweep'))
            .toHaveLength(pattern === 2 ? 0 : 1);
        }
        expect(result.awards.every((award) => award.dots === 1 && award.multiplier === 1)).toBe(true);
      }
    });

    it.each(['full-course-v1', 'group-low-v1'] as const)('uses %s with signed plus nine-hole CH once and personal tee allocations', (rule) => {
      const f = rotatingV3(6, 'tee-flip', rule, 7, 9);
      const context = { ...f.context, courseHandicaps: f.ids.map((playerId, index) =>
        ({ playerId, courseHandicap: [-2, 0, 6, 3][index] ?? 3 })) };
      const result = calculateDotsHighLow(f.game, context, f.records);
      expect(result.players.map((player) => player.playingHandicap)).toEqual(
        rule === 'full-course-v1' ? [-2, 0, 6, 3] : [0, 2, 8, 5]);
      expect(result.holes.find((hole) => hole.number === 8)?.contests[0]?.aScore).toBe(rule === 'full-course-v1' ? 6 : 5);
      const personal = { ...context, playerTees: [{
        playerId: f.ids[0] ?? '', profile: { ...f.snapshot.teeProfile,
          holes: context.layout.map((hole) => ({ ...hole, allocation: 10 - hole.allocation })) },
      }] };
      expect(calculateDotsHighLow(f.game, personal, f.records).holes.find((hole) => hole.number === 8)?.contests[0]?.aScore)
        .toBe(5);
    });

    it('awards no Sweep for tied, split, unavailable or pending lanes, retaining known zero and partial lanes', () => {
      const f = rotatingV3();
      const replace = (scores: readonly HoleScore[]) => ({ ...f.context,
        courseHandicaps: f.ids.map((playerId) => ({ playerId, courseHandicap: 0 })),
        cards: f.context.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) =>
          hole.number === 1 ? { ...hole, score: scores[index] ?? hole.score } : hole) })) });
      const strokes = (value: number): HoleScore => ({ kind: 'strokes', strokes: value });
      for (const scores of [
        [strokes(4), strokes(4), strokes(4), strokes(4)],
        [strokes(3), strokes(7), strokes(4), strokes(5)],
        [{ kind: 'picked-up', reportedStrokes: 7 }, strokes(4), strokes(6), strokes(5)],
        [{ kind: 'did-not-finish' }, { kind: 'picked-up' }, strokes(6), strokes(5)],
        [{ kind: 'unplayed' }, strokes(4), strokes(6), strokes(5)],
      ] satisfies readonly (readonly HoleScore[])[]) {
        const result = calculateDotsHighLow(f.game, replace(scores), f.records);
        expect(result.awards.filter((award) => award.number === 1 && award.kind === 'high-low-sweep')).toEqual([]);
        if (scores.every((score) => score.kind === 'strokes' && score.strokes === 4)) {
          expect(result.players.map((player) => player.holes[0]?.points)).toEqual([0, 0, 0, 0]);
        } else if (scores[0]?.kind === 'did-not-finish') {
          expect(result.holes[0]?.status).toBe('unavailable');
          expect(result.players.map((player) => player.holes[0]?.points)).toEqual([0, 0, 1, 1]);
        } else if (scores[0]?.kind === 'unplayed') expect(result.holes[0]?.status).toBe('pending');
      }
      expect(calculateDotsHighLow(f.game, f.context, []).players.every((player) => player.totalPoints === null)).toBe(true);
      expect(calculateDotsHighLow(f.game, { ...f.context, courseHandicaps: [] }, f.records).status).toBe('unavailable');
    });

    it('keeps gross qualifiers independent when net bogey five becomes four', () => {
      const f = rotatingV3();
      const game = { ...f.game, specials: [{ kind: 'string' as const, units: 1 },
        { kind: 'birdie' as const, units: 2 }, { kind: 'hogan' as const, units: 1 }] };
      const context = { ...f.context, stringRulesVersion: 2 as const,
        courseHandicaps: f.ids.map((playerId) => ({ playerId, courseHandicap: 18 })),
        cards: f.context.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
          ...hole, score: { ...hole.score, kind: 'strokes' as const, strokes: index < 2 ? 5 : 6 },
        })) })) };
      const result = calculateInternalGameResults([game], context).get(game.id);
      expect(result?.dotsHighLow?.holes[0]?.contests).toMatchObject([{ aScore: 4, bScore: 5 }, { aScore: 4, bScore: 5 }]);
      expect(result?.dots?.awards).toEqual([]);
      const record = f.records[0];
      if (!record) throw new Error('Missing fictional receipt');
      expect(dotsRecordsMatchGame([{ ...record, players: [{ playerId: f.ids[0] ?? '', counts: { hogan: 1 }, calls: [] }] }],
        game, dotsInputFromScores(context))).toBe(false);
    });

    it('keeps receipt origins immutable across raw corrections and clears, while recomputing current awards', () => {
      const f = rotatingV3(6, 'approach', 'full-course-v1', 16);
      const record = f.records[0];
      if (!record?.rotation) throw new Error('Missing fictional receipt');
      const late = { ...record, rotation: { ...record.rotation, recordedLate: true as const } };
      const corrected = { ...f.context, cards: f.context.cards.map((card, index) => ({ ...card,
        holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'strokes' as const, strokes: index < 2 ? 3 : 7 } })) })) };
      const result = calculateDotsHighLow(f.game, corrected, [late]);
      expect(result.holes[0]?.number).toBe(16);
      expect(result.holes[0]?.sides).toEqual([[f.ids[0], f.ids[3]], [f.ids[1], f.ids[2]]]);
      expect(result.holes[0]?.contests.map((contest) => contest.status)).toEqual(['tied', 'tied']);
      const clear = { ...late, players: [], contests: [] };
      expect(mergeDotsRecords([clear], [late])[0]?.rotation).toEqual(late.rotation);
      expect(() => mergeDotsRecords([{ ...clear, rotation: { playerIds: [...f.ids].reverse() } }], [late])).toThrow();
      expect(calculateDots(f.game, dotsInputFromScores(corrected), [late]).rotation?.rotation?.recordedLate).toBe(true);
    });

    it('keeps automatic High/Low, manual and category Sweeps separate and settles their combined totals once', () => {
      const f = rotatingV3();
      const game = { ...f.game, sweepRule: 'manual-v1' as const,
        specials: [{ kind: 'sweep' as const, units: 2 }, { kind: 'long-drive' as const, units: 1 },
          { kind: 'blue-plate' as const, units: 1 }] };
      const record = f.records[0];
      if (!record) throw new Error('Missing fictional receipt');
      const saved = { ...record, players: [{ playerId: f.ids[0] ?? '', counts: { sweep: 1 }, calls: [] }],
        contests: [{ kind: 'long-drive' as const, status: 'awarded' as const, winnerId: f.ids[0] ?? '' },
          { kind: 'blue-plate' as const, status: 'awarded' as const, winnerId: f.ids[0] ?? '' }] };
      const context = { ...f.context, dotsCategorySweepsVersion: 1 as const,
        layout: f.context.layout.map((hole) => ({ ...hole, par: 5 })),
        courseHandicaps: f.ids.map((playerId) => ({ playerId, courseHandicap: 0 })),
        cards: f.context.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
          ...hole, score: { kind: 'strokes' as const, strokes: index < 2 ? 5 : 6,
            ...(index === 0 && hole.number === 1 ? { dots: [saved] } : {}) },
        })) })) };
      const result = calculateInternalGameResults([game], context).get(game.id);
      expect(result?.dotsHighLow?.awards.filter((award) => award.number === 1).map((award) => award.kind))
        .toEqual(['high', 'low', 'high-low-sweep']);
      expect(result?.dots?.awards.filter((award) => award.number === 1).map((award) => award.kind))
        .toEqual(expect.arrayContaining(['sweep', 'category-sweep', 'long-drive', 'blue-plate']));
      expect(result?.players.map((player) => player.holes.find((hole) => hole.number === 1)?.points)).toEqual([8, 8, 0, 0]);
      const settlements = calculateInternalSettlements([game], result ? [result] : [], context);
      expect(settlements).toHaveLength(1);
      expect(settlements[0]?.players.map((player) => [player.baseDots, player.specialDots])).toEqual([[18, 5], [18, 5], [0, 0], [0, 0]]);
      expect(settlements[0]?.players.map((player) => player.netMinor)).toEqual([4600, 4600, -4600, -4600]);
      expect(settlements[0]?.totalToSettleMinor).toBe(9200);
    });

    it('keeps v3 combined overflow unavailable instead of publishing or settling an exact-looking truncated total', () => {
      const f = rotatingV3();
      const game = { ...f.game, specials: [{ kind: 'other' as const, units: Number.MAX_SAFE_INTEGER }] };
      const record = f.records[0];
      if (!record) throw new Error('Missing fictional receipt');
      const context = { ...f.context, cards: f.context.cards.map((card, index) => index !== 0 ? card : {
        ...card, holes: card.holes.map((hole) => hole.number !== 1 ? hole : { ...hole, score: { ...hole.score, dots: [{
          ...record, players: [{ playerId: f.ids[0] ?? '', counts: { other: 1 }, calls: [] }],
        }] } }),
      }) };
      const result = calculateInternalGameResults([game], context).get(game.id);
      expect(result?.dotsHighLow?.players[0]?.holes[0]?.points).toBe(3);
      expect(result?.dots?.players[0]?.totalPoints).toBe(Number.MAX_SAFE_INTEGER);
      expect(result?.players[0]).toMatchObject({ status: 'unavailable', totalPoints: null });
      expect(calculateInternalSettlements([game], result ? [result] : [], context)[0]?.status).toBe('unavailable');
    });
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
