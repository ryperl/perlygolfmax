import type { CourseHole, CourseRating } from './catalog.js';
import type { EventStatus } from './events.js';
import type { ScoreActor } from './test-access.js';
import type { RoundGroup } from './setup.js';
import type { GameChange, GameUnavailableReason, RoundGamesView, RoundGameKind } from './games.js';
import type { NassauHoleRecord } from './nassau.js';
import type { WolfHoleRecord } from './wolf.js';
import type { DotsHoleRecord, DotsSpecialKind, DotsSpecialSelection } from './dots.js';
import { dotsSpecialCatalog } from './dots.js';
import type { InternalGameSettlement } from './dot-settlement.js';
import type { DotAwardAudit } from './dot-audit.js';
import { GameDeclarationConflictError, mergeDotsRecords, mergeNassauRecords, mergeWolfRecords, sameDotsRecords, sameNassauRecords, sameWolfRecords } from './game-declarations.js';
import type { PlayerTeeProfile } from './tees.js';
import type { ChurchySpecials } from './churchy.js';
import type { RoundDifferential } from './round-differential.js';
import { sameChurchySpecials } from './churchy.js';
import type { KpConfiguration, KpEntry } from './kp.js';
import { sameKpEntry } from './kp.js';
import type { PurseCurrency } from './purse.js';
import type { RoundReviewWarning } from './round-corrections.js';

export type HoleScore = (
  | { readonly kind: 'unplayed' }
  | { readonly kind: 'strokes'; readonly strokes: number }
  | { readonly kind: 'picked-up'; readonly reportedStrokes?: number }
  | { readonly kind: 'did-not-finish' }) & {
    readonly churchy?: ChurchySpecials; readonly kp?: KpEntry | null;
    /** Shared game-ID-bound match/press ledger; the game kind and proof distinguish Nassau from Match Play. */
    readonly nassau?: readonly NassauHoleRecord[]; readonly wolf?: readonly WolfHoleRecord[];
    readonly dots?: readonly DotsHoleRecord[];
  };

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
  readonly canManageInternalGames?: boolean;
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
  readonly dotsCoexistenceRulesVersion?: 2;
  readonly churchyCustomNames?: true;
  readonly dotsManualSweep?: true;
  readonly wolfHighLowSweep?: true;
  readonly sweepRulesVersion?: 2;
  readonly gameHandicapRules?: 1;
  readonly stringRulesVersion?: 2;
  readonly dotsCategorySweepsVersion?: 1;
  readonly churchyMurphyTargets?: true;
  readonly churchyPareeTargets?: true;
  readonly pullyMurphyTargets?: true;
  readonly gameCalculationsVersion?: 2;
  readonly dotsCallTargets?: true;
  readonly roundDifferentials?: readonly RoundDifferential[];
  readonly internalGamesSupported?: boolean;
  readonly wolfRulesVersions?: readonly (1 | 2)[];
  readonly dotsRulesVersions?: readonly (1 | 2)[];
  readonly dotsIndividualPlayerCounts?: readonly (1 | 2 | 3 | 4)[];
  readonly dotsSpecialKinds?: readonly DotsSpecialKind[];
  readonly churchyRulesVersions?: readonly (1 | 2 | 3)[];
  readonly internalSettlements?: readonly InternalGameSettlement[];
  readonly supportedGameKinds?: readonly RoundGameKind[];
  readonly gameInputContext?: { readonly courseVersionId: string; readonly teeProfileId: number };
  readonly quickRound?: true;
  readonly kpEnabled?: boolean;
  readonly kpCaptureIdentity?: string;
  readonly kp?: KpConfiguration;
  readonly kpPot?: { readonly amountMinor: number; readonly currency: PurseCurrency };
  readonly churchyEnabled?: boolean;
  readonly teeStrokeAllocation?: boolean;
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
  readonly inputRevision?: string;
  readonly reviewWarnings?: readonly RoundReviewWarning[];
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

export function supportsIndividualDotsPlayerCount(round: RoundScores, count: number): boolean {
  if (count !== 1 && count !== 2 && count !== 3 && count !== 4) return false;
  return round.dotsIndividualPlayerCounts === undefined ? count === 4 : round.dotsIndividualPlayerCounts.includes(count);
}

export function supportsRoundGame(round: Pick<RoundScores, 'supportedGameKinds' | 'churchyEnabled'>, kind: RoundGameKind): boolean {
  if (kind === 'churchy' && round.churchyEnabled !== true) return false;
  return round.supportedGameKinds !== undefined ? round.supportedGameKinds.includes(kind)
    : kind === 'churchy' || kind === 'stableford' || kind === 'ball-drop' || kind === 'skins';
}

export function supportsDotsSpecials(round: Pick<RoundScores, 'dotsSpecialKinds'>,
  specials: readonly DotsSpecialSelection[]): boolean {
  const supported = round.dotsSpecialKinds ?? dotsSpecialCatalog.filter((entry) => entry.kind !== 'other').map((entry) => entry.kind);
  return specials.every((special) => supported.includes(special.kind));
}
export interface ScoreChange {
  readonly dotAwardAudit?: readonly DotAwardAudit[];
  readonly id: string;
  readonly eventId: string;
  readonly roundId: string;
  readonly playerId: string;
  readonly holeNumber: number;
  readonly before: HoleScore;
  readonly after: HoleScore;
  readonly expectedEtag: string | null;
  readonly expectedInputRevision?: string;
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
    && sameChurchySpecials(left.churchy, right.churchy)
    && sameKpEntry(left.kp, right.kp)
    && sameNassauRecords(left.nassau, right.nassau)
    && sameWolfRecords(left.wolf, right.wolf)
    && sameDotsRecords(left.dots, right.dots)
    && (left.kind !== 'strokes' || right.kind === 'strokes' && left.strokes === right.strokes)
    && (left.kind !== 'picked-up' || right.kind === 'picked-up' && left.reportedStrokes === right.reportedStrokes);
}

/** Omission by older clients preserves independently saved extras; explicit KP null clears. */
export function preserveScoreExtras(score: HoleScore, saved: HoleScore): HoleScore {
  const savedChurchy = saved.churchy?.version === 3 ? saved.churchy : undefined;
  const churchy = score.churchy?.version === 3 && saved.churchy?.version === 3 && saved.churchy.rotation
    ? { ...score.churchy, rotation: saved.churchy.rotation } : score.churchy;
  if (score.churchy?.version === 3 && saved.churchy?.version === 3 && saved.churchy.rotation
    && (score.churchy.gameId !== saved.churchy.gameId || score.churchy.number !== saved.churchy.number
      || score.churchy.rotation && (score.churchy.rotation.playerIds.length !== saved.churchy.rotation.playerIds.length
        || score.churchy.rotation.playerIds.some((id, i) => id !== savedChurchy?.rotation?.playerIds[i])))) {
    throw new GameDeclarationConflictError('A saved Churchie order cannot be replaced.', 'CHURCHY_ORDER_CONFLICT');
  }
  if (savedChurchy?.rotation && score.churchy && score.churchy.version !== 3) {
    throw new GameDeclarationConflictError('A saved Churchie order cannot be replaced.', 'CHURCHY_ORDER_CONFLICT');
  }
  return { ...score,
    ...(churchy ? { churchy } : {}),
    ...(score.churchy === undefined && saved.churchy ? { churchy: saved.churchy } : {}),
    ...(score.kp === undefined && saved.kp !== undefined ? { kp: saved.kp } : {}),
    ...(score.nassau !== undefined ? { nassau: mergeNassauRecords(score.nassau, saved.nassau) }
      : saved.nassau ? { nassau: saved.nassau } : {}),
    ...(score.wolf !== undefined ? { wolf: mergeWolfRecords(score.wolf, saved.wolf) }
      : saved.wolf ? { wolf: saved.wolf } : {}),
    ...(score.dots !== undefined ? { dots: mergeDotsRecords(score.dots, saved.dots) }
      : saved.dots ? { dots: saved.dots } : {}),
  };
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
