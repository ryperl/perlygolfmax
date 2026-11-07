import type { CourseMetadata, IndexObservation, TeeProfile } from './catalog.js';
import type { EventSummary } from './events.js';
import type { PlayerTeeProfile, PlayerTeeSelection } from './tees.js';

export type OverallCompetition =
  | {
    readonly kind: 'stableford';
    readonly credit: 'individual' | 'team';
    readonly roundGames: readonly { readonly roundId: string; readonly gameId: string }[];
  }
  | { readonly kind: 'stroke-play'; readonly basis: 'gross' }
  | { readonly kind: 'stroke-play'; readonly basis: 'net'; readonly handicapAllowancePercent: number };

export const maximumEventSetupBytes = 12 * 1024;

export function sameOverallCompetition(
  left?: OverallCompetition | null, right?: OverallCompetition | null,
): boolean {
  if (left == null || right == null) return left == null && right == null;
  if (left.kind === 'stableford') {
    return right.kind === 'stableford' && left.credit === right.credit
      && left.roundGames.length === right.roundGames.length
      && left.roundGames.every((binding) => right.roundGames.some((other) =>
        binding.roundId === other.roundId && binding.gameId === other.gameId));
  }
  return right.kind === 'stroke-play' && left.basis === right.basis
    && (left.basis === 'gross' || right.basis === 'net' && left.handicapAllowancePercent === right.handicapAllowancePercent);
}

export interface RoundGroup {
  readonly number: number;
  readonly playerIds: readonly string[];
  /** Omission uses the first hole in the captured round layout. */
  readonly startingHole?: number;
}

export interface RoundSetupInput {
  readonly id: string;
  readonly name: string;
  readonly teeTime?: string;
  readonly startDate?: string;
  readonly courseId: string;
  readonly courseVersionId: string;
  readonly teeProfileId: number;
  readonly groups: readonly RoundGroup[];
  readonly playerTeeSelections?: readonly PlayerTeeSelection[];
}

export interface EventSetupInput {
  readonly name: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly location: string;
  readonly playerIds: readonly string[];
  readonly rounds: readonly RoundSetupInput[];
  readonly overallCompetition?: OverallCompetition | null;
  readonly allowPerGolferTees?: boolean;
}

export interface EventRosterPlayer {
  readonly playerId: string;
  readonly displayName: string;
  readonly handicapIndexValue?: string | null;
}

export interface RoundPlayerSnapshot extends EventRosterPlayer {
  readonly handicapIndex?: IndexObservation | null;
}

export interface RoundSnapshot {
  readonly id: string;
  readonly name: string;
  readonly teeTime?: string;
  readonly startDate?: string;
  readonly courseId: string;
  readonly courseVersionId: string;
  readonly course: CourseMetadata;
  readonly teeProfile: TeeProfile;
  readonly groups: readonly RoundGroup[];
  readonly players: readonly RoundPlayerSnapshot[];
  readonly scoringStarted?: boolean;
  readonly playerTees?: readonly PlayerTeeProfile[];
}

export interface EventWorkspace {
  readonly event: EventSummary;
  readonly location: string;
  readonly roster: readonly EventRosterPlayer[];
  readonly rounds: readonly RoundSnapshot[];
  readonly etag: string;
  readonly overallCompetition?: OverallCompetition;
  readonly allowPerGolferTees?: boolean;
  readonly viewerPlayerId?: string;
  readonly canViewScores?: boolean;
  readonly testerAccess?: true;
  readonly publicAccess?: true;
  readonly purseConfigured?: boolean;
}
