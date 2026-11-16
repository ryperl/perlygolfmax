import { describe, expect, it } from 'vitest';
import { purseTestContext, purseTestId } from './purse.test-support';
import { calculatePurse, samePursePlan, validatePursePlanContext } from './purse';
import { calculateKp, kpContext } from './kp';
import { playerWinningsBreakdown } from './winnings-breakdown';
import { roundReviewNotices, purseReviewNotices } from './event-review';
import { isPlayerWinningsBreakdown } from '../contracts/winnings-breakdown';
import { isPursePlan, isPurseView } from '../contracts/purse';
import type { PurseKpPool, PursePlan } from './purse';

describe('KP is a genuine purse source independent of place ranks and manual recipients', () => {
  it('explains odd-cent split winnings without measurement identities and clears resolved-tie notices', () => {
    const f = purseTestContext();
    const source = f.rounds[0];
    if (!source) throw new Error('Missing fixture');
    const layout = source.layout.map((hole) => hole.number === 1 ? { ...hole, par: 3 } : hole);
    const cards = source.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { ...hole.score, ...(index < 2 && hole.number === 1 ? {
        kp: { kind: 'measured' as const, inches: 60, onGreen: true as const, measurementId: purseTestId(7000 + index) },
      } : {}) },
    })) }));
    const round = { ...source, layout, cards, kp: { version: 1 as const, etag: 'fictional-kp',
      context: kpContext(layout, cards.map((card) => card.playerId)), status: 'closed' as const, decisions: [] } };
    const proof = calculateKp(round).holes[0]?.proof;
    if (!proof) throw new Error('Missing fixture proof');
    const closed = { ...round, kp: { ...round.kp, decisions: [{ holeNumber: 1, proof, kind: 'split' as const,
      playerIds: [purseTestId(1), purseTestId(2)], holeAmountMinor: 10001, extraCentPlayerIds: [purseTestId(1)] }] } };
    const workspace = { ...f.workspace, rounds: f.workspace.rounds.map((snapshot) => ({
      ...snapshot, teeProfile: { ...snapshot.teeProfile, holes: layout, totalPar: 35 },
    })) };
    const pool: PurseKpPool = { id: purseTestId(6000), name: 'Fictional KP', source: { kind: 'kp', roundId: round.roundId },
      amountMinor: 10001, awardUnit: 'pot' };
    const plan: PursePlan = { ...f.plan, funding: { kind: 'fixed', budgetMinor: 10001 }, pools: [pool] };
    const value = { workspace, roundScores: [closed], configuration: { eventId: workspace.event.id, plan, etag: null, resolutions: [] },
      view: { plan, resolutions: [], calculation: calculatePurse(plan, workspace, [closed]) } };
    const detail = playerWinningsBreakdown(value, purseTestId(1));
    expect(detail).toMatchObject({ amountMinor: 5001, awards: [{ parts: [
      { kind: 'kp', amountMinor: 5001, holeNumber: 1, distanceInches: 60, splitCount: 2, resolution: 'split' },
    ] }] });
    expect(isPlayerWinningsBreakdown(detail)).toBe(true);
    expect(JSON.stringify(detail)).not.toMatch(/measurementId|proof|recordedBy/);
    expect(roundReviewNotices(closed, 'Fictional round')).toEqual([]);
    expect(purseReviewNotices(value)).toEqual([]);
    expect(roundReviewNotices(closed, 'Fictional round', 10003)).toContainEqual(expect.objectContaining({ code: 'kp-tie', label: 'Fictional round' }));
  });
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
