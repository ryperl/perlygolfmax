import { describe, expect, it } from 'vitest';
import { calculateEventSkins, calculateEventSkinsPayout } from './event-skins.js';
import { eventSkinsFixture, withoutEventSkins } from './event-skins.test-support.js';
import { purseTestId } from './purse.test-support.js';
import { calculatePurse, samePursePlan, validatePursePlanContext } from './purse.js';
import type { PursePlan } from './purse.js';

const numeric = (strokes: number) => ({ kind: 'strokes' as const, strokes });
describe('event-wide skins — independent round holes', () => {
  it.each([
    [3, 4, '0', '18', 0], // Gross birdie beats a net birdie.
    [2, 3, '0', '18', 0], // Gross eagle beats a net eagle, even another gross birdie.
    [4, 5, '0', '18', null], // Gross par does not break the tie.
    [3, 3, '18', '0', 0], // Net first, not gross.
    [3, 3, '0', '0', null],
    [4, 3, '36', '0', 0], // Net eagle beats gross/net birdie.
    [5, 6, '0', '18', null], // No gross bogey tiebreak either.
  ] as const)('compares %i/%i with HI %s/%s without a generic gross tiebreak', (a, b, hiA, hiB, winner) => {
    const f = eventSkinsFixture([numeric(a), numeric(b)], [hiA, hiB]);
    const result = calculateEventSkins(f.workspace, f.rounds);
    expect(result.holes[0]?.winnerId).toBe(winner === null ? null : f.workspace.roster[winner]?.playerId);
    expect(result.holes[0]?.status).toBe(winner === null ? 'tied' : 'awarded');
    expect(result.awardedSkins).toBe(winner === null ? 0 : 1);
    expect(result.status).toBe('complete');
  });
  it('uses personal par for qualification, plus CH and multiple strokes from shared allocation', () => {
    const f = eventSkinsFixture([numeric(4), numeric(5)], ['0', '18']);
    const first = f.workspace.rounds[0];
    if (!first) throw new Error('Missing fictional round.');
    const personal = { ...first.teeProfile, id: 701, totalPar: 73,
      holes: first.teeProfile.holes.map((hole) => hole.number === 1 ? { ...hole, par: 5 } : hole),
      ratings: [{ type: 'Total' as const, course: 73, slope: 113, bogey: 90 }] };
    const workspace = { ...f.workspace, allowPerGolferTees: true, rounds: [{ ...first,
      playerTees: [{ playerId: purseTestId(1), profile: personal }] }] };
    expect(calculateEventSkins(workspace, f.rounds).holes[0]).toMatchObject({
      winnerId: purseTestId(1), grossUnderParPriority: true, netStrokes: 4,
    });
    const plus = eventSkinsFixture([numeric(3), numeric(4)], ['+18', '0']);
    expect(calculateEventSkins(plus.workspace, plus.rounds).holes[0]?.winnerId).toBe(purseTestId(1));
    const multiple = eventSkinsFixture([numeric(6), numeric(5)], ['54', '18']);
    expect(calculateEventSkins(multiple.workspace, multiple.rounds).holes[0]?.netStrokes).toBe(3);
    expect(calculateEventSkins(multiple.workspace, multiple.rounds).holes[0]?.winnerId).toBe(purseTestId(1));
  });
  it.each([1, 3, 6, 8])('adds wins across %i distinct rounds, not same-number holes across rounds', (count) => {
    const f = eventSkinsFixture([numeric(3), numeric(4)], ['0', '18'], count, 9);
    const result = calculateEventSkins(f.workspace, f.rounds);
    expect(result.totalHoles).toBe(count * 9);
    expect(result.awardedSkins).toBe(count);
    expect(result.players[0]?.skins).toBe(count);
    expect(result.players[0]?.cells).toHaveLength(count);
  });
  it('never carries ties or pending holes and resolves later independent holes', () => {
    const f = eventSkinsFixture([numeric(4), { kind: 'unplayed' }], ['0', '0']);
    const rounds = f.rounds.map((round) => ({ ...round, cards: round.cards.map((card, index) => ({
      ...card, holes: card.holes.map((hole) => hole.number === 2 ? { ...hole, score: numeric(index ? 5 : 4) } : hole),
    })) }));
    const result = calculateEventSkins(f.workspace, rounds);
    expect(result.status).toBe('provisional');
    expect(result.holes[0]?.status).toBe('pending');
    expect(result.holes[1]?.winnerId).toBe(purseTestId(1));
    expect(result.awardedSkins).toBe(1);
  });
  it('leaves equal best qualifying gross scores tied and never carries an earlier tie into a later win', () => {
    const f = eventSkinsFixture([numeric(2), numeric(2), numeric(3)], ['0', '0', '18']);
    const rounds = f.rounds.map((round) => ({ ...round, cards: round.cards.map((card, index) => ({
      ...card, holes: card.holes.map((hole) => hole.number === 2 ? { ...hole, score: numeric(index === 0 ? 2 : 5) } : hole),
    })) }));
    const result = calculateEventSkins(f.workspace, rounds);
    expect(result.holes[0]).toMatchObject({ status: 'tied', grossUnderParPriority: true, winnerId: null,
      contenderIds: [purseTestId(1), purseTestId(2)] });
    expect(result.holes[1]?.winnerId).toBe(purseTestId(1));
    expect(result.awardedSkins).toBe(1);
  });
  it('keeps X7/pickup/DNF ineligible and missing net inputs unavailable, not scratch or pending ties', () => {
    for (const score of [{ kind: 'picked-up' as const, reportedStrokes: 7 }, { kind: 'did-not-finish' as const }]) {
      const f = eventSkinsFixture([numeric(9), score], ['0', null]);
      expect(calculateEventSkins(f.workspace, f.rounds).holes[0]?.winnerId).toBe(purseTestId(1));
      expect(f.rounds[0]?.cards[1]?.holes[0]?.score).toEqual(score);
    }
    const missing = eventSkinsFixture([numeric(3), numeric(4)], ['0', null]);
    expect(calculateEventSkins(missing.workspace, missing.rounds).holes[0]).toMatchObject({
      status: 'unavailable', reason: 'missing-net-inputs', winnerId: null,
    });
    const unplayed = eventSkinsFixture([{ kind: 'unplayed' }, { kind: 'unplayed' }], [null, null]);
    expect(calculateEventSkins(unplayed.workspace, unplayed.rounds).status).toBe('provisional');
    const allocation = { ...missing.workspace, rounds: missing.workspace.rounds.map((round) => ({
      ...round, teeProfile: { ...round.teeProfile, strokeAllocation: false },
    })) };
    expect(calculateEventSkins(allocation, missing.rounds).status).toBe('unavailable');
  });
  it('rejects duplicate, missing, foreign-event and mismatched capture/roster contexts', () => {
    const f = eventSkinsFixture();
    const first = f.rounds[0];
    if (!first) throw new Error('Missing fictional round.');
    for (const rounds of [[], [...f.rounds, first], [{ ...first, eventId: purseTestId(999) }],
      [{ ...first, setupLocked: false }], [{ ...first, cards: [first.cards[0], first.cards[0]].filter((card) => card !== undefined) }]]) {
      expect(calculateEventSkins(f.workspace, rounds).status).toBe('unavailable');
      expect(calculateEventSkins(f.workspace, rounds).awardedSkins).toBe(0);
    }
  });
  it('retains known zero players, shares ranks, and distinguishes complete no-winners from pending', () => {
    const f = eventSkinsFixture([numeric(3), numeric(4), numeric(9)], ['0', '0', '0'], 2);
    const rounds = f.rounds.map((round, index) => index ? { ...round, cards: round.cards.map((card, player) => ({
      ...card, holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score: numeric(player === 1 ? 3 : 4) } : hole),
    })) } : round);
    const result = calculateEventSkins(f.workspace, rounds);
    expect(result.players.map((player) => [player.skins, player.rank])).toEqual([[1, 1], [1, 1], [0, null]]);
    const tied = eventSkinsFixture([numeric(4), numeric(4)], ['0', '0']);
    expect(calculateEventSkins(tied.workspace, tied.rounds)).toMatchObject({ status: 'complete', awardedSkins: 0 });
    expect(calculateEventSkins(withoutEventSkins(f.workspace), [])).toMatchObject({ status: 'disabled', players: [] });
  });
});

describe('event skins pot — exact per-skin shares, never place prizes', () => {
  function fixture() {
    const f = eventSkinsFixture([numeric(3), numeric(4), numeric(5)], ['0', '0', '0'], 3);
    const rounds = f.rounds.map((round, index) => index === 2 ? { ...round, cards: round.cards.map((card, player) => ({
      ...card, holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score: numeric(player === 1 ? 3 : 4) } : hole),
    })) } : round);
    const plan: PursePlan = { eventId: f.workspace.event.id, currency: 'USD', funding: { kind: 'fixed', budgetMinor: 10001 },
      pools: [{ id: purseTestId(6000), name: 'Fictional event skins', source: { kind: 'event-skins', version: 1 },
        awardUnit: 'pot', amountMinor: 10001 }] };
    return { ...f, rounds, plan };
  }
  it('floors 10001/3 to 3333 per skin, multiplies actual wins and leaves two cents unallocated', () => {
    const f = fixture();
    const payout = calculateEventSkinsPayout(calculateEventSkins(f.workspace, f.rounds), 10001);
    expect(payout).toMatchObject({ status: 'calculated', perSkinMinor: 3333, unallocatedMinor: 2 });
    expect(payout.shares.map((share) => share.amountMinor)).toEqual([6666, 3333, 0]);
    const purse = calculatePurse(f.plan, f.workspace, f.rounds);
    expect(purse).toMatchObject({ status: 'calculated', allocatedMinor: 9999, unallocatedMinor: 2, remainingMinor: 0 });
    expect(purse.players.map((player) => player.totalMinor)).toEqual([6666, 3333, 0]);
    expect(samePursePlan(f.plan, structuredClone(f.plan))).toBe(true);
    expect(samePursePlan(f.plan, { ...f.plan, pools: [] })).toBe(false);
  });
  it('reserves the entire pot without winners; pending denominator is projected and missing inputs unavailable', () => {
    const tied = eventSkinsFixture([numeric(4), numeric(4)], ['0', '0']);
    expect(calculateEventSkinsPayout(calculateEventSkins(tied.workspace, tied.rounds), 10001))
      .toMatchObject({ status: 'calculated', perSkinMinor: null, unallocatedMinor: 10001 });
    const pending = eventSkinsFixture([numeric(4), { kind: 'unplayed' }], ['0', '0']);
    expect(calculateEventSkinsPayout(calculateEventSkins(pending.workspace, pending.rounds), 10001))
      .toMatchObject({ status: 'projected', unallocatedMinor: 10001 });
    const missing = eventSkinsFixture([numeric(4), numeric(5)], ['0', null]);
    expect(calculateEventSkinsPayout(calculateEventSkins(missing.workspace, missing.rounds), 10001))
      .toMatchObject({ status: 'unavailable', perSkinMinor: null, unallocatedMinor: null, shares: [] });
  });
  it('preserves explicit budgets and rejects duplicates, stale sources, invalid amounts and arithmetic overflow', () => {
    const f = fixture();
    const pool = f.plan.pools[0];
    if (!pool) throw new Error('Missing fictional pool.');
    expect(validatePursePlanContext({ ...f.plan, pools: [pool, { ...pool, id: purseTestId(6001) }] },
      f.workspace, f.rounds)).toContainEqual({ code: 'invalid-plan', poolId: pool.id });
    expect(calculatePurse(f.plan, withoutEventSkins(f.workspace), f.rounds).status).toBe('unavailable');
    expect(calculatePurse({ ...f.plan, funding: { kind: 'fixed', budgetMinor: 10000 } }, f.workspace, f.rounds))
      .toMatchObject({ status: 'unavailable', overBudgetMinor: 1 });
    const result = calculateEventSkins(f.workspace, f.rounds);
    for (const invalid of [-1, 1.1, Number.MAX_SAFE_INTEGER + 1, Infinity]) {
      expect(calculateEventSkinsPayout(result, invalid).status).toBe('unavailable');
    }
    expect(calculateEventSkinsPayout(result, Number.MAX_SAFE_INTEGER).unallocatedMinor).toBe(1);
    expect(calculateEventSkinsPayout({ ...result, awardedSkins: 4 }, 100).status).toBe('unavailable');
    expect(calculateEventSkinsPayout({ ...result, pendingHoles: 1 }, 100).status).toBe('unavailable');
    expect(calculateEventSkinsPayout({ ...result, holes: [...result.holes, ...result.holes] }, 100).status).toBe('unavailable');
    expect(calculateEventSkinsPayout({ ...result, players: result.players.map((player, index) => ({
      ...player, skins: index === 0 ? 1 : index === 1 ? 2 : 0,
    })) }, 100).status).toBe('unavailable');
  });
});
