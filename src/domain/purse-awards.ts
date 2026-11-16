import type { PurseCalculation, PurseShare } from './purse.js';

export function allocatedPlayerAwards(calculation: PurseCalculation | undefined, playerId: string): {
  readonly amountMinor: number | null;
  readonly pools: readonly { readonly poolId: string; readonly amountMinor: number; readonly shares: readonly PurseShare[] }[];
} {
  const pools = (calculation?.pools ?? []).flatMap((pool) => {
    if (pool.status !== 'calculated') return [];
    const shares = pool.shares.filter((share) => share.playerId === playerId);
    const amount = shares.reduce((sum, share) => sum + BigInt(share.amountMinor), 0n);
    return amount > 0n && amount <= BigInt(Number.MAX_SAFE_INTEGER)
      ? [{ poolId: pool.poolId, amountMinor: Number(amount), shares }] : [];
  });
  const amount = pools.reduce((sum, pool) => sum + BigInt(pool.amountMinor), 0n);
  const published = calculation?.players.find((player) => player.playerId === playerId)?.allocatedMinor;
  return { pools, amountMinor: calculation === undefined || published === null
    || amount > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(amount) };
}
