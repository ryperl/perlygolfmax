import type { PurseCurrency, PursePlacePrize } from './purse.js';
import type { EventPurseView } from './purse-settings.js';
import { sortRoundsByStartDate } from './event-schedule.js';

export interface PublicPursePool {
  readonly id: string;
  readonly name: string;
  readonly roundId: string | null;
  readonly status: 'calculated' | 'pending' | 'unavailable';
  readonly awardUnit: 'per-golfer' | 'per-team' | 'pot';
  readonly prizes: readonly PursePlacePrize[];
  readonly potMinor: number | null;
}

export interface PublicPurseSummary {
  readonly version: 1;
  readonly eventId: string;
  readonly eventName: string;
  readonly currency: PurseCurrency | null;
  readonly needsReview: boolean;
  readonly rounds: readonly { readonly id: string; readonly label: string }[];
  readonly pools: readonly PublicPursePool[];
  readonly players: readonly {
    readonly playerId: string;
    readonly displayName: string;
    readonly amountMinor: number | null;
    readonly poolIds: readonly string[];
  }[];
}

/** Project authoritative calculated shares only, never pending/provisional awards or score inputs. */
export function publicPurseSummary(value: EventPurseView): PublicPurseSummary {
  const plan = value.configuration.plan;
  const calculation = value.view?.calculation;
  const rounds = sortRoundsByStartDate(value.workspace.rounds).map((round) => ({
    id: round.id, label: round.course.name === round.name ? round.name : `${round.course.name} · ${round.name}`,
  }));
  const pools = (plan?.pools ?? []).map((pool): PublicPursePool => {
    const roundId = pool.source.kind === 'round-game' || pool.source.kind === 'kp' ? pool.source.roundId : null;
    if (roundId !== null && !rounds.some((round) => round.id === roundId)) {
      rounds.push({ id: roundId, label: 'Unavailable course' });
    }
    const result = calculation?.pools.find((entry) => entry.poolId === pool.id);
    return {
      id: pool.id, name: pool.name, roundId, awardUnit: pool.awardUnit,
      status: result?.status === 'calculated' ? 'calculated' : result?.status === 'projected' ? 'pending' : 'unavailable',
      prizes: 'prizes' in pool ? pool.prizes.map(({ place, amountMinor }) => ({ place, amountMinor })) : [],
      potMinor: 'amountMinor' in pool ? pool.amountMinor : null,
    };
  });
  return {
    version: 1, eventId: value.workspace.event.id, eventName: value.workspace.event.name,
    currency: plan?.currency ?? null,
    needsReview: plan !== null && (!calculation || calculation.status === 'unavailable'),
    rounds, pools,
    players: value.workspace.roster.map(({ playerId, displayName }) => {
      const awards = (calculation?.pools ?? []).flatMap((pool) => {
        if (pool.status !== 'calculated') return [];
        const sum = pool.shares.filter((share) => share.playerId === playerId)
          .reduce((total, share) => total + BigInt(share.amountMinor), 0n);
        return sum > 0n && sum <= BigInt(Number.MAX_SAFE_INTEGER)
          ? [{ poolId: pool.poolId, amountMinor: Number(sum) }] : [];
      });
      const total = awards.reduce((sum, award) => sum + BigInt(award.amountMinor), 0n);
      const known = calculation?.players.find((player) => player.playerId === playerId)?.allocatedMinor;
      return { playerId, displayName, poolIds: awards.map((award) => award.poolId),
        amountMinor: plan === null || known === null || total > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(total) };
    }),
  };
}
