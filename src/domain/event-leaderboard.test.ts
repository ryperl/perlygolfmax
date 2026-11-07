import { describe, expect, it } from 'vitest';
import type { CourseRating } from './catalog.js';
import type { IndividualGameDefinition, RoundGameDefinition, TeamGameDefinition } from './games.js';
import { isStablefordGame, maximumExactGamePoints } from './games.js';
import type { HoleScore, RoundScores, Scorecard } from './scoring.js';
import { maximumExactHoleStrokes } from './scoring.js';
import type { EventWorkspace, OverallCompetition, RoundSnapshot } from './setup.js';
import { calculateGameResults, calculatePlayingHandicap, stablefordPoints } from './stableford.js';
import { calculateEventStandings } from './event-leaderboard.js';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const players = [1, 2, 3, 4].map((number) => ({
  playerId: id(number), displayName: `Fictional golfer ${String(number)}`,
  handicapIndex: {
    id: id(500 + number), value: '0', effectiveDate: '2026-01-01', source: 'Fictional manual observation',
    recordedAt: '2026-01-01T00:00:00Z', recordedBy: { tenantId: id(600), objectId: id(601) }, previousObservationId: null,
  },
}));
function definition(number: number, preset: 'standard' | 'modified' = 'standard'): IndividualGameDefinition {
  return { id: id(number), name: 'Fictional game', preset, basis: 'gross', handicapAllowancePercent: 95,
    points: stablefordPoints(preset) };
}
function fixture(roundCount = 1, holeCount = 9): { workspace: EventWorkspace; scores: readonly RoundScores[] } {
  const holes = Array.from({ length: holeCount }, (_, index) => ({
    number: index + 1, sourceId: 301 + index, length: 350, par: 4, allocation: index + 1,
  }));
  const ratings: readonly CourseRating[] = [
    { type: 'Total', course: holeCount * 4, slope: 113, bogey: 90 },
    { type: 'Front', course: 18, slope: 113, bogey: 45 },
    { type: 'Back', course: 18, slope: 113, bogey: 45 },
  ];
  const rounds: readonly RoundSnapshot[] = Array.from({ length: roundCount }, (_, index) => ({
    id: id(200 + index), name: `Fictional round ${String(index + 1)}`, courseId: 'ghin:801:802', courseVersionId: 'a'.repeat(64),
    course: {
      provider: 'usga-ghin', sourceId: 802, name: 'Fictional course', status: 'Active', number: null,
      city: 'Fictional city', state: 'Fictional state',
      facility: { id: 801, status: 'Active', name: 'Fictional facility', number: null, golfAssociationId: 803,
        address: 'Fictional address', longitude: 0, latitude: 0 },
      season: { name: 'All year', allYear: true, start: '01/01', end: '12/31' },
    },
    teeProfile: { id: 700, name: 'Fictional tee', category: 'Fictional category', holeCount,
      totalYardage: holeCount * 350, totalMeters: holeCount * 320, totalPar: holeCount * 4,
      strokeAllocation: true, shorter: null, eligibleSides: null, ratings, holes },
    groups: [{ number: 1, playerIds: players.map((player) => player.playerId) }], players,
  }));
  const workspace: EventWorkspace = {
    event: { id: id(100), name: 'Fictional Open', createdAt: '2026-01-01', role: 'owner', status: 'active', etag: 'current' },
    location: '', roster: players.map(({ playerId, displayName }) => ({ playerId, displayName })), rounds, etag: 'current',
    overallCompetition: { kind: 'stableford', credit: 'individual',
      roundGames: rounds.map((round, index) => ({ roundId: round.id, gameId: id(400 + index) })) },
  };
  const scores = rounds.map((round, index): RoundScores => {
    const cards: readonly Scorecard[] = players.map((player) => ({
      playerId: player.playerId, displayName: player.displayName, etag: 'fictional-card', updatedAt: '2026-01-01T00:00:00Z',
      holes: holes.map((hole) => ({ number: hole.number, score: { kind: 'strokes', strokes: 4 } })),
    }));
    const games = [definition(400 + index), definition(450 + index, 'modified')];
    return {
      eventId: workspace.event.id, eventName: workspace.event.name, eventStatus: 'active', roundId: round.id, roundName: round.name,
      courseName: round.course.name, teeName: round.teeProfile.name, teeCategory: round.teeProfile.category, teeRatings: ratings,
      layout: holes, groups: round.groups, cards, setupLocked: true, lastUpdatedAt: '2026-01-01T00:00:00Z',
      games: { configuration: { eventId: workspace.event.id, roundId: round.id, etag: 'fictional-games', games },
        results: calculateGameResults(games, round, cards) },
    };
  });
  return { workspace, scores };
}
function recalculate(
  f: ReturnType<typeof fixture>, scores: (card: Scorecard, index: number) => readonly HoleScore[],
  definitions?: readonly RoundGameDefinition[],
) {
  return f.scores.map((source) => {
    const round = f.workspace.rounds.find((entry) => entry.id === source.roundId);
    if (!round || !source.games) throw new Error('Missing fictional round');
    const cards = source.cards.map((card, index) => {
      const entries = scores(card, index);
      return { ...card, holes: card.holes.map((hole, holeIndex) => ({ ...hole, score: entries[holeIndex] ?? { kind: 'unplayed' as const } })) };
    });
    const games = definitions ?? source.games.configuration.games;
    return { ...source, cards, games: { configuration: { ...source.games.configuration, games },
      results: calculateGameResults(games, round, cards) } };
  });
}
function competition(workspace: EventWorkspace, overallCompetition: OverallCompetition): EventWorkspace {
  return { ...workspace, overallCompetition };
}
function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (!value) throw new Error('Missing fictional first item');
  return value;
}

describe('optional event standings over all configured rounds', () => {
  it('compares gross strokes against each golfer captured par, not the shared default tee', () => {
    const f = fixture();
    const round = first(f.workspace.rounds);
    const selected = first(round.players);
    const alternate = { ...round.teeProfile, id: 701, totalPar: 37,
      holes: round.teeProfile.holes.map((hole) => hole.number === 1 ? { ...hole, par: 5 } : hole) };
    const workspace = { ...f.workspace, overallCompetition: { kind: 'stroke-play' as const, basis: 'gross' as const },
      rounds: [{ ...round, playerTees: [{ playerId: selected.playerId, profile: alternate }] }] };
    const result = calculateEventStandings(workspace, f.scores);
    expect(result.players.find((player) => player.playerId === selected.playerId)).toMatchObject({
      subtotal: 36, relativeToPar: -1, rank: 1,
    });
    expect(result.players.filter((player) => player.playerId !== selected.playerId)
      .every((player) => player.relativeToPar === 0)).toBe(true);
  });
  it('uses personal captured ratings for net stroke standings independently of other golfers', () => {
    const f = fixture(1, 18);
    const round = first(f.workspace.rounds);
    const selected = first(round.players);
    const alternate = { ...round.teeProfile, id: 701, ratings: round.teeProfile.ratings.map((rating) =>
      rating.type === 'Total' ? { ...rating, course: 78 } : rating) };
    const workspace = { ...f.workspace, overallCompetition: {
      kind: 'stroke-play' as const, basis: 'net' as const, handicapAllowancePercent: 100,
    }, rounds: [{ ...round, playerTees: [{ playerId: selected.playerId, profile: alternate }] }] };
    const result = calculateEventStandings(workspace, f.scores);
    expect(result.players.find((player) => player.playerId === selected.playerId)).toMatchObject({
      subtotal: 66, relativeToPar: -6, rank: 1,
    });
    expect(result.players.filter((player) => player.playerId !== selected.playerId)
      .every((player) => player.relativeToPar === 0)).toBe(true);
  });
  it('disables without fetching scores and supports an enabled unsaved empty workspace', () => {
    const f = fixture();
    const { overallCompetition: omitted, ...workspace } = f.workspace;
    expect(omitted).toBeDefined();
    expect(calculateEventStandings(workspace, [])).toEqual({ status: 'disabled', rounds: [], players: [], staleRoundIds: [] });
    expect(calculateEventStandings({ ...f.workspace, roster: [], rounds: [] }, [])).toMatchObject({
      status: 'provisional', rounds: [], players: [],
    });
  });

  it.each([1, 3, 8])('uses every configured round dynamically, without a five-round assumption (%s)', (count) => {
    const f = fixture(count);
    const before = structuredClone(f);
    const result = calculateEventStandings(f.workspace, f.scores);
    expect(result.rounds).toHaveLength(count);
    expect(first(result.players)).toMatchObject({ subtotal: count * 18, holesScored: count * 9, totalHoles: count * 9,
      status: 'complete', rank: 1, rankLabel: 'T1' });
    expect(first(result.players).cells).toHaveLength(count);
    expect(result.status).toBe('complete');
    expect(f).toEqual(before);
  });

  it('adds a new round as explicitly not configured instead of silently choosing its first saved game', () => {
    const f = fixture(3);
    const fourth = fixture(4);
    if (!f.workspace.overallCompetition) throw new Error('Missing fictional competition');
    const result = calculateEventStandings({ ...fourth.workspace, overallCompetition: f.workspace.overallCompetition }, fourth.scores);
    expect(result.rounds).toHaveLength(4);
    expect(first(result.players)).toMatchObject({ status: 'not-configured', reason: 'not-configured', subtotal: 54, rank: null });
    expect(first(result.players).cells[3]).toMatchObject({ status: 'not-configured', subtotal: null, holesScored: 0 });
    expect(result.rounds[3]?.gameId).toBeNull();
  });

  it('sums actual selected Standard/Modified game points, including custom saved points, without normalization', () => {
    const f = fixture(3);
    const workspace = competition(f.workspace, { kind: 'stableford', credit: 'individual',
      roundGames: f.workspace.rounds.map((round, index) => ({ roundId: round.id, gameId: id(index === 1 ? 451 : 400 + index) })) });
    const result = calculateEventStandings(workspace, f.scores);
    expect(first(result.players).subtotal).toBe(36);
    expect(first(result.players).cells.map((cell) => cell.subtotal)).toEqual([18, 0, 18]);
    const custom = definition(400);
    const changed = { ...custom, points: { rows: [{ scoreToPar: 0, points: 7 }], betterScorePoints: 10, worseScorePoints: -5 } };
    const single = fixture();
    const cards = recalculate(single, (card) => card.holes.map((hole) => hole.score), [changed]);
    expect(first(calculateEventStandings(single.workspace, cards).players).subtotal).toBe(63);
  });

  it('exposes missing games, missing rounds and stale historical bindings without a fabricated rank', () => {
    const f = fixture(3);
    const missing = f.scores.map((score, index) => {
      if (index !== 1) return score;
      const { games: omitted, ...projection } = score;
      expect(omitted).toBeDefined();
      return projection;
    });
    expect(first(calculateEventStandings(f.workspace, missing).players)).toMatchObject({
      status: 'unavailable', reason: 'missing-game', subtotal: 36, rank: null,
    });
    expect(first(calculateEventStandings(f.workspace, f.scores.slice(1)).players)).toMatchObject({
      status: 'unavailable', reason: 'missing-round', subtotal: 36, rank: null,
    });
    const wrongGame = competition(f.workspace, { kind: 'stableford', credit: 'individual',
      roundGames: f.workspace.rounds.map((round) => ({ roundId: round.id, gameId: id(999) })) });
    expect(first(calculateEventStandings(wrongGame, f.scores).players)).toMatchObject({
      status: 'unavailable', reason: 'missing-game', subtotal: null, rank: null,
    });
    const overallCompetition = f.workspace.overallCompetition;
    if (overallCompetition?.kind !== 'stableford') throw new Error('Missing fictional competition');
    const stale = calculateEventStandings(competition(f.workspace, { ...overallCompetition,
      roundGames: [...overallCompetition.roundGames, { roundId: id(999), gameId: id(998) }] }), f.scores);
    expect(stale.staleRoundIds).toEqual([id(999)]);
    expect(first(stale.players)).toMatchObject({ status: 'unavailable', reason: 'stale-round-binding', rank: null, subtotal: 54 });
  });

  it('ranks known zero and negative points with shared positions and keeps awaiting players out of ranks', () => {
    const f = fixture();
    const scores = recalculate(f, (_card, index) => index === 3 ? [] : [{ kind: 'strokes', strokes: index === 2 ? 5 : 4 }]);
    const workspace = competition(f.workspace, { kind: 'stableford', credit: 'individual', roundGames: [{ roundId: id(200), gameId: id(450) }] });
    const result = calculateEventStandings(workspace, scores);
    expect(result.status).toBe('provisional');
    expect(result.players.map((player) => [player.subtotal, player.rankLabel])).toEqual([[0, 'T1'], [0, 'T1'], [-1, '3'], [null, null]]);
    expect(result.players[3]?.status).toBe('awaiting-scores');
    expect(first(result.players)).toMatchObject({ holesScored: 1, totalHoles: 9, status: 'in-progress' });
  });

  it('keeps earned points provisionally ranked while correctly bound future rounds remain unplayed', () => {
    const f = fixture(8);
    const scores = f.scores.map((source, index) => {
      if (index === 0) return source;
      const snapshot = f.workspace.rounds.find((round) => round.id === source.roundId);
      if (!snapshot || !source.games) throw new Error('Missing fictional round');
      const cards = source.cards.map((card): Scorecard => ({ ...card, etag: null, updatedAt: null,
        holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'unplayed' } })) }));
      return { ...source, cards, setupLocked: false, lastUpdatedAt: null, games: {
        ...source.games, results: calculateGameResults(source.games.configuration.games, snapshot, cards),
      } };
    });
    expect(first(calculateEventStandings(f.workspace, scores).players)).toMatchObject({
      subtotal: 18, rank: 1, status: 'in-progress', holesScored: 9, totalHoles: 72,
    });
    const netGame = { ...definition(400), basis: 'net' as const };
    const missing: EventWorkspace = { ...f.workspace, rounds: f.workspace.rounds.map((round) => ({
      ...round, players: round.players.map((player) => ({ ...player, handicapIndex: null })),
    })) };
    const unavailable = recalculate({ workspace: missing, scores: f.scores }, (card) => card.holes.map((hole) => hole.score), [netGame]);
    expect(first(calculateEventStandings(missing, unavailable).players)).toMatchObject({
      status: 'unavailable', reason: 'missing-handicap-index', rank: null, subtotal: null,
    });
  });

  it.each(['individual', 'team'] as const)('uses explicit %s event credit for team games and blocks stale teams', (credit) => {
    const f = fixture();
    const game: TeamGameDefinition = {
      ...definition(400), basis: 'net', handicapAllowancePercent: 100, format: 'two-net-better-ball',
      teams: [{ id: id(800), name: 'Fictional A', playerIds: [id(1), id(2)] },
        { id: id(801), name: 'Fictional B', playerIds: [id(3), id(4)] }],
    };
    const scores = recalculate(f, (_card, index) => [{ kind: 'strokes', strokes: index === 1 ? 3 : 4 }], [game]);
    const workspace = competition(f.workspace, { kind: 'stableford', credit, roundGames: [{ roundId: id(200), gameId: id(400) }] });
    const result = calculateEventStandings(workspace, scores);
    expect(result.players.find((player) => player.playerId === id(1))?.subtotal).toBe(credit === 'team' ? 3 : 2);
    expect(result.players.find((player) => player.playerId === id(2))?.subtotal).toBe(3);
    const staleGame = { ...game, teams: game.teams.map((team, index) =>
      index === 0 ? { ...team, playerIds: [id(999), id(2)] } : team) };
    const stale = recalculate(f, (card) => card.holes.map((hole) => hole.score), [staleGame]);
    expect(first(calculateEventStandings(workspace, stale).players)).toMatchObject({
      status: 'unavailable', reason: 'team-setup-required', rank: null, subtotal: credit === 'individual' ? 18 : null,
    });
    const individual = calculateEventStandings(workspace, f.scores);
    expect(first(individual.players).subtotal).toBe(18);
  });

  it('team credit waits for every teammate while individual credit can show an earned-so-far result', () => {
    const f = fixture();
    const game: TeamGameDefinition = { ...definition(400), basis: 'net', handicapAllowancePercent: 100,
      format: 'four-two-net', teams: [{ id: id(800), name: 'Fictional A', playerIds: players.map((player) => player.playerId) }] };
    const scores = recalculate(f, (_card, index) => index === 3 ? [] : [{ kind: 'strokes', strokes: 4 }], [game]);
    for (const credit of ['individual', 'team'] as const) {
      const workspace = competition(f.workspace, { kind: 'stableford', credit, roundGames: [{ roundId: id(200), gameId: id(400) }] });
      expect(first(calculateEventStandings(workspace, scores).players)).toMatchObject(credit === 'team'
        ? { subtotal: null, rank: null, status: 'awaiting-scores' } : { subtotal: 2, rank: 1, status: 'in-progress' });
    }
  });
});

describe('live individual gross and exact net stroke-play standings', () => {
  it('orders relative to actual completed-hole par instead of incomparable raw subtotals', () => {
    const f = fixture();
    const scores = recalculate(f, (_card, index) => index === 0 ? [{ kind: 'strokes', strokes: 5 }]
      : index === 1 ? Array.from({ length: 8 }, () => ({ kind: 'strokes', strokes: 4 }))
        : index === 2 ? [{ kind: 'strokes', strokes: 3 }] : []);
    const result = calculateEventStandings(competition(f.workspace, { kind: 'stroke-play', basis: 'gross' }), scores);
    expect(result.players.map((player) => [player.playerId, player.subtotal, player.relativeToPar, player.rank])).toEqual([
      [id(3), 3, -1, 1], [id(2), 32, 0, 2], [id(1), 5, 1, 3], [id(4), null, null, null],
    ]);
    expect(result.status).toBe('provisional');
    expect(first(result.players)).toMatchObject({ status: 'in-progress', holesScored: 1, totalHoles: 9 });
  });

  it('shares tied stroke positions without a progress tie-break and preserves awaiting versus zero', () => {
    const f = fixture();
    const scores = recalculate(f, (_card, index) => index === 3 ? [] : Array.from({ length: index === 1 ? 8 : 1 },
      () => ({ kind: 'strokes', strokes: index === 2 ? 5 : 4 })));
    const result = calculateEventStandings(competition(f.workspace, { kind: 'stroke-play', basis: 'gross' }), scores);
    expect(result.players.map((player) => [player.relativeToPar, player.rankLabel])).toEqual([[0, 'T1'], [0, 'T1'], [1, '3'], [null, null]]);
  });

  it.each([9, 18])('reuses exact signed %s-hole handicap and 95 percent rounding without altering saved game allowances', (count) => {
    const f = fixture(3, count);
    const workspace: EventWorkspace = {
      ...competition(f.workspace, { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 95 }),
      rounds: f.workspace.rounds.map((round, index) => ({
        ...round, players: round.players.map((player) => {
          if (!player.handicapIndex) throw new Error('Missing fictional handicap');
          return { ...player, handicapIndex: { ...player.handicapIndex, value: index === 0 ? '+1.0' : index === 1 ? '10.5' : '0' } };
        }),
      })),
    };
    const before = structuredClone({ workspace, scores: f.scores });
    const result = first(calculateEventStandings(workspace, f.scores).players);
    const handicaps = workspace.rounds.map((round) => calculatePlayingHandicap(
      first(round.players).handicapIndex?.value ?? '', round.teeProfile, 95));
    expect(handicaps).toEqual(count === 9 ? [0, 5, 0] : [-1, 10, 0]);
    expect(result.cells.map((cell) => cell.relativeToPar)).toEqual(count === 9 ? [0, -5, 0] : [1, -10, 0]);
    expect(result).toMatchObject({ status: 'complete', relativeToPar: count === 9 ? -5 : -9 });
    expect({ workspace, scores: f.scores }).toEqual(before);
  });

  it('uses each hole actual par and captured round tee/index, not global state or team points', () => {
    const f = fixture();
    const round = first(f.workspace.rounds);
    const changed: RoundSnapshot = { ...round, teeProfile: { ...round.teeProfile,
      holes: round.teeProfile.holes.map((hole) => hole.number === 1 ? { ...hole, par: 3 } : hole) } };
    const workspace = { ...competition(f.workspace, { kind: 'stroke-play', basis: 'gross' }), rounds: [changed] };
    const scores = recalculate(f, () => [{ kind: 'strokes', strokes: 4 }]);
    expect(first(calculateEventStandings(workspace, scores).players)).toMatchObject({ subtotal: 4, relativeToPar: 1 });
  });

  it.each([{ kind: 'picked-up' }, { kind: 'picked-up', reportedStrokes: 7 }, { kind: 'did-not-finish' }] as const)(
    'invalidates pickup/DNF totals until corrected, never treating %j as numeric completion', (score) => {
      const f = fixture();
      const workspace = competition(f.workspace, { kind: 'stroke-play', basis: 'gross' });
      const scores = recalculate(f, () => [{ kind: 'strokes', strokes: 4 }, score]);
      expect(first(calculateEventStandings(workspace, scores).players)).toMatchObject({
        status: 'unavailable', reason: 'invalid-stroke-score', holesScored: 1, subtotal: 4, relativeToPar: 0, rank: null,
      });
      const corrected = recalculate(f, () => [{ kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 4 }]);
      expect(first(calculateEventStandings(workspace, corrected).players)).toMatchObject({
        status: 'in-progress', holesScored: 2, subtotal: 8, rank: 1,
      });
    });

  it('distinguishes missing HI/ratings/allocation from zero and leaves gross independent of HI', () => {
    const f = fixture();
    const net: OverallCompetition = { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 95 };
    const missing: EventWorkspace = { ...competition(f.workspace, net),
      rounds: f.workspace.rounds.map((round) => ({ ...round, players: round.players.map((player) => ({ ...player, handicapIndex: null })) })) };
    expect(first(calculateEventStandings(missing, f.scores).players)).toMatchObject({
      reason: 'missing-handicap-index', subtotal: null, relativeToPar: null, holesScored: 9, rank: null,
    });
    expect(first(calculateEventStandings(competition(missing, { kind: 'stroke-play', basis: 'gross' }), f.scores).players))
      .toMatchObject({ subtotal: 36, relativeToPar: 0, rank: 1 });
    for (const [patch, reason] of [
      [{ ratings: [] }, 'missing-tee-ratings'], [{ strokeAllocation: false }, 'missing-stroke-index'],
    ] as const) {
      const workspace = { ...competition(f.workspace, net),
        rounds: f.workspace.rounds.map((round) => ({ ...round, teeProfile: { ...round.teeProfile, ...patch } })) };
      expect(first(calculateEventStandings(workspace, f.scores).players)).toMatchObject({ reason, rank: null, subtotal: null });
    }
  });

  it.each(['stableford', 'gross', 'net'] as const)('reports arithmetic range instead of overflowing across eight rounds (%s)', (kind) => {
    const f = fixture(8);
    const workspace = kind === 'stableford' ? f.workspace : competition(f.workspace, kind === 'gross'
      ? { kind: 'stroke-play', basis: 'gross' } : { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 95 });
    const scores = f.scores.map((source) => {
      const snapshot = f.workspace.rounds.find((round) => round.id === source.roundId);
      if (!snapshot || !source.games) throw new Error('Missing fictional round');
      const game = first(source.games.configuration.games);
      if (!isStablefordGame(game)) throw new Error('Missing fictional Stableford game');
      const changed = { ...game, points: { rows: [{ scoreToPar: 0, points: maximumExactGamePoints }],
        betterScorePoints: maximumExactGamePoints, worseScorePoints: maximumExactGamePoints } };
      const cards = source.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({
        ...hole, score: { kind: 'strokes' as const, strokes: maximumExactHoleStrokes },
      })) }));
      return { ...source, cards, games: { configuration: { ...source.games.configuration, games: [changed] },
        results: calculateGameResults([changed], snapshot, cards) } };
    });
    const result = calculateEventStandings(workspace, scores);
    expect(result.status).toBe('unavailable');
    expect(first(result.players)).toMatchObject({ status: 'unavailable', reason: 'arithmetic-range', subtotal: null, rank: null });
  });

  it('accumulates signed game points exactly even when an intermediate sum is outside the safe range', () => {
    const f = fixture(8);
    const scores = f.scores.map((source, index) => {
      const snapshot = f.workspace.rounds.find((round) => round.id === source.roundId);
      if (!snapshot || !source.games) throw new Error('Missing fictional round');
      const points = maximumExactGamePoints * (index < 4 ? 1 : -1);
      const game = first(source.games.configuration.games);
      if (!isStablefordGame(game)) throw new Error('Missing fictional Stableford game');
      const changed = { ...game,
        points: { rows: [{ scoreToPar: 0, points }], betterScorePoints: points, worseScorePoints: points } };
      return { ...source, games: { configuration: { ...source.games.configuration, games: [changed] },
        results: calculateGameResults([changed], snapshot, source.cards) } };
    });
    expect(first(calculateEventStandings(f.workspace, scores).players)).toMatchObject({
      status: 'complete', subtotal: 0, rank: 1, rankLabel: 'T1',
    });
  });
});
