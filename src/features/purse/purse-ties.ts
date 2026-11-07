import { calculateEventStandings } from '../../domain/event-leaderboard';
import { gameResultDirection, gameResultTotal, isTeamGameDefinition } from '../../domain/games';
import type { EventPurseView } from '../../domain/purse-settings';
import { calculatePurse } from '../../domain/purse';
import type { PursePlan, PurseTieResolution } from '../../domain/purse';

export interface AwardTie {
  readonly poolId: string;
  readonly rank: number;
  readonly entrants: readonly { readonly id: string; readonly name: string }[];
}

/** Display candidates only from saved source results validated by the calculator. */
export function currentTies(plan: PursePlan, value: EventPurseView): readonly AwardTie[] {
  const calculation = calculatePurse(plan, value.workspace, value.roundScores);
  return plan.pools.flatMap((pool): readonly AwardTie[] => {
    if (!('tiePolicy' in pool) || pool.tiePolicy !== 'organizer'
      || calculation.pools.find((entry) => entry.poolId === pool.id)?.status === 'unavailable') return [];
    let entrants: readonly { readonly id: string; readonly name: string; readonly rank: number | null }[];
    if (pool.source.kind === 'overall') {
      entrants = calculateEventStandings(value.workspace, value.roundScores).players.map((player) => ({
        id: player.playerId, name: player.displayName, rank: player.rank,
      }));
    } else {
      const source = pool.source;
      const round = value.roundScores.find((entry) => entry.roundId === source.roundId);
      const game = round?.games?.configuration.games.find((entry) => entry.id === source.gameId);
      const result = round?.games?.results.find((entry) => entry.gameId === source.gameId);
      const entries = game && isTeamGameDefinition(game) ? result?.teams ?? [] : result?.players ?? [];
      const ranked = entries.filter((entry) => entry.holesScored > 0 && gameResultTotal(entry) !== null)
        .sort((left, right) => {
          const a = gameResultTotal(left);
          const b = gameResultTotal(right);
          return !game || a === null || b === null || a === b ? 0 : (a < b ? -1 : 1) * gameResultDirection(game);
        });
      entrants = ranked.map((entry) => ({
        id: 'teamId' in entry ? entry.teamId : entry.playerId, name: entry.displayName,
        rank: ranked.findIndex((other) => gameResultTotal(other) === gameResultTotal(entry)) + 1,
      }));
    }
    return [...new Set(entrants.flatMap((entry) => entry.rank === null ? [] : [entry.rank]))].flatMap((rank) => {
      const tied = entrants.filter((entry) => entry.rank === rank);
      return tied.length < 2 ? [] : [{ poolId: pool.id, rank, entrants: tied }];
    });
  });
}

export function matchesTie(resolution: PurseTieResolution, tie: AwardTie): boolean {
  return resolution.poolId === tie.poolId && resolution.rank === tie.rank
    && resolution.orderedEntrantIds.length === tie.entrants.length
    && new Set(resolution.orderedEntrantIds).size === tie.entrants.length
    && resolution.orderedEntrantIds.every((id) => tie.entrants.some((entrant) => entrant.id === id));
}
