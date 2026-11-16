import { describe, expect, it } from 'vitest';
import { fictionalPurse } from '../../tests/smoke/purse-fixture-data';
import { publicPurseSummary } from '../domain/public-purse';
import { purseTestId } from '../domain/purse.test-support';
import { isPublicPurseSummary } from './public-purse';

const value = publicPurseSummary(fictionalPurse());
describe('allowlisted public purse contract', () => {
  it('accepts producer-generated summaries and explicit unconfigured projections', () => {
    expect(isPublicPurseSummary(value)).toBe(true);
    const original = fictionalPurse();
    expect(isPublicPurseSummary(publicPurseSummary({ ...original, view: null,
      configuration: { ...original.configuration, plan: null } }))).toBe(true);
  });
  it.each([
    { ...value, roundScores: [] }, { ...value, configuration: {} }, { ...value, version: 2 },
    { ...value, currency: 'INVALID' }, { ...value, pools: [...value.pools, ...value.pools] },
    { ...value, players: [...value.players, ...value.players] },
    { ...value, players: value.players.map((player) => ({ ...player, amountMinor: 1 })) },
    { ...value, players: value.players.map((player) => ({ ...player, amountMinor: -1 })) },
    { ...value, players: value.players.map((player) => ({ ...player, amountMinor: Infinity })) },
    { ...value, pools: value.pools.map((pool) => ({ ...pool, status: 'pending' })) },
    { ...value, pools: value.pools.map((pool) => ({ ...pool, status: { toString: null } })) },
    { ...value, pools: value.pools.map((pool) => ({ ...pool, awardUnit: { toString: null } })) },
    { ...value, eventName: 'Fictional\u0000event' },
    { ...value, players: value.players.map((player) => ({ ...player, poolIds: [purseTestId(999)] })) },
    { ...value, rounds: value.rounds.map((round) => ({ ...round, handicapIndex: '1.0' })) },
  ])('rejects extra/private data, malformed money and unbound or provisional awards %#', (invalid) => {
    expect(isPublicPurseSummary(invalid)).toBe(false);
  });
});
