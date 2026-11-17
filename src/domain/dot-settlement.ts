export interface InternalSettlementPlayer {
  readonly playerId: string;
  readonly displayName: string;
  readonly baseDots: number | null;
  readonly specialDots: number | null;
  readonly totalDots: number | null;
  readonly netMinor: number | null;
}

export interface InternalGameSettlement {
  readonly version: 1;
  readonly groupNumber: number;
  readonly gameIds: readonly string[];
  readonly currency: 'USD';
  readonly stakeMinor: number | null;
  readonly status: 'points-only' | 'pending' | 'projected' | 'complete' | 'unavailable';
  readonly players: readonly InternalSettlementPlayer[];
  readonly totalToSettleMinor: number | null;
  readonly pairwise: readonly {
    readonly fromPlayerId: string;
    readonly toPlayerId: string;
    readonly amountMinor: number;
  }[];
  readonly reason?: string;
}

function exact(value: bigint): number | null {
  return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

export function calculateDotSettlement(input: {
  readonly groupNumber: number;
  readonly gameIds: readonly string[];
  readonly stakeMinor: number | null;
  readonly players: readonly Omit<InternalSettlementPlayer, 'totalDots' | 'netMinor'>[];
  readonly complete: boolean;
  readonly unavailable?: boolean;
}): InternalGameSettlement {
  const players = input.players.map((player): InternalSettlementPlayer => ({ ...player,
    totalDots: player.baseDots === null || player.specialDots === null ? null
      : Number.isSafeInteger(player.baseDots) && player.baseDots >= 0
        && Number.isSafeInteger(player.specialDots) && player.specialDots >= 0
        ? exact(BigInt(player.baseDots) + BigInt(player.specialDots)) : null, netMinor: null }));
  const base = { version: 1 as const, groupNumber: input.groupNumber, gameIds: input.gameIds, currency: 'USD' as const,
    stakeMinor: input.stakeMinor, players, totalToSettleMinor: null, pairwise: [] };
  if (players.length !== 4 || new Set(players.map((player) => player.playerId)).size !== 4
    || input.unavailable || !Number.isSafeInteger(input.groupNumber) || input.groupNumber < 1
    || input.gameIds.length < 1 || new Set(input.gameIds).size !== input.gameIds.length
    || input.stakeMinor !== null && (!Number.isSafeInteger(input.stakeMinor) || input.stakeMinor < 0)
    || players.some((player) => player.baseDots !== null && (!Number.isSafeInteger(player.baseDots) || player.baseDots < 0)
      || player.specialDots !== null && (!Number.isSafeInteger(player.specialDots) || player.specialDots < 0)
      || player.totalDots === null && player.baseDots !== null && player.specialDots !== null)) {
    return { ...base, status: 'unavailable', reason: 'Invalid or unavailable settlement inputs.' };
  }
  if (input.stakeMinor === null || input.stakeMinor === 0) return { ...base, status: 'points-only' };
  if (players.some((player) => player.totalDots === null)) return { ...base, status: 'pending' };
  const sum = players.reduce((total, player) => total + BigInt(player.totalDots ?? 0), 0n);
  const balances = players.map((player) => exact((4n * BigInt(player.totalDots ?? 0) - sum) * BigInt(input.stakeMinor ?? 0)));
  if (balances.some((balance) => balance === null)) return { ...base, status: 'unavailable', reason: 'Settlement exceeds exact arithmetic range.' };
  const total = exact(balances.reduce<bigint>((amount, balance) => amount + BigInt(Math.max(0, balance ?? 0)), 0n));
  if (total === null) return { ...base, status: 'unavailable', reason: 'Settlement exceeds exact arithmetic range.' };
  const pairwise: InternalGameSettlement['pairwise'][number][] = [];
  for (const [index, player] of players.entries()) for (const other of players.slice(index + 1)) {
    const difference = BigInt(player.totalDots ?? 0) - BigInt(other.totalDots ?? 0);
    const amount = exact((difference < 0n ? -difference : difference) * BigInt(input.stakeMinor));
    if (amount === null) return { ...base, status: 'unavailable', reason: 'Settlement exceeds exact arithmetic range.' };
    if (amount > 0) pairwise.push({ fromPlayerId: difference > 0n ? other.playerId : player.playerId,
      toPlayerId: difference > 0n ? player.playerId : other.playerId, amountMinor: amount });
  }
  return { ...base, status: input.complete ? 'complete' : 'projected',
    players: players.map((player, index) => ({ ...player, netMinor: balances[index] ?? null })),
    totalToSettleMinor: total, pairwise };
}
