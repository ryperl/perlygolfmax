import { describe, expect, it } from 'vitest';
import { calculateDotSettlement } from './dot-settlement.js';

function settle(dots: readonly (number | null)[], stakeMinor: number | null = 100, complete = true) {
  return calculateDotSettlement({ groupNumber: 1, gameIds: ['fictional-wolf', 'fictional-dots'], stakeMinor, complete,
    players: dots.map((total, index) => ({ playerId: `fictional-player-${String(index)}`,
      displayName: `Fictional golfer ${String(index + 1)}`, baseDots: total, specialDots: 0 })) });
}
describe('shared independent-game settlement', () => {
  it.each([
    [[6, 6, 1, 1], 100, [1000, 1000, -1000, -1000], 2000],
    [[10, 3, 2, 1], 100, [2400, -400, -800, -1200], 2400],
    [[6, 6, 1, 1], 50, [500, 500, -500, -500], 1000],
    [[1, 0, 0, 0], 1, [3, -1, -1, -1], 3],
  ] as const)('settles individual dots %j at %i minor units against every opponent once', (dots, stake, net, total) => {
    const result = settle(dots, stake);
    expect(result.status).toBe('complete');
    expect(result.players.map((player) => player.netMinor)).toEqual(net);
    expect(result.totalToSettleMinor).toBe(total);
    expect(result.players.reduce((sum, player) => sum + (player.netMinor ?? 0), 0)).toBe(0);
  });
  it('distinguishes total to settle from gross pairwise obligations and avoids a fixed money pot', () => {
    const result = settle([10, 3, 2, 1]);
    expect(result.pairwise.reduce((sum, pair) => sum + pair.amountMinor, 0)).toBe(2800);
    expect(result.totalToSettleMinor).toBe(2400);
    expect(settle([4, 4, 4, 4]).totalToSettleMinor).toBe(0);
    expect(settle([11, 4, 3, 2]).players.map((player) => player.netMinor)).toEqual(result.players.map((player) => player.netMinor));
  });
  it('combines source dots once and preserves points-only, provisional and pending outcomes', () => {
    const result = calculateDotSettlement({ groupNumber: 1, gameIds: ['fictional-wolf', 'fictional-dots'], stakeMinor: 100, complete: false,
      players: [4, 4, 0, 0].map((dots, index) => ({ playerId: String(index), displayName: 'Fictional golfer', baseDots: dots, specialDots: 2 })) });
    expect(result.players.map((player) => player.totalDots)).toEqual([6, 6, 2, 2]);
    expect(result.status).toBe('projected');
    expect(settle([null, 0, 0, 0]).status).toBe('pending');
    for (const amount of [null, 0]) {
      expect(settle([6, 6, 1, 1], amount)).toMatchObject({ status: 'points-only', totalToSettleMinor: null, pairwise: [] });
    }
  });
  it('fails explicitly on unsafe money, dots, duplicate recipients and unsupported group sizes', () => {
    expect(settle([Number.MAX_SAFE_INTEGER, 0, 0, 0]).status).toBe('unavailable');
    expect(settle([1, 2, 3]).status).toBe('unavailable');
    expect(settle([-1, 1, 1, 1]).status).toBe('unavailable');
    expect(settle([1, 1, 1, 1], -1).status).toBe('unavailable');
  });
});
