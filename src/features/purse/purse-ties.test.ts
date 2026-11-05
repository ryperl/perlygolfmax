import { describe, expect, it } from 'vitest';
import { fictionalPurse } from '../../../tests/smoke/purse-fixture-data';
import type { PursePlan } from '../../domain/purse';
import { currentTies, matchesTie } from './purse-ties';

describe('saved purse tie candidates', () => {
  it('uses friendly golfer names and current tied entrants, not display order as an award decision', () => {
    const value = fictionalPurse(4, undefined, [4, 5, 5, 6]);
    const plan = value.configuration.plan;
    if (!plan) throw new Error('Missing fictional plan.');
    const organizer: PursePlan = { ...plan, pools: plan.pools.map((pool) => 'prizes' in pool ? { ...pool, tiePolicy: 'organizer' } : pool) };
    const tie = currentTies(organizer, value)[0];
    if (!tie) throw new Error('Missing fictional tie.');
    expect(tie.rank).toBe(2);
    expect(tie.entrants.map((entrant) => entrant.name)).toEqual(['Fictional golfer 2', 'Fictional golfer 3']);
    const decision = { poolId: tie.poolId, rank: tie.rank, orderedEntrantIds: tie.entrants.map((entrant) => entrant.id).reverse() };
    expect(matchesTie(decision, tie)).toBe(true);
    expect(matchesTie({ ...decision, orderedEntrantIds: [value.workspace.roster[0]?.playerId ?? ''] }, tie)).toBe(false);
    expect(currentTies(organizer, { ...value, roundScores: [] })).toEqual([]);
    expect(currentTies(plan, value)).toEqual([]);
  });
  it.each(['two-net-better-ball', 'four-two-net'] as const)('uses %s team IDs and names rather than golfer IDs', (format) => {
    const value = fictionalPurse(8, format, [4]);
    const plan = value.configuration.plan;
    if (!plan) throw new Error('Missing fictional plan.');
    const ties = currentTies({ ...plan, pools: plan.pools.map((pool) => 'prizes' in pool ? { ...pool, tiePolicy: 'organizer' } : pool) }, value);
    expect(ties[0]?.entrants).toHaveLength(format === 'four-two-net' ? 2 : 4);
    expect(ties[0]?.entrants.every((entrant) => entrant.name.startsWith('Fictional team'))).toBe(true);
  });
  it('supports overall ties and suppresses disabled or missing source outcomes', () => {
    const value = fictionalPurse(4, undefined, [4]);
    const plan = value.configuration.plan;
    const pool = plan?.pools[0];
    if (!plan || !pool || !('prizes' in pool)) throw new Error('Missing fictional ranked pool.');
    const overall: PursePlan = { ...plan, pools: [{ ...pool, source: { kind: 'overall' }, tiePolicy: 'organizer' }] };
    expect(currentTies(overall, value)[0]?.entrants).toHaveLength(4);
    const { overallCompetition: _competition, ...workspace } = value.workspace;
    expect(_competition).toBeDefined();
    expect(currentTies(overall, { ...value, workspace })).toEqual([]);
  });
});
