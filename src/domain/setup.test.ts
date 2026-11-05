import { describe, expect, it } from 'vitest';
import { sameOverallCompetition } from './setup.js';

describe('semantic overall competition equality', () => {
  it('compares binding membership and fields independently of JSON property and binding order', () => {
    expect(sameOverallCompetition(
      { kind: 'stableford', credit: 'individual', roundGames: [{ roundId: 'r1', gameId: 'g1' }, { roundId: 'r2', gameId: 'g2' }] },
      { roundGames: [{ gameId: 'g2', roundId: 'r2' }, { gameId: 'g1', roundId: 'r1' }], credit: 'individual', kind: 'stableford' },
    )).toBe(true);
    expect(sameOverallCompetition({ kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 95 },
      { handicapAllowancePercent: 95, basis: 'net', kind: 'stroke-play' })).toBe(true);
    expect(sameOverallCompetition({ kind: 'stroke-play', basis: 'gross' }, { basis: 'gross', kind: 'stroke-play' })).toBe(true);
    expect(sameOverallCompetition(undefined, null)).toBe(true);
    expect(sameOverallCompetition(null, undefined)).toBe(true);
    expect(sameOverallCompetition()).toBe(true);
  });

  it('distinguishes rules, allowance, credit and selected saved games', () => {
    expect(sameOverallCompetition(null, { kind: 'stroke-play', basis: 'gross' })).toBe(false);
    expect(sameOverallCompetition({ kind: 'stroke-play', basis: 'gross' }, null)).toBe(false);
    expect(sameOverallCompetition({ kind: 'stroke-play', basis: 'gross' },
      { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 95 })).toBe(false);
    expect(sameOverallCompetition({ kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 95 },
      { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 100 })).toBe(false);
    const competition = { kind: 'stableford', credit: 'individual', roundGames: [{ roundId: 'r1', gameId: 'g1' }] } as const;
    expect(sameOverallCompetition(competition, { ...competition, credit: 'team' })).toBe(false);
    expect(sameOverallCompetition(competition, { ...competition, roundGames: [] })).toBe(false);
    expect(sameOverallCompetition(competition, { ...competition, roundGames: [{ roundId: 'r1', gameId: 'g2' }] })).toBe(false);
    expect(sameOverallCompetition(competition, { kind: 'stroke-play', basis: 'gross' })).toBe(false);
    expect(sameOverallCompetition({ kind: 'stroke-play', basis: 'gross' }, competition)).toBe(false);
  });
});
