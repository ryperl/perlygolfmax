import { describe, expect, it } from 'vitest';
import { fictionalPurse } from '../../tests/smoke/purse-fixture-data';
import { publicPurseSummary } from './public-purse';
import { calculatePurse } from './purse';
import type { EventPurseView } from './purse-settings';
import { purseTestId } from './purse.test-support';
import { isEventPurseView } from '../contracts/purse-settings';
import { isEventWorkspace } from '../contracts/setup';
import { isRoundScores } from '../contracts/scoring';
import { roundScoresMatchWorkspace } from '../contracts/round-context';

describe('public purse projection', () => {
  it('uses only calculated shares, retains every golfer and exact pooled cents, and exposes no score or editing context', () => {
    const value = fictionalPurse(4, undefined, [4, 5, 5, 6]);
    const summary = publicPurseSummary(value);
    expect(summary.players.map((player) => player.amountMinor)).toEqual([100, 25, 25, 0]);
    expect(summary.players[3]?.poolIds).toEqual([]);
    expect(summary.players[1]?.poolIds).toEqual([purseTestId(5000)]);
    expect(JSON.stringify(summary)).not.toMatch(/handicap|layout|cards|roundScores|configuration|resolutions|recordedBy|projected|etag/);
    expect(summary.pools[0]?.prizes).toEqual([{ place: 1, amountMinor: 100 }, { place: 2, amountMinor: 50 }]);
  });

  it('omits provisional shares but keeps known completed awards when other pools are unavailable', () => {
    const value = fictionalPurse();
    const plan = value.configuration.plan;
    if (!plan) throw new Error('Missing fictional plan');
    const withManual = { ...plan, pools: [...plan.pools, {
      id: purseTestId(5100), name: 'Fictional completed pot', source: { kind: 'manual' as const },
      awardUnit: 'pot' as const, amountMinor: 101, recipientIds: [purseTestId(1)],
    }] };
    const missing: EventPurseView = { ...value, roundScores: [], configuration: { ...value.configuration, plan: withManual },
      view: { plan: withManual, resolutions: [], calculation: calculatePurse(withManual, value.workspace, []) } };
    const summary = publicPurseSummary(missing);
    expect(summary.needsReview).toBe(true);
    expect(summary.players.map((player) => player.amountMinor)).toEqual([101, 0, 0, 0]);
    expect(summary.players[0]?.poolIds).toEqual([purseTestId(5100)]);
    const pending = { ...value, view: value.view ? { ...value.view, calculation: {
      ...value.view.calculation, status: 'projected' as const,
      pools: value.view.calculation.pools.map((pool) => ({ ...pool, status: 'projected' as const })),
    } } : null };
    expect(publicPurseSummary(pending).players.every((player) => player.amountMinor === 0 && player.poolIds.length === 0)).toBe(true);
    expect(publicPurseSummary(pending).pools[0]?.status).toBe('pending');
  });

  it('keeps stale course pools visible for repair and never treats an absent plan or overflow as zero', () => {
    const value = fictionalPurse();
    const plan = value.configuration.plan;
    if (!plan) throw new Error('Missing fictional plan');
    const pool = plan.pools[0];
    if (!pool || pool.awardUnit === 'pot' || pool.source.kind !== 'round-game') throw new Error('Missing fictional round award');
    const stale = { ...plan, pools: [{ ...pool, source: { ...pool.source, roundId: purseTestId(999) } }] };
    const summary = publicPurseSummary({ ...value, configuration: { ...value.configuration, plan: stale },
      view: { plan: stale, resolutions: [], calculation: calculatePurse(stale, value.workspace, value.roundScores) } });
    expect(summary.rounds).toContainEqual({ id: purseTestId(999), label: 'Unavailable course' });
    expect(summary.pools[0]?.status).toBe('unavailable');
    const unconfigured = publicPurseSummary({ ...value, configuration: { ...value.configuration, plan: null }, view: null });
    expect(unconfigured.currency).toBeNull();
    expect(unconfigured.players.every((player) => player.amountMinor === null)).toBe(true);
    if (!value.view) throw new Error('Missing fictional calculation');
    const overflow = publicPurseSummary({ ...value, view: { ...value.view, calculation: {
      ...value.view.calculation, players: value.view.calculation.players.map((player) => ({ ...player, allocatedMinor: null })),
    } } });
    expect(overflow.players.every((player) => player.amountMinor === null)).toBe(true);
  });

  it('reduces a twelve-player five-round purse payload by at least 90%, without losing awarded money', () => {
    const value = fictionalPurse(12);
    const first = value.workspace.rounds[0];
    const saved = value.roundScores[0];
    const plan = value.configuration.plan;
    const game = saved?.games?.configuration.games[0];
    const rating = first?.teeProfile.ratings[0];
    if (!first || !saved || !plan || !game || !rating) throw new Error('Missing fictional source');
    const rounds = Array.from({ length: 5 }, (_, index) => ({ ...first, id: purseTestId(2000 + index),
      teeProfile: { ...first.teeProfile, ratings: (['Total', 'Front', 'Back'] as const).map((type) => ({ ...rating, type })) },
      name: `Fictional round ${String(index + 1)}` }));
    const roundScores = rounds.map((round) => ({ ...saved, roundId: round.id, roundName: round.name,
      permissions: { role: 'public' as const, writePlayerIds: value.workspace.roster.map((player) => player.playerId), canManageGames: false },
      ...(saved.games ? { games: { ...saved.games, configuration: { ...saved.games.configuration, roundId: round.id } } } : {}) }));
    const pools = rounds.map((_round, index) => ({ id: purseTestId(5000 + index),
      name: `Fictional daily pot ${String(index + 1)}`, source: { kind: 'manual' as const },
      awardUnit: 'pot' as const, amountMinor: 10000, recipientIds: [purseTestId(1)] }));
    const combined = { ...plan, funding: { kind: 'fixed' as const, budgetMinor: 50000 }, pools };
    const workspace = { ...value.workspace, event: { ...value.workspace.event, role: 'viewer' as const },
      publicAccess: true as const, canViewScores: true,
      overallCompetition: { kind: 'stableford' as const, credit: 'individual' as const,
        roundGames: rounds.map((round) => ({ roundId: round.id, gameId: game.id })) },
      rounds: rounds.map((round) => ({ ...round, players: round.players.map(({ playerId, displayName }) =>
        ({ playerId, displayName, handicapIndexValue: '0' })) })) };
    const full = { ...value, workspace, roundScores, configuration: { ...value.configuration, plan: combined },
      view: { plan: combined, resolutions: [], calculation: calculatePurse(combined, workspace, roundScores) } };
    const summary = publicPurseSummary(full);
    expect(isEventWorkspace(workspace), 'valid public workspace').toBe(true);
    expect(roundScores.every(isRoundScores), 'valid public score responses').toBe(true);
    expect(roundScoresMatchWorkspace(workspace, roundScores), 'matching public source snapshots').toBe(true);
    expect(isEventPurseView(full)).toBe(true);
    const bytes = (data: unknown) => new TextEncoder().encode(JSON.stringify(data)).length;
    expect(bytes(summary)).toBeLessThan(bytes(full) / 10);
    expect(summary.players[0]?.amountMinor).toBe(50000);
    expect(summary.players[0]?.poolIds).toHaveLength(5);
  });
});
