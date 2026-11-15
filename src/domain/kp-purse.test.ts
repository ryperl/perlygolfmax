import { describe, expect, it } from 'vitest';
import { purseTestContext, purseTestId } from './purse.test-support';
import { calculatePurse, samePursePlan, validatePursePlanContext } from './purse';
import { kpContext } from './kp';
import { isPursePlan, isPurseView } from '../contracts/purse';
import type { PurseKpPool, PursePlan } from './purse';

describe('KP is a genuine purse source independent of place ranks and manual recipients', () => {
  it('reserves one canonical budgeted pot until close, then credits repeated hole winners exactly', () => {
    const f = purseTestContext();
    const source = f.rounds[0];
    if (!source) throw new Error('Missing fixture');
    const layout = source.layout.map((hole) => ({ ...hole, par: hole.number <= 4 ? 3 : hole.par,
      length: [183, 178, 175, 200][hole.number - 1] ?? hole.length }));
    const cards = source.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { ...hole.score, ...(index === 0 && hole.number <= 3 ? {
        kp: { kind: 'measured' as const, inches: 12, onGreen: true as const, measurementId: purseTestId(7000 + hole.number) },
      } : {}) },
    })) }));
    const round = { ...source, layout, cards, kpEnabled: true,
      kp: { version: 1 as const, context: kpContext(layout, cards.map((card) => card.playerId)), status: 'open' as const, decisions: [], etag: 'kp-current' } };
    const workspace = { ...f.workspace, rounds: f.workspace.rounds.map((snapshot) => ({
      ...snapshot, teeProfile: { ...snapshot.teeProfile, holes: layout },
    })) };
    const pool: PurseKpPool = { id: purseTestId(6000), name: 'Fictional KP pot', source: { kind: 'kp', roundId: round.roundId }, amountMinor: 10000, awardUnit: 'pot' };
    const plan: PursePlan = { ...f.plan, funding: { kind: 'fixed', budgetMinor: 10200 }, pools: [...f.plan.pools, pool] };
    expect(isPursePlan(plan)).toBe(true);
    expect(validatePursePlanContext(plan, workspace, [round])).toEqual([]);
    const provisional = calculatePurse(plan, workspace, [round]);
    expect(provisional.pools.find((entry) => entry.poolId === pool.id)).toMatchObject({
      status: 'projected', allocatedMinor: 0, projectedMinor: 0, reservedMinor: 10000, shares: [],
    });
    const closed = { ...round, kp: { ...round.kp, status: 'closed' as const } };
    const calculation = calculatePurse(plan, workspace, [closed]);
    expect(calculation.pools.find((entry) => entry.poolId === pool.id)).toMatchObject({ status: 'calculated', allocatedMinor: 10000, reservedMinor: 0 });
    expect(calculation.scheduledMinor).toBe(10150);
    expect(calculation.remainingMinor).toBe(50);
    expect(isPurseView({ plan, resolutions: [], calculation }, workspace, [closed])).toBe(true);
    expect(samePursePlan(plan, { ...plan, pools: [...plan.pools] })).toBe(true);
    expect(samePursePlan(plan, { ...plan, pools: [f.pool, { ...pool, amountMinor: 9999 }] })).toBe(false);
    expect(validatePursePlanContext({ ...plan, pools: [pool, { ...pool, id: purseTestId(6001) }] }, f.workspace, [closed]))
      .toContainEqual({ code: 'invalid-plan', poolId: pool.id });
  });
});
