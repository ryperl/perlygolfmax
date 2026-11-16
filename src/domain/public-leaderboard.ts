import type { EventSummary } from './events.js';
import type { EventLeaderboardView, EventStandings, EventStandingRound } from './event-leaderboard.js';
import type { EventSkinsConfiguration, EventSkinsHole, EventSkinsResults } from './event-skins.js';
import type { OverallCompetition } from './setup.js';

type EventHeading = Pick<EventSummary, 'id' | 'name' | 'status' | 'role'>;
type CompetitionDescription = { readonly kind: 'stableford'; readonly credit: 'individual' | 'team' }
  | Extract<OverallCompetition, { readonly kind: 'stroke-play' }>;

export interface OverallResultsDisplay {
  readonly workspace: {
    readonly event: EventHeading;
    readonly overallCompetition?: CompetitionDescription;
  };
  readonly standings: Omit<EventStandings, 'rounds'> & {
    readonly rounds: readonly Pick<EventStandingRound, 'roundId' | 'roundName'>[];
  };
}
export interface EventSkinsDisplay {
  readonly workspace: {
    readonly event: EventHeading;
    readonly eventSkinsSupported?: true;
    readonly eventSkins?: EventSkinsConfiguration;
    readonly purseConfigured?: boolean;
    readonly rounds: readonly { readonly id: string; readonly name: string }[];
    readonly roster: readonly { readonly playerId: string; readonly displayName: string }[];
  };
  readonly eventSkins?: Omit<EventSkinsResults, 'holes'> & {
    readonly holes: readonly Pick<EventSkinsHole, 'roundId' | 'number' | 'status' | 'reason' | 'winnerId' | 'grossUnderParPriority'>[];
  };
}
export type PublicLeaderboardKind = 'overall' | 'event-skins';
export type PublicLeaderboardSummary =
  | (OverallResultsDisplay & { readonly version: 1; readonly kind: 'overall' })
  | (EventSkinsDisplay & { readonly version: 1; readonly kind: 'event-skins' });

export function publicLeaderboardSummary(value: EventLeaderboardView, kind: PublicLeaderboardKind): PublicLeaderboardSummary {
  const { id, name, status, role } = value.workspace.event;
  const event = { id, name, status, role };
  if (kind === 'overall') {
    const competition = value.workspace.overallCompetition;
    return {
      version: 1, kind, workspace: { event, ...(competition ? {
        overallCompetition: competition.kind === 'stableford'
          ? { kind: 'stableford', credit: competition.credit } : { ...competition },
      } : {}) },
      standings: { ...value.standings,
        rounds: value.standings.rounds.map(({ roundId, roundName }) => ({ roundId, roundName })),
        players: value.standings.players.map((player) => ({ ...player, cells: player.cells.map((cell) => ({ ...cell })) })),
        staleRoundIds: [...value.standings.staleRoundIds],
      },
    };
  }
  const workspace = value.workspace;
  const skins = value.eventSkins;
  return {
    version: 1, kind,
    workspace: { event,
      ...(workspace.eventSkinsSupported === true ? { eventSkinsSupported: true } : {}),
      ...(workspace.eventSkins ? { eventSkins: { version: 1 } } : {}),
      ...(workspace.purseConfigured === undefined ? {} : { purseConfigured: workspace.purseConfigured }),
      rounds: workspace.rounds.map(({ id, name }) => ({ id, name })),
      roster: workspace.roster.map(({ playerId, displayName }) => ({ playerId, displayName })),
    },
    ...(skins ? { eventSkins: {
      status: skins.status, awardedSkins: skins.awardedSkins, pendingHoles: skins.pendingHoles,
      unavailableHoles: skins.unavailableHoles, totalHoles: skins.totalHoles,
      players: skins.players.map((player) => ({ ...player, cells: player.cells.map((cell) => ({ ...cell })) })),
      holes: skins.holes.map(({ roundId, number, status, reason, winnerId, grossUnderParPriority }) => ({
        roundId, number, status, winnerId, grossUnderParPriority, ...(reason ? { reason } : {}),
      })),
    } } : {}),
  };
}
