import { describe, expect, it } from 'vitest';
import type { PursePlan, PurseView } from '../domain/purse.js';
import { calculatePurse } from '../domain/purse.js';
import { purseTestContext, purseTestId as id } from '../domain/purse.test-support.js';
import {
  isPurseCalculation, isPursePlan, isPursePlanForWorkspace, isPurseTieResolution, isPurseTieResolutions, isPurseView,
} from './purse.js';

describe('purse plan runtime guards', () => {
  it.each(['USD', 'CAD', 'EUR', 'GBP', 'AUD'])('accepts explicit two-decimal %s currency and both funding modes', (currency) => {
    const f = purseTestContext();
    expect(isPursePlan({ ...f.plan, currency })).toBe(true);
    expect(isPursePlan({ ...f.plan, currency, funding: { kind: 'buy-in', buyInMinor: 123 } })).toBe(true);
    expect(isPursePlanForWorkspace(f.plan, f.workspace, f.rounds)).toBe(true);
  });
  it.each([
    null, {}, { currency: 'JPY' }, { currency: undefined }, { eventId: 'not-an-id' },
    { funding: { kind: 'fixed', budgetMinor: -1 } }, { funding: { kind: 'fixed', budgetMinor: 1.1 } },
    { funding: { kind: 'fixed', budgetMinor: Infinity } }, { funding: { kind: 'buy-in', buyInMinor: Number.MAX_SAFE_INTEGER + 1 } },
    { funding: { kind: 'fixed', budgetMinor: 1, buyInMinor: 1 } }, { extra: true },
  ])('rejects invalid strict plan shape %j', (change) => {
    const f = purseTestContext();
    const value: unknown = change === null || Object.keys(change).length === 0 ? change : { ...f.plan, ...change };
    expect(isPursePlan(value)).toBe(false);
  });
  it.each([
    { id: 'bad' }, { name: '' }, { name: ' spaced ' }, { name: 'x'.repeat(101) }, { awardUnit: 'dollars' },
    { tiePolicy: 'roster-order' }, { source: { kind: 'round-game', roundId: id(2000) } },
    { source: { kind: 'overall', gameId: id(3000) } }, { source: { kind: 'manual' } },
    { source: { kind: 'overall' }, awardUnit: 'per-team' },
    { prizes: [{ place: 0, amountMinor: 1 }] }, { prizes: [{ place: 1.5, amountMinor: 1 }] },
    { prizes: [{ place: 1, amountMinor: -1 }] }, { prizes: [{ place: 1, amountMinor: NaN }] },
    { prizes: [{ place: 1, amountMinor: 1, currency: 'USD' }] },
    { prizes: [{ place: 1, amountMinor: 1 }, { place: 1, amountMinor: 2 }] }, { extra: true },
  ])('rejects invalid source/unit/prize config %j', (change) => {
    const f = purseTestContext();
    expect(isPursePlan({ ...f.plan, pools: [{ ...f.pool, ...change }] })).toBe(false);
  });
  it('rejects duplicate pool IDs, including case variants, without limiting award counts', () => {
    const f = purseTestContext();
    expect(isPursePlan({ ...f.plan, pools: [f.pool, f.pool] })).toBe(false);
    const pool = { ...f.pool, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    expect(isPursePlan({ ...f.plan, pools: [pool, { ...pool, id: pool.id.toUpperCase() }] })).toBe(false);
    expect(isPursePlan({ ...f.plan, pools: Array.from({ length: 120 }, (_, index) => ({
      ...f.pool, id: id(6000 + index),
      prizes: Array.from({ length: 120 }, (_, place) => ({ place: place + 1, amountMinor: 1 })),
    })) })).toBe(true);
  });
  it('accepts only explicit manual pot units and current unique recipient IDs', () => {
    const f = purseTestContext();
    const pool = { id: id(6000), name: 'Fictional side pot', source: { kind: 'manual' }, awardUnit: 'pot', amountMinor: 101, recipientIds: [id(1), id(2)] };
    expect(isPursePlanForWorkspace({ ...f.plan, pools: [pool] }, f.workspace, [])).toBe(true);
    for (const change of [{ awardUnit: 'per-team' }, { recipientIds: [id(1), id(1)] }, { prizes: [] }, { amountMinor: 0.1 }]) {
      expect(isPursePlan({ ...f.plan, pools: [{ ...pool, ...change }] })).toBe(false);
    }
    const unknown = { ...f.plan, pools: [{ ...pool, recipientIds: [id(99999)] }] };
    expect(isPursePlan(unknown)).toBe(true);
    expect(isPursePlanForWorkspace(unknown, f.workspace, [])).toBe(false);
  });
  it('rejects event/round/game targets and incompatible source units at the context boundary', () => {
    const f = purseTestContext();
    const values: readonly unknown[] = [
      { ...f.plan, eventId: id(99999) },
      { ...f.plan, pools: [{ ...f.pool, source: { kind: 'round-game', roundId: id(99999), gameId: id(3000) } }] },
      { ...f.plan, pools: [{ ...f.pool, source: { kind: 'round-game', roundId: id(2000), gameId: id(99999) } }] },
      { ...f.plan, pools: [{ ...f.pool, awardUnit: 'per-team' }] },
    ];
    for (const value of values) {
      expect(isPursePlan(value)).toBe(true);
      expect(isPursePlanForWorkspace(value, f.workspace, f.rounds)).toBe(false);
    }
    expect(isPursePlanForWorkspace(f.plan, f.workspace, [])).toBe(false);
  });
  it.each([12, 120])('does not impose a new current-roster capacity (%s)', (count) => {
    const f = purseTestContext(count);
    const plan = { ...f.plan, funding: { kind: 'buy-in', buyInMinor: 101 } as const };
    expect(isPursePlanForWorkspace(plan, f.workspace, f.rounds)).toBe(true);
    const calculation = calculatePurse(plan, f.workspace, f.rounds);
    expect(isPurseCalculation(calculation, plan, f.workspace, f.rounds)).toBe(true);
  });
});

describe('purse resolution and authoritative result guards', () => {
  function fixture(): ReturnType<typeof purseTestContext> & { readonly view: PurseView } {
    const f = purseTestContext(4, undefined, [3, 4, 4, 5]);
    const plan: PursePlan = { ...f.plan, pools: [{ ...f.pool, tiePolicy: 'organizer' }] };
    const resolutions = [{ poolId: f.pool.id, rank: 2, orderedEntrantIds: [id(3), id(2)] }];
    return { ...f, plan, view: { plan, resolutions, calculation: calculatePurse(plan, f.workspace, f.rounds, resolutions) } };
  }
  it('accepts exact current resolutions and recomputed views without mutating input', () => {
    const f = fixture();
    const before = structuredClone(f);
    expect(isPurseTieResolution(f.view.resolutions[0])).toBe(true);
    expect(isPurseTieResolutions(f.view.resolutions, f.plan, f.workspace, f.rounds)).toBe(true);
    expect(isPurseView(f.view, f.workspace, f.rounds)).toBe(true);
    expect(f).toEqual(before);
  });
  it.each([
    {}, { poolId: id(99999), rank: 2, orderedEntrantIds: [id(2), id(3)] },
    { poolId: id(5000), rank: 2, orderedEntrantIds: [id(2), id(2)] },
    { poolId: id(5000), rank: 2, orderedEntrantIds: [id(2), id(4)] },
    { poolId: id(5000), rank: 1, orderedEntrantIds: [id(2), id(3)] },
    { poolId: id(5000), rank: 2, orderedEntrantIds: [id(2), id(3)], final: true },
  ])('rejects malformed, unknown and stale resolution %j', (resolution) => {
    const f = fixture();
    expect(isPurseTieResolutions([resolution], f.plan, f.workspace, f.rounds)).toBe(false);
    expect(isPurseView({ ...f.view, resolutions: [resolution] }, f.workspace, f.rounds)).toBe(false);
  });
  it('rejects duplicate decisions and decisions for pooled policy or a changed tied set', () => {
    const f = fixture();
    expect(isPurseTieResolutions([...f.view.resolutions, ...f.view.resolutions], f.plan, f.workspace, f.rounds)).toBe(false);
    const pooled = { ...f.plan, pools: [f.pool] };
    expect(isPurseTieResolutions(f.view.resolutions, pooled, f.workspace, f.rounds)).toBe(false);
    const changed = purseTestContext(4, undefined, [3, 4, 5, 5]);
    expect(isPurseView(f.view, changed.workspace, changed.rounds)).toBe(false);
  });
  it('loads honestly unavailable stored decisions after legitimate score changes for repair, but rejects them on writes', () => {
    const f = fixture();
    const changed = purseTestContext(4, undefined, [3, 4, 5, 5]);
    const calculation = calculatePurse(f.plan, changed.workspace, changed.rounds, f.view.resolutions);
    expect(calculation.status).toBe('unavailable');
    expect(calculation.issues).toContainEqual({ code: 'invalid-resolution', poolId: id(5000) });
    expect(calculation.pools.every((pool) => pool.status === 'unavailable' && pool.shares.length === 0)).toBe(true);
    expect(calculation.players.every((player) => player.totalMinor === null)).toBe(true);
    expect(isPurseTieResolutions(f.view.resolutions, f.plan, changed.workspace, changed.rounds)).toBe(false);
    expect(isPurseCalculation(calculation, f.plan, changed.workspace, changed.rounds, f.view.resolutions)).toBe(true);
    expect(isPurseView({ ...f.view, calculation }, changed.workspace, changed.rounds)).toBe(true);
    expect(isPurseCalculation({ ...calculation, status: 'calculated', issues: [] },
      f.plan, changed.workspace, changed.rounds, f.view.resolutions)).toBe(false);
    const repaired = { ...f.view, resolutions: [], calculation: calculatePurse(f.plan, changed.workspace, changed.rounds) };
    expect(isPurseView(repaired, changed.workspace, changed.rounds)).toBe(true);
    expect(isPurseTieResolutions([], f.plan, changed.workspace, changed.rounds)).toBe(true);
  });
  it('allows shape-valid unknown or duplicate stored decisions only with their exact unavailable calculation', () => {
    const f = fixture();
    const unknown = { poolId: id(99999), rank: 2, orderedEntrantIds: [id(2), id(3)] };
    for (const resolutions of [[unknown], [...f.view.resolutions, ...f.view.resolutions]]) {
      const calculation = calculatePurse(f.plan, f.workspace, f.rounds, resolutions);
      expect(calculation.status).toBe('unavailable');
      expect(isPurseTieResolutions(resolutions, f.plan, f.workspace, f.rounds)).toBe(false);
      expect(isPurseView({ ...f.view, resolutions, calculation }, f.workspace, f.rounds)).toBe(true);
      expect(isPurseView({ ...f.view, resolutions }, f.workspace, f.rounds)).toBe(false);
    }
  });
  it('still rejects malformed stored decisions even alongside their recomputed unavailable result', () => {
    const f = fixture();
    for (const resolutions of [
      [{ poolId: id(5000), rank: 0, orderedEntrantIds: [id(2), id(3)] }],
      [{ poolId: id(5000), rank: 2, orderedEntrantIds: [id(2), id(2)] }],
      [{ poolId: id(5000), rank: 2, orderedEntrantIds: [id(2), id(3)], paid: true }],
    ]) {
      const calculation = calculatePurse(f.plan, f.workspace, f.rounds, resolutions);
      expect(isPurseCalculation(calculation, f.plan, f.workspace, f.rounds, resolutions)).toBe(false);
      expect(isPurseView({ ...f.view, resolutions, calculation }, f.workspace, f.rounds)).toBe(false);
    }
  });
  it('rejects tampered cumulative totals, shares, status, remainders, omitted players and extra claims', () => {
    const f = fixture();
    const calculation = f.view.calculation;
    const variants: readonly unknown[] = [
      { ...calculation, allocatedMinor: 999 },
      { ...calculation, scheduledMinor: 999 },
      { ...calculation, status: 'paid' },
      { ...calculation, paid: true },
      { ...calculation, tieRemainderMinor: 9 },
      { ...calculation, players: calculation.players.slice(1) },
      { ...calculation, players: calculation.players.map((player) => ({ ...player, totalMinor: 999 })) },
      { ...calculation, pools: calculation.pools.map((pool) => ({ ...pool, shares: pool.shares.map((share) => ({ ...share, playerId: id(99999) })) })) },
      { ...calculation, pools: calculation.pools.map((pool) => ({ ...pool, issues: [], reasons: [], reservedMinor: 999 })) },
    ];
    for (const value of variants) {
      expect(isPurseCalculation(value, f.plan, f.workspace, f.rounds, f.view.resolutions)).toBe(false);
    }
    expect(isPurseView({ ...f.view, extra: true }, f.workspace, f.rounds)).toBe(false);
  });
  it('accepts truthful unavailable and projected calculations, never success-shaped fallbacks', () => {
    const f = purseTestContext();
    const missing = calculatePurse(f.plan, f.workspace, []);
    expect(missing.status).toBe('unavailable');
    expect(isPurseCalculation(missing, f.plan, f.workspace, [])).toBe(true);
    expect(isPurseCalculation({ ...missing, status: 'calculated', issues: [] }, f.plan, f.workspace, [])).toBe(false);
    const g = fixture();
    const calculation = calculatePurse(g.plan, g.workspace, g.rounds);
    expect(calculation.status).toBe('projected');
    expect(isPurseView({ plan: g.plan, resolutions: [], calculation }, g.workspace, g.rounds)).toBe(true);
  });
  it('rejects a truthful calculation attached to a different event plan', () => {
    const f = purseTestContext();
    const plan = { ...f.plan, eventId: id(99999) };
    const calculation = calculatePurse(plan, f.workspace, f.rounds);
    expect(isPurseView({ plan, resolutions: [], calculation }, f.workspace, f.rounds)).toBe(false);
  });
  it('rejects aggregate funding and scheduled-prize overflow at the config boundary', () => {
    const f = purseTestContext();
    const max = Number.MAX_SAFE_INTEGER;
    for (const plan of [
      { ...f.plan, funding: { kind: 'buy-in', buyInMinor: max } },
      { ...f.plan, pools: [{ ...f.pool, prizes: [{ place: 1, amountMinor: max }, { place: 2, amountMinor: 1 }] }] },
    ]) {
      expect(isPursePlan(plan)).toBe(true);
      expect(isPursePlanForWorkspace(plan, f.workspace, f.rounds)).toBe(false);
    }
  });
});
