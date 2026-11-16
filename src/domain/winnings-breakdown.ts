import type { PurseCurrency } from './purse.js';
import type { EventPurseView } from './purse-settings.js';
import { allocatedPlayerAwards } from './purse-awards.js';
import { calculateKp } from './kp.js';

export type WinningsPart =
  | { readonly kind: 'place'; readonly amountMinor: number; readonly rank: number;
    readonly teamName: string | null; readonly memberCount: number; readonly tiedEntrants: number;
    readonly tiePolicy: 'pooled' | 'organizer'; readonly awardPlace: number }
  | { readonly kind: 'kp'; readonly amountMinor: number; readonly holeNumber: number; readonly distanceInches: number;
    readonly splitCount: number; readonly resolution: 'unique' | 'selected' | 'split' }
  | { readonly kind: 'event-skins'; readonly amountMinor: number; readonly skins: number; readonly perSkinMinor: number }
  | { readonly kind: 'manual'; readonly amountMinor: number; readonly recipientCount: number };

export interface PlayerWinningsBreakdown {
  readonly version: 1;
  readonly eventId: string;
  readonly playerId: string;
  readonly displayName: string;
  readonly currency: PurseCurrency | null;
  readonly amountMinor: number | null;
  readonly needsReview: boolean;
  readonly pendingPools: number;
  readonly unavailablePools: number;
  readonly awards: readonly {
    readonly poolId: string;
    readonly poolName: string;
    readonly roundName: string | null;
    readonly amountMinor: number;
    readonly parts: readonly WinningsPart[];
  }[];
}

export function playerWinningsBreakdown(value: EventPurseView, playerId: string): PlayerWinningsBreakdown | null {
  const player = value.workspace.roster.find((entry) => entry.playerId === playerId);
  if (!player) return null;
  const calculation = value.view?.calculation;
  const plan = value.configuration.plan;
  const known = allocatedPlayerAwards(calculation, playerId);
  const awards: PlayerWinningsBreakdown['awards'][number][] = [];
  let needsReview = plan !== null && (!calculation || calculation.status === 'unavailable');
  for (const award of known.pools) {
    const pool = plan?.pools.find((entry) => entry.id === award.poolId);
    const result = calculation?.pools.find((entry) => entry.poolId === award.poolId);
    if (!pool || !result) { needsReview = true; continue; }
    const source = pool.source;
    const round = source.kind === 'round-game' || source.kind === 'kp'
      ? value.workspace.rounds.find((entry) => entry.id === source.roundId) : undefined;
    const saved = round ? value.roundScores.find((entry) => entry.roundId === round.id) : undefined;
    const kp = source.kind === 'kp' && saved ? calculateKp(saved) : undefined;
    const parts: WinningsPart[] = [];
    for (const share of award.shares.filter((entry) => entry.amountMinor > 0)) {
      if (source.kind === 'kp') {
        const holeNumber = Number(share.entrantId.slice(share.entrantId.lastIndexOf(':') + 1));
        const entry = saved?.cards.find((card) => card.playerId === playerId)?.holes.find((hole) => hole.number === holeNumber)?.score.kp;
        if (entry?.kind !== 'measured') { needsReview = true; continue; }
        parts.push({ kind: 'kp', amountMinor: share.amountMinor, holeNumber, distanceInches: entry.inches,
          splitCount: result.shares.filter((entry) => entry.entrantId === share.entrantId).length,
          resolution: (kp?.holes.find((hole) => hole.number === holeNumber)?.closestPlayerIds.length ?? 0) > 1
            ? saved?.kp?.decisions.find((decision) => decision.holeNumber === holeNumber)?.kind === 'winner' ? 'selected' : 'split' : 'unique' });
      } else if (source.kind === 'event-skins') {
        const unit = result.eventSkins?.perSkinMinor;
        if (!unit || share.amountMinor % unit !== 0) { needsReview = true; continue; }
        parts.push({ kind: 'event-skins', amountMinor: share.amountMinor, skins: share.amountMinor / unit, perSkinMinor: unit });
      } else if (source.kind === 'manual' && 'recipientIds' in pool) {
        parts.push({ kind: 'manual', amountMinor: share.amountMinor, recipientCount: pool.recipientIds.length });
      } else if ('prizes' in pool && share.rank !== null) {
        const game = source.kind === 'round-game'
          ? saved?.games?.configuration.games.find((entry) => entry.id === source.gameId) : undefined;
        const team = game && 'teams' in game ? game.teams.find((entry) => entry.id === share.entrantId) : undefined;
        const decision = value.configuration.resolutions.find((entry) => entry.poolId === pool.id && entry.rank === share.rank);
        const tiedEntrants = decision?.orderedEntrantIds.length
          ?? new Set(result.shares.filter((entry) => entry.rank === share.rank).map((entry) => entry.entrantId)).size;
        const offset = decision?.orderedEntrantIds.indexOf(share.entrantId) ?? 0;
        parts.push({ kind: 'place', amountMinor: share.amountMinor, rank: share.rank, teamName: team?.name ?? null,
          memberCount: team?.playerIds.length ?? 1, tiedEntrants, tiePolicy: pool.tiePolicy,
          awardPlace: share.rank + (offset > 0 ? offset : 0) });
      }
    }
    if (parts.reduce((sum, part) => sum + BigInt(part.amountMinor), 0n) !== BigInt(award.amountMinor)) needsReview = true;
    awards.push({ poolId: pool.id, poolName: pool.name, roundName: round?.name ?? null, amountMinor: award.amountMinor, parts });
  }
  return {
    version: 1, eventId: value.workspace.event.id, playerId, displayName: player.displayName,
    currency: plan?.currency ?? null, amountMinor: plan ? known.amountMinor : null, needsReview,
    pendingPools: calculation?.pools.filter((pool) => pool.status === 'projected').length ?? 0,
    unavailablePools: calculation?.pools.filter((pool) => pool.status === 'unavailable').length ?? 0, awards,
  };
}
