import type { CourseHole, CourseRating } from './catalog.js';
import type { EventStatus } from './events.js';
import type { ScoreActor } from './test-access.js';
import type { RoundGroup } from './setup.js';
import type { GameChange, GameUnavailableReason, RoundGamesView } from './games.js';
import type { PlayerTeeProfile } from './tees.js';

export type HoleScore =
  | { readonly kind: 'unplayed' }
  | { readonly kind: 'strokes'; readonly strokes: number }
  | { readonly kind: 'picked-up'; readonly reportedStrokes?: number }
  | { readonly kind: 'did-not-finish' };

export interface ScoredHole {
  readonly number: number;
  readonly score: HoleScore;
}

export interface Scorecard {
  readonly playerId: string;
  readonly displayName: string;
  readonly etag: string | null;
  readonly updatedAt: string | null;
  readonly holes: readonly ScoredHole[];
}

export interface ScorePermissions {
  readonly role: 'owner' | 'player' | 'viewer' | 'tester' | 'public';
  readonly viewerPlayerId?: string;
  readonly writePlayerIds: readonly string[];
  readonly canManageGames: boolean;
}

export interface OverallHandicaps {
  readonly allowancePercent: number;
  readonly players: readonly {
    readonly playerId: string;
    readonly playingHandicap: number | null;
    readonly unavailableReason?: GameUnavailableReason;
  }[];
}

export interface PlayerCourseHandicap {
  readonly playerId: string;
  readonly courseHandicap: number | null;
  readonly unavailableReason?: 'missing-handicap-index' | 'uncaptured-handicap-index' | 'invalid-handicap-index' | 'missing-tee-ratings';
}

export interface RoundScores {
  readonly eventId: string;
  readonly eventName: string;
  readonly eventStatus: EventStatus;
  readonly roundId: string;
  readonly roundName: string;
  readonly courseName: string;
  readonly teeName: string;
  readonly teeCategory: string;
  readonly teeRatings?: readonly CourseRating[];
  readonly layout: readonly CourseHole[];
  readonly groups: readonly RoundGroup[];
  readonly cards: readonly Scorecard[];
  readonly setupLocked: boolean;
  readonly lastUpdatedAt: string | null;
  readonly games?: RoundGamesView;
  readonly playerTees?: readonly PlayerTeeProfile[];
  readonly permissions?: ScorePermissions;
  readonly overallHandicaps?: OverallHandicaps;
  readonly courseHandicaps?: readonly PlayerCourseHandicap[];
}

export function scorePermissions(round: RoundScores): ScorePermissions {
  return round.permissions ?? { role: 'viewer', writePlayerIds: [], canManageGames: false };
}

export interface ScoreChange {
  readonly id: string;
  readonly eventId: string;
  readonly roundId: string;
  readonly playerId: string;
  readonly holeNumber: number;
  readonly before: HoleScore;
  readonly after: HoleScore;
  readonly expectedEtag: string | null;
  readonly recordedAt: string;
  readonly recordedBy: ScoreActor;
}

export interface ScoreWriteResult {
  readonly round: RoundScores;
  readonly change: ScoreChange;
}

export interface GameWriteResult {
  readonly round: RoundScores;
  readonly change: GameChange;
}

export interface ScoreHistoryPage {
  readonly changes: readonly ScoreChange[];
  readonly continuationToken?: string;
}

export interface GrossScoreSummary {
  readonly recordedStrokes: number;
  readonly numericHoles: number;
  readonly recordedHoles: number;
  readonly totalHoles: number;
  readonly unplayedHoles: number;
  readonly pickedUpHoles: number;
  readonly didNotFinishHoles: number;
  readonly completeGross: number | null;
}

// This only bounds arithmetic precision; it is not a golf scoring cap.
export const maximumExactHoleStrokes = Math.floor(Number.MAX_SAFE_INTEGER / 18);

export function sameHoleScore(left: HoleScore, right: HoleScore): boolean {
  return left.kind === right.kind
    && (left.kind !== 'strokes' || right.kind === 'strokes' && left.strokes === right.strokes)
    && (left.kind !== 'picked-up' || right.kind === 'picked-up' && left.reportedStrokes === right.reportedStrokes);
}

export function sameScoreActor(left: ScoreActor, right: ScoreActor): boolean {
  if ('kind' in left || 'kind' in right) {
    return 'kind' in left && 'kind' in right
      && left.kind === right.kind && left.eventId === right.eventId
      && (left.kind === 'public-score' || right.kind === 'tester-link' && left.linkId === right.linkId);
  }
  return left.tenantId === right.tenantId && left.objectId === right.objectId;
}

export function scoreActor(identity: ScoreActor): ScoreActor {
  return 'kind' in identity
    ? identity.kind === 'public-score' ? { kind: 'public-score', eventId: identity.eventId }
      : { kind: 'tester-link', eventId: identity.eventId, linkId: identity.linkId }
    : { tenantId: identity.tenantId, objectId: identity.objectId };
}

export function summarizeGross(holes: readonly ScoredHole[]): GrossScoreSummary {
  let recordedStrokes = 0;
  let numericHoles = 0;
  let recordedHoles = 0;
  let unplayedHoles = 0;
  let pickedUpHoles = 0;
  let didNotFinishHoles = 0;
  for (const hole of holes) {
    switch (hole.score.kind) {
      case 'strokes': recordedStrokes += hole.score.strokes; numericHoles++; recordedHoles++; break;
      case 'unplayed': unplayedHoles++; break;
      case 'picked-up':
        pickedUpHoles++;
        if (hole.score.reportedStrokes !== undefined) { recordedStrokes += hole.score.reportedStrokes; recordedHoles++; }
        break;
      case 'did-not-finish': didNotFinishHoles++; break;
    }
  }
  return {
    recordedStrokes, numericHoles, recordedHoles, totalHoles: holes.length, unplayedHoles, pickedUpHoles, didNotFinishHoles,
    completeGross: holes.length > 0 && numericHoles === holes.length ? recordedStrokes : null,
  };
}
