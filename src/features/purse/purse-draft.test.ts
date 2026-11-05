import { describe, expect, it } from 'vitest';
import { fictionalPurse } from '../../../tests/smoke/purse-fixture-data';
import { purseTestId } from '../../domain/purse.test-support';
import { samePursePlan } from '../../domain/purse';
import type { PursePlan } from '../../domain/purse';
import { buildPurseDraft, draftFromPlan, newPool, reviewSelection, selectSource, sourceChoices } from './purse-draft';

describe('purse draft builders', () => {
  it('round-trips an entire plan and defaults unconfigured funding to USD fixed zero', () => {
    const value = fictionalPurse();
    const draft = draftFromPlan(value.configuration.plan);
    expect(samePursePlan(buildPurseDraft(draft, value.workspace.event.id), value.configuration.plan)).toBe(true);
    expect(draftFromPlan(null)).toEqual({ currency: 'USD', funding: 'fixed', amount: '0.00', pools: [] });
    expect(buildPurseDraft({ ...draft, currency: 'EUR', funding: 'buy-in', amount: '2.34' }, value.workspace.event.id)?.funding)
      .toEqual({ kind: 'buy-in', buyInMinor: 234 });
  });
  it('rejects unsupported currency, fractional/duplicate places, duplicate IDs and invalid amounts', () => {
    const value = fictionalPurse();
    const draft = draftFromPlan(value.configuration.plan);
    const pool = draft.pools[0];
    if (!pool) throw new Error('Missing fictional pool.');
    for (const broken of [
      { ...draft, currency: 'ZZZ' }, { ...draft, amount: '1.234' }, { ...draft, funding: 'collected' },
      { ...draft, pools: [pool, pool] }, { ...draft, pools: [{ ...pool, name: '' }] },
      ...['0', '-1', '1.1', '9007199254740992'].map((place) =>
        ({ ...draft, pools: [{ ...pool, prizes: [{ place, amount: '1' }] }] })),
      { ...draft, pools: [{ ...pool, prizes: [{ place: '1', amount: '1' }, { place: '1', amount: '2' }] }] },
    ]) expect(buildPurseDraft(broken, value.workspace.event.id)).toBeNull();
  });
  it.each(['two-net-better-ball', 'four-two-net'] as const)('uses actual %s team source and defaults to per-team', (format) => {
    const value = fictionalPurse(8, format);
    const choices = sourceChoices(value);
    const team = choices.find((entry) => entry.team);
    if (!team) throw new Error('Missing fictional team source.');
    const draft = selectSource(newPool(purseTestId(8000)), team);
    expect(draft.awardUnit).toBe('per-team');
    const plan = buildPurseDraft({ currency: 'USD', funding: 'fixed', amount: '5.00', pools: [{ ...draft, name: 'Fictional team pot' }] }, value.workspace.event.id);
    expect(plan?.pools[0]?.awardUnit).toBe('per-team');
  });
  it('lists every dynamic round/game without an overall choice when disabled and never limits prizes', () => {
    const value = fictionalPurse(40);
    const { overallCompetition: _competition, ...workspace } = value.workspace;
    expect(_competition).toBeDefined();
    expect(sourceChoices({ ...value, workspace }).some((choice) => choice.key === 'overall')).toBe(false);
    const round = value.roundScores[0];
    const snapshot = value.workspace.rounds[0];
    if (!round || !snapshot) throw new Error('Missing fictional round.');
    const rounds = Array.from({ length: 12 }, (_, index) => ({ ...round, roundId: purseTestId(6000 + index) }));
    const choices = sourceChoices({ ...value, workspace: { ...workspace,
      rounds: rounds.map((entry) => ({ ...snapshot, id: entry.roundId })) }, roundScores: rounds });
    expect(choices.filter((choice) => choice.source.kind === 'round-game')).toHaveLength(12);
    const draft = draftFromPlan(value.configuration.plan);
    const pool = draft.pools[0];
    if (!pool) throw new Error('Missing fictional pool.');
    expect(buildPurseDraft({ ...draft, pools: [{ ...pool, prizes: Array.from({ length: 100 }, (_, index) => ({
      place: String(index + 1), amount: '0.01',
    })) }] }, value.workspace.event.id)?.pools).toHaveLength(1);
  });
  it('rebases only edited/deleted pools while retaining concurrent additions and untouched changes', () => {
    const value = fictionalPurse();
    const original = value.configuration.plan;
    const first = original?.pools[0];
    if (!original || !first) throw new Error('Missing fictional plan.');
    const second = { ...first, id: purseTestId(5001), name: 'Untouched pool' };
    const removed = { ...first, id: purseTestId(5002), name: 'Remove in draft' };
    const added = { ...first, id: purseTestId(5003), name: 'Concurrent addition' };
    const base: PursePlan = { ...original, pools: [first, second, removed] };
    const local = { ...base, pools: [{ ...first, name: 'My edited award' }, second] };
    const latest = { ...base, currency: 'CAD' as const, pools: [first, { ...second, name: 'Concurrent edit' }, removed, added] };
    const merged = reviewSelection({ plan: base, resolutions: [] }, { plan: local, resolutions: [] }, { plan: latest, resolutions: [] });
    expect(merged.plan.currency).toBe('CAD');
    expect(merged.plan.pools.map((pool) => pool.name)).toEqual(['Concurrent edit', 'Concurrent addition', 'My edited award']);
  });
  it('reviews currency and funding independently and retains untouched stale decisions for explicit repair', () => {
    const value = fictionalPurse();
    const original = value.configuration.plan;
    if (!original) throw new Error('Missing fictional plan.');
    const decision = { poolId: purseTestId(7777), rank: 1, orderedEntrantIds: [purseTestId(1), purseTestId(2)] };
    const local = { ...original, currency: 'EUR' as const };
    const latest = { ...original, funding: { kind: 'buy-in' as const, buyInMinor: 123 } };
    const merged = reviewSelection({ plan: original, resolutions: [decision] },
      { plan: local, resolutions: [decision] }, { plan: latest, resolutions: [decision] });
    expect(merged.plan.currency).toBe('EUR');
    expect(merged.plan.funding).toEqual({ kind: 'buy-in', buyInMinor: 123 });
    expect(merged.resolutions).toEqual([decision]);
  });
});
