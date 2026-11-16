import type { IndexObservation, TeeProfile } from './catalog.js';
import type { RoundGroup } from './setup.js';
import type { GameTeam } from './games.js';
import type { PlayerTeeSelection } from './tees.js';
import type { AccountIdentity } from './events.js';

export type RoundReviewWarningCode =
  | 'kp-review-required'
  | 'purse-review-required'
  | 'team-review-required'
  | 'churchy-review-required';

export interface RoundReviewWarning {
  readonly code: RoundReviewWarningCode;
  readonly message: string;
}

export interface RoundCorrectionPlayerInput {
  readonly playerId: string;
  readonly handicapIndexValue: string | null;
}

export interface RoundCorrectionGameTeamsInput {
  readonly gameId: string;
  readonly teams: readonly GameTeam[];
}

export interface RoundCorrectionInput {
  readonly teeProfileId: number;
  readonly playerTeeSelections?: readonly PlayerTeeSelection[];
  readonly groups: readonly RoundGroup[];
  readonly players: readonly RoundCorrectionPlayerInput[];
  readonly gameTeams?: readonly RoundCorrectionGameTeamsInput[];
}

export interface RoundCorrectionExpectedVersions {
  readonly eventEtag: string;
  readonly roundEtag: string;
  readonly gamesEtag?: string | null;
  readonly inputRevision?: string | null;
}

export interface RoundCorrectionWriteRequest {
  readonly expected: RoundCorrectionExpectedVersions;
  readonly correction: RoundCorrectionInput;
  readonly reason: string;
  readonly reviewSummary?: string;
}

export interface RoundCorrectionPlayerView {
  readonly playerId: string;
  readonly displayName: string;
  readonly handicapIndex: IndexObservation | null;
}

export interface RoundCorrectionReadModel {
  readonly eventId: string;
  readonly roundId: string;
  readonly eventEtag: string;
  readonly roundEtag: string;
  readonly gamesEtag?: string | null;
  readonly inputRevision?: string;
  readonly allowPerGolferTees: boolean;
  readonly teeProfileId: number;
  readonly compatibleTees: readonly TeeProfile[];
  readonly players: readonly RoundCorrectionPlayerView[];
  readonly playerTeeSelections: readonly PlayerTeeSelection[];
  readonly groups: readonly RoundGroup[];
  readonly gameTeams: readonly RoundCorrectionGameTeamsInput[];
  readonly warnings: readonly RoundReviewWarning[];
}

export interface RoundCorrectionReceipt {
  readonly id: string;
  readonly eventId: string;
  readonly roundId: string;
  readonly expected: RoundCorrectionExpectedVersions;
  readonly before: RoundCorrectionInput;
  readonly after: RoundCorrectionInput;
  readonly reason: string;
  readonly reviewSummary?: string;
  readonly warnings: readonly RoundReviewWarning[];
  readonly recordedAt: string;
  readonly recordedBy: AccountIdentity;
}

export interface RoundCorrectionWriteResult {
  readonly applied: boolean;
  readonly receiptId?: string;
  readonly model: RoundCorrectionReadModel;
}
