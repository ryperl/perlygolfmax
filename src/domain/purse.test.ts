import { describe, expect, it } from 'vitest';
import { calculateEventStandings } from './event-leaderboard.js';
import type { GameTeamResult, RoundGamesView } from './games.js';
import type { PurseCalculation, PurseManualPool, PursePlan, PurseRankedPool, PurseTieResolution } from './purse.js';
import { calculatePurse, samePursePlan, samePurseTieResolutions, validatePursePlanContext } from './purse.js';
import { purseTestContext, purseTestId as id } from './purse.test-support.js';
import type { RoundScores } from './scoring.js';

function conserved(result: PurseCalculation): void {
  expect(result.scheduledMinor).toBe((result.allocatedMinor ?? 0) + (result.projectedMinor ?? 0) + (result.unallocatedMinor ?? 0));
  expect(result.unallocatedMinor).toBe((result.reservedMinor ?? 0) + (result.tieRemainderMinor ?? 0) + (result.memberRemainderMinor ?? 0));
  expect((result.plannedBudgetMinor ?? 0) + (result.overBudgetMinor ?? 0)).toBe((result.scheduledMinor ?? 0) + (result.remainingMinor ?? 0));
}
function withPool(f: ReturnType<typeof purseTestContext>, pool: PurseRankedPool | PurseManualPool): PursePlan {
  return { ...f.plan, pools: [pool] };
}
function requireGames(round: RoundScores): RoundScores & { readonly games: RoundGamesView } {
  if (!round.games) throw new Error('Missing fictional games');
  return { ...round, games: round.games };
}
function mapPlayers(
  f: ReturnType<typeof purseTestContext>, change: (round: RoundScores & { readonly games: RoundGamesView }) => RoundScores,
): readonly RoundScores[] {
  return f.rounds.map(requireGames).map(change);
}
function decision(poolId = id(5000), orderedEntrantIds = [id(2), id(3)], rank = 2): PurseTieResolution {
  return { poolId, rank, orderedEntrantIds };
}

describe('purse semantic save acknowledgment equality', () => {
  it('ignores object key order, pool/prize order and manual recipient order without mutating inputs', () => {
    const f = purseTestContext();
    const manual: PurseManualPool = { id: id(6000), name: 'Fictional side pot', source: { kind: 'manual' },
      awardUnit: 'pot', amountMinor: 5, recipientIds: [id(1), id(2)] };
    const left: PursePlan = { ...f.plan, pools: [f.pool, manual] };
    const right: PursePlan = {
      pools: [{ recipientIds: [id(2), id(1)], amountMinor: 5, awardUnit: 'pot', source: { kind: 'manual' },
        name: manual.name, id: manual.id }, { ...f.pool, prizes: [...f.pool.prizes].reverse() }],
      funding: { budgetMinor: 200, kind: 'fixed' }, currency: 'USD', eventId: f.plan.eventId,
    };
    const before = structuredClone({ left, right });
    expect(samePursePlan(left, right)).toBe(true);
    expect({ left, right }).toEqual(before);
    expect(samePursePlan(null, undefined)).toBe(true);
    expect(samePursePlan(left, null)).toBe(false);
  });
  it('compares every funding, source, unit, tie, prize and manual allocation setting', () => {
    const f = purseTestContext();
    const variants: readonly PursePlan[] = [
      { ...f.plan, eventId: id(9001) }, { ...f.plan, currency: 'CAD' },
      { ...f.plan, funding: { kind: 'fixed', budgetMinor: 201 } },
      { ...f.plan, funding: { kind: 'buy-in', buyInMinor: 200 } },
      withPool(f, { ...f.pool, id: id(5001) }), withPool(f, { ...f.pool, name: 'Fictional renamed' }),
      withPool(f, { ...f.pool, source: { kind: 'overall' } }),
      withPool(f, { ...f.pool, source: { kind: 'round-game', roundId: id(2001), gameId: id(3000) } }),
      withPool(f, { ...f.pool, source: { kind: 'round-game', roundId: id(2000), gameId: id(3001) } }),
      withPool(f, { ...f.pool, awardUnit: 'per-team' }), withPool(f, { ...f.pool, tiePolicy: 'organizer' }),
      withPool(f, { ...f.pool, prizes: [{ place: 1, amountMinor: 101 }, { place: 2, amountMinor: 50 }] }),
      withPool(f, { ...f.pool, prizes: [{ place: 1, amountMinor: 100 }, { place: 3, amountMinor: 50 }] }),
      { ...f.plan, pools: [] }, { ...f.plan, pools: [f.pool, f.pool] },
    ];
    for (const other of variants) expect(samePursePlan(f.plan, other)).toBe(false);
    const manual: PurseManualPool = { id: id(6000), name: 'Fictional side pot', source: { kind: 'manual' },
      awardUnit: 'pot', amountMinor: 5, recipientIds: [id(1)] };
    const plan = withPool(f, manual);
    expect(samePursePlan(plan, withPool(f, { ...manual, amountMinor: 6 }))).toBe(false);
    expect(samePursePlan(plan, withPool(f, { ...manual, recipientIds: [id(2)] }))).toBe(false);
    const buyIn: PursePlan = { ...f.plan, funding: { kind: 'buy-in', buyInMinor: 50 } };
    expect(samePursePlan(buyIn, { ...buyIn, funding: { kind: 'buy-in', buyInMinor: 50 } })).toBe(true);
    expect(samePursePlan(buyIn, { ...buyIn, funding: { kind: 'buy-in', buyInMinor: 51 } })).toBe(false);
  });
  it('ignores decision-list/key order but preserves tied entrant ordering, set and rank', () => {
    const first = decision();
    const second = decision(id(5001), [id(1), id(4)], 1);
    const reordered = { orderedEntrantIds: first.orderedEntrantIds, rank: first.rank, poolId: first.poolId };
    expect(samePurseTieResolutions([first, second], [second, reordered])).toBe(true);
    expect(samePurseTieResolutions([first], [{ ...first, orderedEntrantIds: [...first.orderedEntrantIds].reverse() }])).toBe(false);
    expect(samePurseTieResolutions([first], [{ ...first, orderedEntrantIds: [id(2), id(4)] }])).toBe(false);
    expect(samePurseTieResolutions([first], [{ ...first, rank: 1 }])).toBe(false);
    expect(samePurseTieResolutions([first, first], [first, second])).toBe(false);
    expect(samePurseTieResolutions([], [])).toBe(true);
  });
});

describe('purse individual calculations', () => {
  it('uses signed/zero saved game totals, not raw stroke or Stableford recalculation', () => {
    const f = purseTestContext();
    const rounds = mapPlayers(f, (round) => ({ ...round, games: {
      ...round.games, results: round.games.results.map((result) => ({ ...result, players: result.players.map((player, index) =>
        ({ ...player, totalPoints: [-10, 0, -20, -30][index] ?? 0 })) })),
    } }));
    const result = calculatePurse(f.plan, f.workspace, rounds);
    expect(result.status).toBe('calculated');
    expect(result.players.map((player) => player.totalMinor)).toEqual([50, 100, 0, 0]);
    conserved(result);
  });
  it.each(['standard', 'modified'] as const)('uses actual %s results, including zero and negative points', (preset) => {
    const f = purseTestContext(4, undefined, [7, 6, 5, 4], preset);
    expect(f.rounds[0]?.games?.results[0]?.players[0]?.totalPoints).toBe(preset === 'modified' ? -18 : 0);
    const result = calculatePurse(f.plan, f.workspace, f.rounds);
    expect(result.players.map((player) => player.totalMinor)).toEqual([0, 0, 50, 100]);
    conserved(result);
  });
  it('pools occupied places (two tied second split second plus third), without changing ranks', () => {
    const f = purseTestContext(4, undefined, [3, 4, 4, 5]);
    const pool = { ...f.pool, prizes: [{ place: 1, amountMinor: 100 }, { place: 2, amountMinor: 50 }, { place: 3, amountMinor: 30 }] };
    const result = calculatePurse(withPool(f, pool), f.workspace, f.rounds);
    expect(result.players.map((player) => player.totalMinor)).toEqual([100, 40, 40, 0]);
    expect(result.pools[0]?.shares.map((share) => share.rank)).toEqual([1, 2, 2]);
    conserved(result);
  });
  it('keeps three-way tie cents unallocated, independent of roster order', () => {
    const f = purseTestContext(4, undefined, [4, 4, 4, 5]);
    const plan = withPool(f, { ...f.pool, prizes: [{ place: 1, amountMinor: 100 }] });
    const result = calculatePurse(plan, f.workspace, f.rounds);
    expect(result.players.map((player) => player.totalMinor)).toEqual([33, 33, 33, 0]);
    expect(result.tieRemainderMinor).toBe(1);
    const reversed = calculatePurse(plan, { ...f.workspace, roster: [...f.workspace.roster].reverse() }, f.rounds);
    expect([...reversed.players].reverse()).toEqual(result.players);
    conserved(result);
  });
  it('reserves future unoccupied prizes rather than assigning them to existing winners', () => {
    const f = purseTestContext();
    const result = calculatePurse(withPool(f, { ...f.pool, prizes: [{ place: 1, amountMinor: 100 }, { place: 5, amountMinor: 77 }] }), f.workspace, f.rounds);
    expect(result.reservedMinor).toBe(77);
    expect(result.pools[0]?.reasons).toContain('unoccupied-places');
    expect(result.remainingMinor).toBe(23);
    conserved(result);
  });
  it('aggregates across named pools, keeping an explicit zero for every nonwinner', () => {
    const f = purseTestContext();
    const result = calculatePurse({ ...f.plan, pools: [f.pool, { ...f.pool, id: id(5001), prizes: [{ place: 1, amountMinor: 10 }] }] }, f.workspace, f.rounds);
    expect(result.players.map((player) => player.totalMinor)).toEqual([110, 50, 0, 0]);
    expect(result.pools).toHaveLength(2);
    conserved(result);
  });
});

describe('purse overall and team sources', () => {
  it.each(['stableford', 'gross', 'net'] as const)('reuses overall %s tied rank fields', (kind) => {
    const f = purseTestContext(4, undefined, [3, 4, 4, 5]);
    const workspace = kind === 'stableford' ? f.workspace : { ...f.workspace, overallCompetition: kind === 'gross'
      ? { kind: 'stroke-play', basis: 'gross' } as const
      : { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 95 } as const };
    const pool: PurseRankedPool = { ...f.pool, source: { kind: 'overall' }, prizes: [{ place: 2, amountMinor: 100 }] };
    const standings = calculateEventStandings(workspace, f.rounds);
    expect(standings.players.map((player) => player.rank)).toEqual([1, 2, 2, 4]);
    const result = calculatePurse(withPool(f, pool), workspace, f.rounds);
    expect(result.players.map((player) => player.totalMinor)).toEqual([0, 50, 50, 0]);
    conserved(result);
  });
  it.each(['two-net-better-ball', 'two-net-aggregate', 'four-two-net'] as const)('splits %s team pots among members', (format) => {
    const f = purseTestContext(format === 'four-two-net' ? 8 : 4, format, [3, 3, 4, 4, 4, 4, 4, 4]);
    const result = calculatePurse(f.plan, f.workspace, f.rounds);
    const size = format === 'four-two-net' ? 4 : 2;
    expect(result.status).toBe('calculated');
    expect(result.players.slice(0, size).map((player) => player.totalMinor)).toEqual(Array<number>(size).fill(100 / size));
    expect(result.scheduledMinor).toBe(150);
    expect(result.memberRemainderMinor).toBe(size === 4 ? 2 : 0);
    conserved(result);
  });
  it('multiplies per-golfer team prizes but never per-team pots', () => {
    const f = purseTestContext(8, 'four-two-net', [3, 3, 3, 3, 4, 4, 4, 4]);
    const perGolfer = calculatePurse(withPool(f, { ...f.pool, awardUnit: 'per-golfer' }), f.workspace, f.rounds);
    const perTeam = calculatePurse(f.plan, f.workspace, f.rounds);
    expect(perGolfer.scheduledMinor).toBe(600);
    expect(perGolfer.players.map((player) => player.totalMinor)).toEqual([100, 100, 100, 100, 50, 50, 50, 50]);
    expect(perGolfer.overBudgetMinor).toBe(400);
    expect(perTeam.scheduledMinor).toBe(150);
    conserved(perGolfer);
    conserved(perTeam);
  });
  it('shows both tie division and subsequent team-member division remainders', () => {
    const f = purseTestContext(4, 'two-net-better-ball', [4, 4, 4, 4]);
    const result = calculatePurse(withPool(f, { ...f.pool, prizes: [{ place: 1, amountMinor: 103 }] }), f.workspace, f.rounds);
    expect(result.players.map((player) => player.totalMinor)).toEqual([25, 25, 25, 25]);
    expect(result.tieRemainderMinor).toBe(1);
    expect(result.memberRemainderMinor).toBe(2);
    conserved(result);
  });
  it('overall team credit still awards individuals, not a second team pot', () => {
    const f = purseTestContext(4, 'two-net-better-ball', [3, 3, 4, 4]);
    const workspace = { ...f.workspace, overallCompetition: { kind: 'stableford', credit: 'team',
      roundGames: [{ roundId: id(2000), gameId: id(3000) }] } as const };
    const result = calculatePurse(withPool(f, { ...f.pool, source: { kind: 'overall' }, awardUnit: 'per-golfer',
      prizes: [{ place: 1, amountMinor: 100 }] }), workspace, f.rounds);
    expect(result.players.map((player) => player.totalMinor)).toEqual([50, 50, 0, 0]);
    conserved(result);
  });
  it('follows a saved format change and refuses the now-incompatible unit', () => {
    const individual = purseTestContext();
    const team = purseTestContext(4, 'two-net-aggregate');
    expect(calculatePurse(team.plan, team.workspace, individual.rounds).pools[0]?.issues).toContainEqual(
      { code: 'invalid-award-unit', poolId: team.pool.id });
    expect(calculatePurse(individual.plan, team.workspace, team.rounds).scheduledMinor).toBe(300);
  });
});

describe('purse organizer resolutions', () => {
  it('reserves unresolved occupied places, resolves only awards, and preserves tied standings', () => {
    const f = purseTestContext(4, undefined, [3, 4, 4, 5]);
    const plan = withPool(f, { ...f.pool, tiePolicy: 'organizer',
      prizes: [{ place: 1, amountMinor: 100 }, { place: 2, amountMinor: 60 }, { place: 3, amountMinor: 30 }] });
    const before = calculateEventStandings(f.workspace, f.rounds);
    const unresolved = calculatePurse(plan, f.workspace, f.rounds);
    expect(unresolved.status).toBe('projected');
    expect(unresolved.projectedMinor).toBe(100);
    expect(unresolved.reservedMinor).toBe(90);
    expect(unresolved.pools[0]?.reasons).toContain('unresolved-tie');
    const result = calculatePurse(plan, f.workspace, f.rounds, [decision(id(5000), [id(3), id(2)])]);
    expect(result.players.map((player) => player.totalMinor)).toEqual([100, 30, 60, 0]);
    expect(result.status).toBe('calculated');
    expect(calculateEventStandings(f.workspace, f.rounds)).toEqual(before);
    conserved(result);
  });
  it.each([
    { resolutions: [decision(id(9999))] }, { resolutions: [decision(), decision()] },
    { resolutions: [decision(id(5000), [id(2), id(2)])] },
    { resolutions: [decision(id(5000), [id(2), id(4)])] },
    { resolutions: [decision(id(5000), [id(2), id(3), id(4)])] },
    { resolutions: [decision(id(5000), [id(2), id(3)], 1)] },
  ])('rejects unknown, duplicate, non-exact or stale decisions (%j)', ({ resolutions }) => {
    const f = purseTestContext(4, undefined, [3, 4, 4, 5]);
    const result = calculatePurse(withPool(f, { ...f.pool, tiePolicy: 'organizer' }), f.workspace, f.rounds, resolutions);
    expect(result.status).toBe('unavailable');
    expect(result.issues.some((entry) => entry.code === 'invalid-resolution')).toBe(true);
    expect(result.pools[0]?.shares).toEqual([]);
    conserved(result);
  });
  it('rejects formerly valid decisions when scoring changes the current tied set', () => {
    const f = purseTestContext(4, undefined, [3, 4, 5, 5]);
    expect(calculatePurse(withPool(f, { ...f.pool, tiePolicy: 'organizer' }), f.workspace, f.rounds, [decision()]).issues)
      .toContainEqual({ code: 'invalid-resolution', poolId: id(5000) });
  });
  it('uses team IDs for team resolutions and then splits winnings among actual members', () => {
    const f = purseTestContext(4, 'two-net-better-ball', [4, 4, 4, 4]);
    const result = calculatePurse(withPool(f, { ...f.pool, tiePolicy: 'organizer' }), f.workspace, f.rounds,
      [decision(id(5000), [id(4001), id(4000)], 1)]);
    expect(result.players.map((player) => player.totalMinor)).toEqual([25, 25, 50, 50]);
    conserved(result);
  });
});

describe('purse projections, unavailable sources and funding', () => {
  it('distinguishes known in-progress projections and awaiting scores from calculated awards', () => {
    const f = purseTestContext();
    const rounds = mapPlayers(f, (round) => ({ ...round, games: {
      ...round.games, results: round.games.results.map((result) => ({ ...result,
        players: result.players.map((player) => ({ ...player, status: 'in-progress', holesScored: 1 })) })),
    } }));
    const result = calculatePurse(f.plan, f.workspace, rounds);
    expect(result.status).toBe('projected');
    expect(result.allocatedMinor).toBe(0);
    expect(result.projectedMinor).toBe(150);
    expect(result.pools[0]?.reasons).toEqual(['in-progress']);
    const awaiting = calculatePurse(f.plan, f.workspace, rounds.map(requireGames).map((round) => ({ ...round, games: {
      ...round.games, results: round.games.results.map((entry) => ({ ...entry, players: entry.players.map((player) =>
        ({ ...player, holesScored: 0, totalPoints: null })) })),
    } })));
    expect(awaiting.status).toBe('projected');
    expect(awaiting.pools[0]?.reasons).toContain('awaiting-scores');
    expect(awaiting.pools[0]?.shares).toEqual([]);
    expect(awaiting.reservedMinor).toBe(150);
    conserved(result);
    conserved(awaiting);
  });
  it('supports an explicit manual pot with equal shares, empty reserves and no score invention', () => {
    const f = purseTestContext();
    const pool: PurseManualPool = { id: id(6000), name: 'Fictional side pot', source: { kind: 'manual' },
      awardUnit: 'pot', amountMinor: 100, recipientIds: [id(1), id(2), id(3)] };
    const result = calculatePurse(withPool(f, pool), f.workspace, []);
    expect(result.players.map((player) => player.totalMinor)).toEqual([33, 33, 33, 0]);
    expect(result.memberRemainderMinor).toBe(1);
    expect(result.status).toBe('calculated');
    const empty = calculatePurse(withPool(f, { ...pool, recipientIds: [] }), f.workspace, []);
    expect(empty.status).toBe('projected');
    expect(empty.reservedMinor).toBe(100);
    expect(empty.pools[0]?.reasons).toContain('recipients-unassigned');
    for (const recipientIds of [[id(1), id(1)], [id(99999)]]) {
      expect(calculatePurse(withPool(f, { ...pool, recipientIds }), f.workspace, []).status).toBe('unavailable');
    }
    conserved(result);
    conserved(empty);
  });
  it.each([12, 120])('uses current roster count, without a golfer cap (%s)', (count) => {
    const f = purseTestContext(count);
    const result = calculatePurse({ ...f.plan, funding: { kind: 'buy-in', buyInMinor: 101 } }, f.workspace, f.rounds);
    expect(result.status).toBe('calculated');
    expect(result.plannedBudgetMinor).toBe(count * 101);
    expect(result.players).toHaveLength(count);
    conserved(result);
  });
  it('reports budget exceedance without scaling winners or increasing the budget', () => {
    const f = purseTestContext();
    const result = calculatePurse({ ...f.plan, funding: { kind: 'fixed', budgetMinor: 1 } }, f.workspace, f.rounds);
    expect(result.status).toBe('unavailable');
    expect(result.issues).toContainEqual({ code: 'budget-exceeded' });
    expect(result.allocatedMinor).toBe(150);
    expect(result.overBudgetMinor).toBe(149);
    expect(result.plannedBudgetMinor).toBe(1);
    conserved(result);
  });
  it('reports missing sources/configuration explicitly, never a fake winner', () => {
    const f = purseTestContext();
    const variants: readonly (readonly RoundScores[])[] = [
      [], [...f.rounds, ...f.rounds], f.rounds.map((round) => ({ ...round, eventId: id(9999) })),
      f.rounds.map(({ games: omitted, ...round }) => {
        expect(omitted).toBeDefined();
        return round;
      }),
      mapPlayers(f, (round) => ({ ...round, games: { ...round.games, results: [] } })),
      mapPlayers(f, (round) => ({ ...round, games: { ...round.games,
        results: round.games.results.map((entry) => ({ ...entry, players: entry.players.slice(1) })) } })),
      mapPlayers(f, (round) => ({ ...round, games: { ...round.games,
        results: round.games.results.map((entry) => ({ ...entry, players: entry.players.map((player) =>
          ({ ...player, holesScored: 0 })) })) } })),
      mapPlayers(f, (round) => ({ ...round, games: { ...round.games,
        results: round.games.results.map((entry) => ({ ...entry, players: entry.players.map((player) =>
          ({ ...player, status: 'unavailable', unavailableReason: 'missing-handicap-index' })) })) } })),
    ];
    for (const rounds of variants) {
      const result = calculatePurse(f.plan, f.workspace, rounds);
      expect(result.status).toBe('unavailable');
      expect(result.pools[0]?.issues.length).toBeGreaterThan(0);
      expect(result.pools[0]?.shares).toEqual([]);
      expect(result.players.every((player) => player.totalMinor === null)).toBe(true);
    }
    expect(validatePursePlanContext(withPool(f, { ...f.pool, source: { kind: 'round-game', roundId: id(9999), gameId: id(3000) } }), f.workspace))
      .toContainEqual({ code: 'missing-round', poolId: id(5000) });
    expect(validatePursePlanContext(withPool(f, { ...f.pool, source: { kind: 'round-game', roundId: id(2000), gameId: id(9999) } }), f.workspace, f.rounds))
      .toContainEqual({ code: 'missing-game', poolId: id(5000) });
  });
  it('retains known pool shares but makes cumulative totals unknown when another pool is unavailable', () => {
    const f = purseTestContext();
    const missing: PurseRankedPool = { ...f.pool, id: id(5001),
      source: { kind: 'round-game', roundId: id(2000), gameId: id(9999) }, awardUnit: 'per-team' };
    const result = calculatePurse({ ...f.plan, pools: [f.pool, missing] }, f.workspace, f.rounds);
    expect(result.pools[0]?.status).toBe('calculated');
    expect(result.pools[1]?.status).toBe('unavailable');
    expect(result.allocatedMinor).toBe(150);
    expect(result.reservedMinor).toBe(150);
    expect(result.players[0]).toEqual({ playerId: id(1), allocatedMinor: 100, projectedMinor: 0, totalMinor: null });
    expect(result.overBudgetMinor).toBe(100);
    conserved(result);
  });
  it('projects mixed-progress team results and refuses a played result with missing points', () => {
    const f = purseTestContext(4, 'two-net-better-ball');
    const projected = mapPlayers(f, (round) => ({ ...round, games: { ...round.games,
      results: round.games.results.map((entry) => ({ ...entry, teams: entry.teams?.map((team) =>
        ({ ...team, status: 'in-progress', holesScored: 1 })) ?? [] })) } }));
    expect(calculatePurse(f.plan, f.workspace, projected).status).toBe('projected');
    const missing = projected.map(requireGames).map((round) => ({ ...round, games: { ...round.games,
      results: round.games.results.map((entry) => ({ ...entry, teams: entry.teams?.map((team) =>
        ({ ...team, totalPoints: null })) ?? [] })) } }));
    expect(calculatePurse(f.plan, f.workspace, missing).pools[0]?.issues).toContainEqual({
      code: 'missing-score-data', poolId: id(5000),
    });
  });
  it('makes an overall award projected until every selected round is complete', () => {
    const f = purseTestContext();
    const pool: PurseRankedPool = { ...f.pool, source: { kind: 'overall' } };
    const rounds = mapPlayers(f, (round) => ({ ...round, games: { ...round.games,
      results: round.games.results.map((entry) => ({ ...entry, players: entry.players.map((player) =>
        ({ ...player, status: 'in-progress', holesScored: 1, totalPoints: player.totalPoints,
          holes: player.holes.map((hole) => ({ ...hole, points: hole.number === 1 ? hole.points : null })) })) })) } }));
    const projected = calculatePurse(withPool(f, pool), f.workspace, rounds);
    expect(projected.status).toBe('projected');
    expect(projected.allocatedMinor).toBe(0);
    expect(projected.projectedMinor).toBe(150);
    expect(calculatePurse(withPool(f, pool), f.workspace, f.rounds).status).toBe('calculated');
  });
  it('rejects missing/duplicated/stale team members and incomplete team setup', () => {
    const f = purseTestContext(4, 'two-net-better-ball');
    const transforms: readonly ((teams: readonly GameTeamResult[]) => readonly GameTeamResult[])[] = [
      (teams) => teams.slice(1),
      (teams) => teams.map((team) => ({ ...team, playerIds: [id(1), id(1)] })),
      (teams) => teams.map((team) => ({ ...team, playerIds: [id(2), id(3)] })),
      (teams) => teams.map((team) => ({ ...team, playerIds: [id(9999), id(3)] })),
    ];
    for (const change of transforms) {
      const rounds = mapPlayers(f, (round) => ({ ...round, games: { ...round.games,
        results: round.games.results.map((entry) => ({ ...entry, teams: change(entry.teams ?? []) })) } }));
      const result = calculatePurse(f.plan, f.workspace, rounds);
      expect(result.pools[0]?.issues).toContainEqual({ code: 'team-setup-required', poolId: id(5000) });
      expect(result.pools[0]?.shares).toEqual([]);
    }
    const rounds = mapPlayers(f, (round) => ({ ...round, games: { ...round.games,
      results: round.games.results.map((entry) => ({ ...entry, teamSetupRequired: true })) } }));
    expect(calculatePurse(f.plan, f.workspace, rounds).status).toBe('unavailable');
    const stale = { ...f.workspace, roster: [...f.workspace.roster.slice(1), { playerId: id(9999), displayName: 'Fictional replacement' }] };
    expect(calculatePurse(f.plan, stale, f.rounds).status).toBe('unavailable');
  });
  it('fails safely on exact aggregate and per-member arithmetic overflow', () => {
    const f = purseTestContext();
    const max = Number.MAX_SAFE_INTEGER;
    const huge = { ...f.pool, prizes: [{ place: 1, amountMinor: max }, { place: 2, amountMinor: 1 }] };
    expect(calculatePurse(withPool(f, huge), f.workspace, f.rounds).scheduledMinor).toBeNull();
    expect(calculatePurse({ ...f.plan, funding: { kind: 'buy-in', buyInMinor: max } }, f.workspace, f.rounds).plannedBudgetMinor).toBeNull();
    const result = calculatePurse({ ...f.plan, pools: [
      { ...f.pool, prizes: [{ place: 1, amountMinor: max }] },
      { ...f.pool, id: id(5001), prizes: [{ place: 1, amountMinor: 1 }] },
    ] }, f.workspace, f.rounds);
    expect(result.scheduledMinor).toBeNull();
    expect(result.players[0]?.totalMinor).toBeNull();
    expect(result.issues.some((entry) => entry.code === 'arithmetic-range')).toBe(true);
    const team = purseTestContext(4, 'two-net-better-ball');
    expect(calculatePurse(withPool(team, { ...team.pool, awardUnit: 'per-golfer', prizes: [{ place: 1, amountMinor: max }] }),
      team.workspace, team.rounds).scheduledMinor).toBeNull();
    expect(validatePursePlanContext(withPool(f, huge), f.workspace, f.rounds)).toContainEqual({ code: 'arithmetic-range' });
  });
  it('handles the largest safe pot exactly (no floating-point rounding)', () => {
    const f = purseTestContext(4, undefined, [4, 4, 4, 5]);
    const result = calculatePurse({ ...withPool(f, { ...f.pool, prizes: [{ place: 1, amountMinor: Number.MAX_SAFE_INTEGER }] }),
      funding: { kind: 'fixed', budgetMinor: Number.MAX_SAFE_INTEGER } }, f.workspace, f.rounds);
    expect(result.players.slice(0, 3).map((player) => player.totalMinor)).toEqual([3002399751580330, 3002399751580330, 3002399751580330]);
    expect(result.tieRemainderMinor).toBe(1);
    conserved(result);
  });
  it('does not mutate nested readonly context, plans, saved results or resolutions', () => {
    const f = purseTestContext(4, undefined, [3, 4, 4, 5]);
    const plan = withPool(f, { ...f.pool, tiePolicy: 'organizer' });
    const resolutions = [decision()];
    const input = { f, plan, resolutions };
    const before = structuredClone(input);
    calculatePurse(plan, f.workspace, f.rounds, resolutions);
    expect(input).toEqual(before);
  });
  it('makes invalid config and missing overall/net scoring data unavailable', () => {
    const f = purseTestContext();
    expect(validatePursePlanContext({ ...f.plan, pools: [f.pool, f.pool] }, f.workspace)).toContainEqual({ code: 'invalid-plan' });
    expect(validatePursePlanContext(withPool(f, { ...f.pool, prizes: [{ place: 1, amountMinor: 1 }, { place: 1, amountMinor: 1 }] }), f.workspace).length).toBeGreaterThan(0);
    const { overallCompetition: omitted, ...workspace } = f.workspace;
    expect(omitted).toBeDefined();
    const plan = withPool(f, { ...f.pool, source: { kind: 'overall' } });
    expect(calculatePurse(plan, workspace, []).issues).toContainEqual({ code: 'overall-not-configured', poolId: id(5000) });
    expect(calculatePurse(plan, f.workspace, []).status).toBe('unavailable');
    const net = { ...f.workspace, overallCompetition: { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 95 } as const,
      rounds: f.workspace.rounds.map((round) => ({ ...round, players: round.players.map(({ playerId, displayName }) => ({ playerId, displayName })) })) };
    expect(calculatePurse(plan, net, f.rounds).pools[0]?.issues).toContainEqual({
      code: 'source-unavailable', poolId: id(5000), detail: 'missing-handicap-index',
    });
  });
});
