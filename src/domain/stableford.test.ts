import { describe, expect, it } from 'vitest';
import type { CourseRating } from './catalog.js';
import type { GamePlayerResult, IndividualGameDefinition, RoundGameDefinition, StablefordPreset, TeamGameDefinition, TeamGameFormat } from './games.js';
import { defaultHandicapAllowancePercent, maximumExactGamePoints, maximumExactPointsForGame, teamSize } from './games.js';
import type { HoleScore, Scorecard } from './scoring.js';
import { summarizeGross } from './scoring.js';
import type { RoundSnapshot } from './setup.js';
import { calculateCourseHandicap, calculateGameResults, calculatePlayingHandicap, stablefordPoints } from './stableford.js';
import { publishedCourseHandicaps } from './playing-handicaps.js';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
function game(preset: StablefordPreset = 'standard', overrides: Partial<IndividualGameDefinition> = {}): IndividualGameDefinition {
  return {
    id: id(1), name: 'Fictional Stableford', preset, basis: 'gross',
    handicapAllowancePercent: defaultHandicapAllowancePercent, points: stablefordPoints(preset), ...overrides,
  };
}
function fixture(count = 18, index: string | null = '0', course = count * 4, slope = 113) {
  const holes = Array.from({ length: count }, (_, number) => ({
    number: number + 1, sourceId: number + 301, par: 4, length: 350, allocation: number + 1,
  }));
  const ratings: readonly CourseRating[] = [
    { type: 'Total', course, slope, bogey: 90 },
    { type: 'Front', course: course / 2, slope, bogey: 45 },
    { type: 'Back', course: course / 2, slope, bogey: 45 },
  ];
  const players = [4, 2, 3, 1].map((number) => ({
    playerId: id(number + 100), displayName: `Fictional golfer ${String(number)}`,
    handicapIndex: index === null ? null : {
      id: id(500 + number), value: index, effectiveDate: '2026-01-01', source: 'Fictional manual observation',
      recordedAt: '2026-01-01T00:00:00Z', recordedBy: { tenantId: id(600), objectId: id(601) }, previousObservationId: null,
    },
  }));
  const round: RoundSnapshot = {
    id: id(200), name: 'Fictional round', courseId: 'ghin:801:802', courseVersionId: 'a'.repeat(64),
    course: {
      provider: 'usga-ghin', sourceId: 802, name: 'Fictional course', status: 'Active', number: null,
      city: 'Fictional city', state: 'Fictional state',
      facility: { id: 801, status: 'Active', name: 'Fictional facility', number: null, golfAssociationId: 803,
        address: 'Fictional address', longitude: 0, latitude: 0 },
      season: { name: 'All year', allYear: true, start: '01/01', end: '12/31' },
    },
    teeProfile: { id: 700, name: 'Fictional tee', category: 'Fictional category', holeCount: count,
      totalYardage: count * 350, totalMeters: count * 320, totalPar: count * 4,
      strokeAllocation: true, shorter: false, eligibleSides: 'All', ratings, holes },
    groups: [{ number: 1, playerIds: players.map((player) => player.playerId) }], players,
  };
  const cards: readonly Scorecard[] = players.map((player) => ({
    playerId: player.playerId, displayName: player.displayName, etag: 'fictional-card', updatedAt: '2026-01-01T00:00:00Z',
    holes: holes.map((hole) => ({ number: hole.number, score: { kind: 'strokes', strokes: 4 } })),
  }));
  return { round, cards };
}
function first(games: readonly RoundGameDefinition[], round: RoundSnapshot, cards: readonly Scorecard[]): GamePlayerResult {
  const result = calculateGameResults(games, round, cards)[0]?.players[0];
  if (!result) throw new Error('Missing fictional result');
  return result;
}
function scores(cards: readonly Scorecard[], values: readonly HoleScore[]): readonly Scorecard[] {
  return cards.map((card) => ({
    ...card, holes: card.holes.map((hole, index) => ({ ...hole, score: values[index] ?? { kind: 'unplayed' } })),
  }));
}

describe('course handicaps from captured inputs', () => {
  it.each([
    [18, '0', 0], [18, '10.5', 11], [18, '+2.5', -2],
    [9, '5.5', 3], [9, '+5.5', -3],
  ] as const)('calculates %s holes with index %s as %s, using exact rounding', (count, index, expected) => {
    expect(calculateCourseHandicap(index, fixture(count, index).round.teeProfile)).toBe(expected);
  });
  it('does not apply a game allowance or require stroke allocations for a course handicap', () => {
    const tee = fixture(18, '10.5').round.teeProfile;
    expect(calculateCourseHandicap('10.5', tee)).toBe(11);
    expect(calculatePlayingHandicap('10.5', tee, 95)).toBe(10);
    const missing = { ...tee, strokeAllocation: false, holes: tee.holes.map((hole) => ({ ...hole, allocation: 0 })) };
    expect(calculateCourseHandicap('10.5', missing)).toBe(11);
    expect(calculatePlayingHandicap('10.5', missing, 100)).toBe('missing-stroke-index');
    expect(calculateCourseHandicap('not-an-index', tee)).toBe('invalid-handicap-index');
    expect(calculateCourseHandicap('10.5', { ...tee, ratings: [] })).toBe('missing-tee-ratings');
  });
  it('publishes each golfer own captured tee and distinguishes NH from unavailable ratings', () => {
    const { round } = fixture(18, '10.5');
    const player = round.players[0];
    if (!player) throw new Error('Missing fictional golfer.');
    const personal = { ...round.teeProfile, id: 701,
      ratings: round.teeProfile.ratings.map((rating) => rating.type === 'Total' ? { ...rating, course: 74 } : rating) };
    const captured = { ...round, playerTees: [{ playerId: player.playerId, profile: personal }] };
    const unchanged = structuredClone(captured);
    expect(publishedCourseHandicaps(captured).map((entry) => entry.courseHandicap)).toEqual([13, 11, 11, 11]);
    expect(captured).toEqual(unchanged);
    expect(publishedCourseHandicaps(fixture(18, null).round)[0]).toMatchObject({
      courseHandicap: null, unavailableReason: 'missing-handicap-index',
    });
    expect(publishedCourseHandicaps({ ...round,
      players: round.players.map(({ playerId, displayName }) => ({ playerId, displayName })),
    })[0]).toMatchObject({ courseHandicap: null, unavailableReason: 'uncaptured-handicap-index' });
    expect(publishedCourseHandicaps({ ...round, teeProfile: { ...round.teeProfile, ratings: [] } })[0]).toMatchObject({
      courseHandicap: null, unavailableReason: 'missing-tee-ratings',
    });
  });
});

describe('individual captured tees in shared round games', () => {
  it('uses each golfer own par for gross points, without changing others or raw strokes', () => {
    const f = fixture();
    const selected = f.round.players[0];
    if (!selected) throw new Error('Missing fictional golfer.');
    const alternate = { ...f.round.teeProfile, id: 701, name: 'Fictional alternate', totalPar: f.round.teeProfile.totalPar + 1,
      holes: f.round.teeProfile.holes.map((hole) => ({ ...hole, par: hole.number === 1 ? 5 : hole.par })) };
    const round = { ...f.round, playerTees: [{ playerId: selected.playerId, profile: alternate }] };
    const cards = scores(f.cards, [{ kind: 'strokes', strokes: 4 }]);
    const before = structuredClone(cards);
    const results = calculateGameResults([game()], round, cards)[0]?.players;
    expect(results?.[0]?.totalPoints).toBe(3);
    expect(results?.[1]?.totalPoints).toBe(2);
    expect(cards).toEqual(before);
  });
  it('uses personal ratings and stroke indexes for net points rather than the common tee', () => {
    const f = fixture(18, '2');
    const selected = f.round.players[0];
    if (!selected) throw new Error('Missing fictional golfer.');
    const alternate = { ...f.round.teeProfile, id: 701,
      holes: f.round.teeProfile.holes.map((hole) => ({ ...hole, allocation: 19 - hole.number })) };
    const round = { ...f.round, playerTees: [{ playerId: selected.playerId, profile: alternate }] };
    const cards = scores(f.cards, [{ kind: 'strokes', strokes: 4 }]);
    const result = calculateGameResults([game('standard', { basis: 'net', handicapAllowancePercent: 100 })], round, cards)[0];
    expect(result?.players[0]?.holes[0]).toMatchObject({ points: 2, strokesReceived: 0 });
    expect(result?.players[1]?.holes[0]).toMatchObject({ points: 3, strokesReceived: 1 });
    const rated = { ...alternate, ratings: alternate.ratings.map((rating) => rating.type === 'Total'
      ? { ...rating, course: 76 } : rating) };
    const ratedResult = calculateGameResults([game('standard', { basis: 'net', handicapAllowancePercent: 100 })],
      { ...f.round, playerTees: [{ playerId: selected.playerId, profile: rated }] }, cards)[0];
    expect(ratedResult?.players[0]?.playingHandicap).toBe(6);
    expect(ratedResult?.players[1]?.playingHandicap).toBe(2);
  });
});

describe('configurable gross Stableford', () => {
  it('treats a par-three hole-in-one as an eagle, not an albatross or a separate automatic bonus', () => {
    const f = fixture();
    const round = { ...f.round, teeProfile: { ...f.round.teeProfile,
      totalPar: 71, holes: f.round.teeProfile.holes.map((hole) => hole.number === 1 ? { ...hole, par: 3 } : hole),
    } };
    const cards = scores(f.cards, [{ kind: 'strokes', strokes: 1 }]);
    expect(first([game('standard')], round, cards).totalPoints).toBe(4);
    expect(first([game('modified')], round, cards).totalPoints).toBe(5);
  });
  it('creates independent editable templates with explicit tails and a 95 percent setup default', () => {
    expect(defaultHandicapAllowancePercent).toBe(95);
    expect(stablefordPoints('standard')).toEqual({
      rows: [-4, -3, -2, -1, 0, 1, 2].map((scoreToPar, index) => ({ scoreToPar, points: 6 - index })),
      betterScorePoints: 6, worseScorePoints: 0,
    });
    expect(stablefordPoints('modified')).toEqual({
      rows: [-3, -2, -1, 0, 1, 2].map((scoreToPar, index) => ({ scoreToPar, points: [8, 5, 2, 0, -1, -2][index] })),
      betterScorePoints: 8, worseScorePoints: -2,
    });
    const template = stablefordPoints('standard');
    expect(template).not.toBe(stablefordPoints('standard'));
    expect(template.rows[0]).not.toBe(stablefordPoints('standard').rows[0]);
    Object.freeze(template.rows);
    expect(stablefordPoints('standard').rows).toHaveLength(7);
  });

  it.each([
    ['standard', [5, 4, 3, 2, 1, 0, 0]],
    ['modified', [8, 5, 2, 0, -1, -2, -2]],
  ] as const)('scores every reachable seed band and worse tail for %s', (preset, expected) => {
    const f = fixture();
    const cards = scores(f.cards, [1, 2, 3, 4, 5, 6, 12].map((strokes) => ({ kind: 'strokes', strokes })));
    expect(first([game(preset)], f.round, cards).holes.slice(0, 7).map((hole) => hole.points)).toEqual(expected);
  });

  it('honors custom extended rows and both tails, including negative values and non-monotonic minima', () => {
    const f = fixture();
    const custom = game('modified', {
      points: { rows: [-6, -5, -4, -3, -2, -1, 0].map((scoreToPar) => ({ scoreToPar, points: scoreToPar })),
        betterScorePoints: 20, worseScorePoints: -10 },
    });
    const round = { ...f.round, teeProfile: { ...f.round.teeProfile,
      holes: f.round.teeProfile.holes.map((hole) => ({ ...hole, par: 10 })) } };
    const cards = scores(f.cards, [1, 4, 5, 6, 7, 8, 9, 10, 11].map((strokes) => ({ kind: 'strokes', strokes })));
    expect(first([custom], round, cards).holes.slice(0, 9).map((hole) => hole.points)).toEqual([20, -6, -5, -4, -3, -2, -1, 0, -10]);
    const minimum = game('standard', { points: { rows: [{ scoreToPar: 0, points: -30 }], betterScorePoints: 5, worseScorePoints: -20 } });
    expect(first([minimum], f.round, scores(f.cards, [{ kind: 'picked-up' }])).totalPoints).toBe(-30);
  });

  it.each(['standard', 'modified'] as const)('uses configured minimum for X, X7 and DNF without altering gross records (%s)', (preset) => {
    const f = fixture();
    const cards = scores(f.cards, [{ kind: 'picked-up' }, { kind: 'picked-up', reportedStrokes: 7 }, { kind: 'did-not-finish' }]);
    const before = structuredClone(cards);
    const result = first([game(preset)], f.round, cards);
    const minimum = preset === 'standard' ? 0 : -2;
    expect(result.holes.slice(0, 3).map((hole) => hole.points)).toEqual([minimum, minimum, minimum]);
    expect(result).toMatchObject({ holesScored: 3, status: 'in-progress', totalPoints: minimum * 3, backPoints: null });
    expect(cards).toEqual(before);
    expect(summarizeGross(cards[0]?.holes ?? [])).toMatchObject({ recordedStrokes: 7, completeGross: null });
    const configured = game(preset, { points: { ...stablefordPoints(preset), betterScorePoints: -15 } });
    expect(first([configured], f.round, cards).totalPoints).toBe(-45);
  });

  it.each([9, 18])('keeps pending holes null and computes exact front/back and complete totals on %s holes', (count) => {
    const f = fixture(count, null);
    const blank = first([game()], f.round, scores(f.cards, []));
    expect(blank).toMatchObject({ playingHandicap: null, holesScored: 0, status: 'in-progress',
      frontPoints: null, backPoints: null, totalPoints: null, totalHoles: count });
    expect(blank.holes.every((hole) => hole.points === null && hole.strokesReceived === 0)).toBe(true);
    const complete = first([game()], f.round, f.cards);
    expect(complete).toMatchObject({ status: 'complete', holesScored: count, frontPoints: 18,
      backPoints: count === 18 ? 18 : null, totalPoints: count * 2 });
    const dispositions = scores(f.cards, Array.from({ length: count }, () => ({ kind: 'did-not-finish' })));
    expect(first([game('modified')], f.round, dispositions)).toMatchObject({ status: 'complete', totalPoints: count * -2 });
  });

  it('preserves game/player order, sorts a copied source layout and never mutates round or cards', () => {
    const f = fixture();
    const round = { ...f.round, teeProfile: { ...f.round.teeProfile, holes: [...f.round.teeProfile.holes].reverse() } };
    const definitions = [game('modified', { id: id(2) }), game()];
    const before = structuredClone({ round, cards: f.cards, definitions });
    const results = calculateGameResults(definitions, round, [...f.cards].reverse());
    expect(results.map((result) => result.gameId)).toEqual([id(2), id(1)]);
    expect(results[0]?.players.map((player) => player.playerId)).toEqual(round.players.map((player) => player.playerId));
    expect(results[0]?.players[0]?.holes.map((hole) => hole.number)).toEqual(Array.from({ length: 18 }, (_, index) => index + 1));
    expect({ round, cards: f.cards, definitions }).toEqual(before);
    expect(calculateGameResults([], round, f.cards)).toEqual([]);
  });

  it('sums the largest admitted signed points without precision loss', () => {
    const f = fixture();
    for (const sign of [-1, 1]) {
      const points = maximumExactGamePoints * sign;
      const custom = game('standard', { points: { rows: [{ scoreToPar: 0, points }], betterScorePoints: points, worseScorePoints: points } });
      expect(first([custom], f.round, f.cards).totalPoints).toBe(Number(BigInt(points) * 18n));
    }
  });
});

describe('captured-handicap net Stableford', () => {
  it.each([
    ['25', 25, [2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]],
    ['+2', -2, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1, -1]],
    ['0', 0, Array<number>(18).fill(0)],
    ['99.9', 100, [...Array<number>(10).fill(6), ...Array<number>(8).fill(5)]],
  ] as const)('allocates signed PH for captured HI %s', (index, handicap, strokes) => {
    const f = fixture(18, index);
    const result = first([game('standard', { basis: 'net', handicapAllowancePercent: 100 })], f.round, f.cards);
    expect(result.playingHandicap).toBe(handicap);
    expect(result.holes.map((hole) => hole.strokesReceived)).toEqual(strokes);
    expect(result.holes.reduce((sum, hole) => sum + (hole.strokesReceived ?? 0), 0)).toBe(handicap);
  });

  function teamGame(round: RoundSnapshot, format: TeamGameFormat, preset: StablefordPreset = 'standard'): TeamGameDefinition {
    const size = teamSize(format);
    return {
      ...game(preset), basis: 'net', handicapAllowancePercent: 100, format,
      teams: Array.from({ length: round.players.length / size }, (_, index) => ({
        id: id(900 + index), name: `Fictional team ${String(index + 1)}`,
        playerIds: round.players.slice(index * size, (index + 1) * size).map((player) => player.playerId),
      })),
    };
  }

  describe('saved individual net points feed competition teams', () => {
    it.each([
      ['two-net-better-ball', 'standard', 2], ['two-net-aggregate', 'standard', 4],
      ['four-two-net', 'standard', 4], ['four-two-net', 'modified', 0],
    ] as const)('supports %s / %s without changing underlying golfer rows or groups', (format, preset, perHole) => {
      const f = fixture();
      const definition = teamGame(f.round, format, preset);
      const before = structuredClone({ ...f, definition });
      const result = calculateGameResults([definition], f.round, f.cards)[0];
      expect(result?.players).toEqual(calculateGameResults([game(preset, { basis: 'net', handicapAllowancePercent: 100 })], f.round, f.cards)[0]?.players);
      expect(result?.players).toHaveLength(4);
      expect(result?.teams?.[0]).toMatchObject({
        status: 'complete', holesScored: 18, frontPoints: perHole * 9, backPoints: perHole * 9, totalPoints: perHole * 18,
      });
      expect({ ...f, definition }).toEqual(before);
      expect(calculateGameResults([game()], f.round, f.cards)[0]).not.toHaveProperty('teams');
    });

    it('selects points, never strokes: nonmonotonic custom values change counting golfers per hole', () => {
      const f = fixture();
      const definition: TeamGameDefinition = {
        ...teamGame(f.round, 'four-two-net'),
        points: { rows: [{ scoreToPar: -1, points: -5 }, { scoreToPar: 0, points: 0 },
          { scoreToPar: 1, points: 8 }, { scoreToPar: 2, points: -2 }], betterScorePoints: 1, worseScorePoints: -9 },
      };
      const cards = f.cards.map((card, index) => ({
        ...card, holes: card.holes.map((hole) => ({
          ...hole, score: { kind: 'strokes' as const, strokes: 3 + (index + hole.number - 1) % 4 },
        })),
      }));
      const result = calculateGameResults([definition], f.round, cards)[0];
      expect(result?.teams?.[0]?.holes.map((hole) => hole.points)).toEqual(Array<number>(18).fill(8));
      expect(result?.teams?.[0]?.totalPoints).toBe(144);
    });

    it.each([9, 18])('applies signed individual handicaps, pickup/DNF minima and manual entries before aggregation on %s holes', (count) => {
      const f = fixture(count, '+2');
      const definition = teamGame(f.round, 'two-net-aggregate', 'modified');
      const cards = scores(f.cards, [{ kind: 'picked-up', reportedStrokes: 7 }, { kind: 'did-not-finish' },
        { kind: 'strokes', strokes: 4 }]);
      const result = calculateGameResults([definition], f.round, cards)[0];
      expect(result?.teams?.[0]).toMatchObject({
        status: 'in-progress', holesScored: 3, totalPoints: -8, backPoints: null,
      });
      expect(result?.teams?.[0]?.holes.slice(0, 4)).toEqual([
        { number: 1, points: -4 }, { number: 2, points: -4 }, { number: 3, points: 0 }, { number: 4, points: null },
      ]);
      expect(result?.players[0]?.playingHandicap).toBe(count === 9 ? -1 : -2);
      expect(cards[0]?.holes[2]?.score).toEqual({ kind: 'strokes', strokes: 4 });
      const partial = cards.map((card, index) => index !== 0 ? card : ({
        ...card, holes: card.holes.map((hole) => hole.number !== 3 ? hole : { ...hole, score: { kind: 'unplayed' as const } }),
      }));
      expect(calculateGameResults([definition], f.round, partial)[0]?.teams?.[0]?.holes[2]?.points).toBeNull();
    });

    it('marks affected teams unavailable for missing index or card data instead of scoring their other teammates', () => {
      const f = fixture();
      const definition = teamGame(f.round, 'four-two-net');
      const round = { ...f.round, players: f.round.players.map((player, index) => index !== 3 ? player : ({ ...player, handicapIndex: null })) };
      expect(calculateGameResults([definition], round, f.cards)[0]?.teams?.[0]).toMatchObject({
        status: 'unavailable', unavailableReason: 'missing-handicap-index', totalPoints: null, holesScored: 0,
      });
      expect(calculateGameResults([definition], f.round, f.cards.slice(1))[0]?.teams?.[0]).toMatchObject({
        status: 'unavailable', unavailableReason: 'missing-score-data', totalPoints: null, holesScored: 0,
      });
    });

    it('keeps stale saved assignments repairable without inventing partners or emitting old team points', () => {
        const f = fixture();
        const definition = teamGame(f.round, 'two-net-better-ball');
        const round = { ...f.round, players: f.round.players.map((player, index) => index !== 3 ? player : ({
          ...player, playerId: id(999),
        })) };
        const cards = f.cards.map((card, index) => index !== 3 ? card : ({ ...card, playerId: id(999) }));
        const before = structuredClone({ definition, round, cards });
        const result = calculateGameResults([definition], round, cards)[0];
        expect(result).toMatchObject({ gameId: definition.id, teamSetupRequired: true, teams: [] });
        expect(result?.players.map((player) => player.playerId)).toEqual(round.players.map((player) => player.playerId));
        expect(result?.players.every((player) => player.status === 'complete')).toBe(true);
        expect({ definition, round, cards }).toEqual(before);
        expect(calculateGameResults([definition], f.round, f.cards)[0]).not.toHaveProperty('teamSetupRequired');
        expect(calculateGameResults([game()], round, cards)[0]).not.toHaveProperty('teamSetupRequired');
    });

    it.each(['two-net-better-ball', 'two-net-aggregate', 'four-two-net'] as const)('sums signed exact admitted budgets for %s without precision loss', (format) => {
      const f = fixture();
      for (const sign of [-1, 1]) {
        const base = teamGame(f.round, format);
        const points = maximumExactPointsForGame(base) * sign;
        const definition = { ...base, points: { rows: [{ scoreToPar: 0, points }], betterScorePoints: points, worseScorePoints: points } };
        const result = calculateGameResults([definition], f.round, f.cards)[0];
        const expected = BigInt(points) * 18n * (format === 'two-net-better-ball' ? 1n : 2n);
        expect(result?.teams?.[0]?.totalPoints).toBe(Number(expected));
        expect(Number.isSafeInteger(result?.teams?.[0]?.totalPoints)).toBe(true);
      }
    });
  });

  it.each([
    [18, '+2.5', 72, 113, 100, -2],
    [18, '2.5', 72, 113, 100, 3],
    [9, '+3.5', 36.2, 113, 100, -1],
    [9, '+2.9', 36, 113, 100, -1],
    [9, '2.9', 36, 113, 100, 2],
    [18, '10', 72.5, 113, 95, 10],
    [18, '10', 71.5, 113, 95, 9],
    [18, '+10', 71.5, 113, 95, -10],
    [18, '10', 72.49, 113, 95, 10],
    [18, '10', 72.5000000001, 113, 95, 10],
    [18, '10', 72, 114, 95, 10],
    [18, '1.5', 72, 113, 100, 2],
    [18, '+1.5', 72, 113, 100, -1],
    [18, '10', 72, 113, 95, 10],
    [18, '+10', 72, 113, 95, -9],
    [18, '0', 72.49999999999999, 113, 100, 0],
    [18, '0', 72.50000000000001, 113, 100, 1],
  ])('uses exact unrounded CH and final positive-infinity ties (%s, %s, %s, %s, %s)', (count, index, course, slope, allowance, expected) => {
    const f = fixture(count, index, course, slope);
    expect(first([game('standard', { basis: 'net', handicapAllowancePercent: allowance })], f.round, f.cards).playingHandicap).toBe(expected);
  });

  it('uses the saved nine-hole Total rating, allocation 1..9 and rounded half HI, not Front or Back', () => {
    const f = fixture(9, '25');
    const result = first([game('standard', { basis: 'net', handicapAllowancePercent: 100 })], f.round, f.cards);
    expect(result.playingHandicap).toBe(13);
    expect(result.holes.map((hole) => hole.strokesReceived)).toEqual([2, 2, 2, 2, 1, 1, 1, 1, 1]);
    const plus = fixture(9, '+4');
    expect(first([game('standard', { basis: 'net', handicapAllowancePercent: 100 })], plus.round, plus.cards)
      .holes.map((hole) => hole.strokesReceived)).toEqual([0, 0, 0, 0, 0, 0, 0, -1, -1]);
  });

  it('uses the complete selected nine-hole Total rating even when side ratings differ or Total is missing', () => {
    const f = fixture(9, '+3.5', 36.2, 113);
    const round = { ...f.round, teeProfile: { ...f.round.teeProfile, ratings: [
      { type: 'Total', course: 36.2, slope: 113, bogey: 45 },
      { type: 'Front', course: 20, slope: 90, bogey: 25 },
      { type: 'Back', course: 50, slope: 140, bogey: 60 },
    ] satisfies readonly CourseRating[] } };
    const net = game('standard', { basis: 'net', handicapAllowancePercent: 100 });
    expect(first([net], round, f.cards).playingHandicap).toBe(-1);
    const missingTotal = { ...round, teeProfile: { ...round.teeProfile,
      ratings: round.teeProfile.ratings.filter((rating) => rating.type !== 'Total') } };
    expect(first([net], missingTotal, f.cards).unavailableReason).toBe('missing-tee-ratings');
  });

  it('applies each game allowance independently and uses captured index without modifying it', () => {
    const f = fixture(18, '20', 73);
    const results = calculateGameResults([
      game('standard', { basis: 'net', handicapAllowancePercent: 100 }),
      game('modified', { id: id(2), basis: 'net', handicapAllowancePercent: 50 }),
      game('standard', { id: id(3) }),
    ], f.round, f.cards);
    expect(results.map((result) => result.players[0]?.playingHandicap)).toEqual([21, 11, null]);
    expect(f.round.players[0]?.handicapIndex?.value).toBe('20');
    expect(results[0]?.players[0]?.totalPoints).toBe(57);
  });

  it('gives explicit unavailable reasons without inventing score, handicap, rating or allocation defaults', () => {
    const f = fixture();
    const net = game('standard', { basis: 'net' });
    const noIndex = fixture(18, null);
    expect(first([net], noIndex.round, noIndex.cards).unavailableReason).toBe('missing-handicap-index');
    const absent = { ...f.round, players: f.round.players.map(({ playerId, displayName }) => ({ playerId, displayName })) };
    expect(first([net], absent, f.cards).unavailableReason).toBe('missing-handicap-index');
    const invalid = fixture(18, '-2.5');
    expect(first([net], invalid.round, invalid.cards).unavailableReason).toBe('invalid-handicap-index');
    for (const index of ['100', ' 2.5', '2.55', 'NaN']) {
      const malformed = fixture(18, index);
      expect(first([net], malformed.round, malformed.cards).unavailableReason).toBe('invalid-handicap-index');
    }
    const noRatings = { ...f.round, teeProfile: { ...f.round.teeProfile, ratings: [] } };
    expect(first([net], noRatings, f.cards).unavailableReason).toBe('missing-tee-ratings');
    const noAllocation = { ...f.round, teeProfile: { ...f.round.teeProfile, strokeAllocation: false } };
    expect(first([net], noAllocation, f.cards).unavailableReason).toBe('missing-stroke-index');
    const duplicateAllocation = { ...f.round, teeProfile: { ...f.round.teeProfile,
      holes: f.round.teeProfile.holes.map((hole) => ({ ...hole, allocation: 1 })) } };
    expect(first([net], duplicateAllocation, f.cards).unavailableReason).toBe('missing-stroke-index');
    expect(first([game()], noIndex.round, noIndex.cards).status).toBe('complete');
    expect(first([game()], noRatings, f.cards).status).toBe('complete');
    expect(first([game()], noAllocation, f.cards).status).toBe('complete');
    for (const cards of [[], f.cards.map((card) => ({ ...card, holes: card.holes.slice(1) }))]) {
      const result = first([game()], f.round, cards);
      expect(result).toMatchObject({ status: 'unavailable', unavailableReason: 'missing-score-data',
        playingHandicap: null, holesScored: 0, totalPoints: null, frontPoints: null, backPoints: null });
      expect(result.holes.every((hole) => hole.points === null && hole.strokesReceived === null)).toBe(true);
    }
  });
});
