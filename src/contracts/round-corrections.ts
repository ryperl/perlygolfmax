import type {
  RoundCorrectionGameTeamsInput, RoundCorrectionInput, RoundCorrectionPlayerInput, RoundCorrectionReadModel,
  RoundCorrectionReceipt, RoundCorrectionWriteRequest, RoundCorrectionWriteResult, RoundReviewWarningCode,
} from '../domain/round-corrections.js';
import { boundedText, isHandicapIndex, isIndexObservation, isTeeProfile } from './catalog.js';
import { isEventRevision, isRecord, isUuid } from './events.js';
import { isPlayerTeeSelections } from './tees.js';

const warningCodes: readonly RoundReviewWarningCode[] = [
  'kp-review-required',
  'purse-review-required',
  'team-review-required',
  'churchy-review-required',
];

function isWarningCode(value: unknown): value is RoundReviewWarningCode {
  return typeof value === 'string' && (warningCodes as readonly string[]).includes(value);
}

function isWarning(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 2
    && isWarningCode(value.code) && boundedText(value.message, 240);
}

function isRoundGroup(value: unknown): boolean {
  return isRecord(value) && typeof value.number === 'number' && Number.isSafeInteger(value.number) && value.number > 0
    && (value.startingHole === undefined || typeof value.startingHole === 'number'
      && Number.isSafeInteger(value.startingHole) && value.startingHole >= 1 && value.startingHole <= 18)
    && Array.isArray(value.playerIds) && value.playerIds.length > 0 && value.playerIds.length <= 4
    && value.playerIds.every(isUuid) && new Set(value.playerIds).size === value.playerIds.length;
}

function isGameTeam(value: unknown): boolean {
  return isRecord(value) && isUuid(value.id) && boundedText(value.name)
    && Array.isArray(value.playerIds) && value.playerIds.length > 0
    && value.playerIds.every(isUuid) && new Set(value.playerIds).size === value.playerIds.length;
}

function isPlayer(value: unknown): value is RoundCorrectionPlayerInput {
  return isRecord(value) && Object.keys(value).length === 2
    && isUuid(value.playerId) && (value.handicapIndexValue === null || isHandicapIndex(value.handicapIndexValue));
}

function isTeams(value: unknown): value is RoundCorrectionGameTeamsInput {
  return isRecord(value) && Object.keys(value).length === 2
    && isUuid(value.gameId) && Array.isArray(value.teams) && value.teams.length > 0
    && value.teams.every(isGameTeam);
}

export function isRoundCorrectionInput(value: unknown): value is RoundCorrectionInput {
  return isRecord(value) && value.teeProfileId !== undefined
    && typeof value.teeProfileId === 'number' && Number.isSafeInteger(value.teeProfileId) && value.teeProfileId > 0
    && Array.isArray(value.groups) && value.groups.length > 0 && value.groups.every(isRoundGroup)
    && Array.isArray(value.players) && value.players.length > 0 && value.players.every(isPlayer)
    && new Set(value.players.map((entry: RoundCorrectionPlayerInput) => entry.playerId)).size === value.players.length
    && (value.playerTeeSelections === undefined || isPlayerTeeSelections(value.playerTeeSelections))
    && (value.gameTeams === undefined || Array.isArray(value.gameTeams) && value.gameTeams.every(isTeams)
      && new Set(value.gameTeams.map((entry: RoundCorrectionGameTeamsInput) => entry.gameId)).size === value.gameTeams.length);
}

function isExpected(value: unknown): boolean {
  return isRecord(value) && isEventRevision(value.eventEtag) && isEventRevision(value.roundEtag)
    && (value.gamesEtag === undefined || value.gamesEtag === null || isEventRevision(value.gamesEtag))
    && (value.inputRevision === undefined || value.inputRevision === null || isUuid(value.inputRevision));
}

export function isRoundCorrectionWriteRequest(value: unknown): value is RoundCorrectionWriteRequest {
  return isRecord(value) && Object.keys(value).every((key) =>
    ['expected', 'correction', 'reason', 'reviewSummary'].includes(key))
    && isExpected(value.expected) && isRoundCorrectionInput(value.correction)
    && boundedText(value.reason, 240)
    && (value.reviewSummary === undefined || boundedText(value.reviewSummary, 500));
}

export function isRoundCorrectionReadModel(value: unknown): value is RoundCorrectionReadModel {
  return isRecord(value) && isUuid(value.eventId) && isUuid(value.roundId)
    && isEventRevision(value.eventEtag) && isEventRevision(value.roundEtag)
    && (value.gamesEtag === undefined || value.gamesEtag === null || isEventRevision(value.gamesEtag))
    && (value.inputRevision === undefined || isUuid(value.inputRevision))
    && typeof value.allowPerGolferTees === 'boolean'
    && typeof value.teeProfileId === 'number' && Number.isSafeInteger(value.teeProfileId) && value.teeProfileId > 0
    && Array.isArray(value.compatibleTees) && value.compatibleTees.length > 0 && value.compatibleTees.every(isTeeProfile)
    && Array.isArray(value.players) && value.players.length > 0
    && value.players.every((entry: unknown) => isRecord(entry) && Object.keys(entry).length === 3
      && isUuid(entry.playerId) && boundedText(entry.displayName) && (entry.handicapIndex === null || isIndexObservation(entry.handicapIndex)))
    && Array.isArray(value.playerTeeSelections) && isPlayerTeeSelections(value.playerTeeSelections)
    && Array.isArray(value.groups) && value.groups.every(isRoundGroup)
    && Array.isArray(value.gameTeams) && value.gameTeams.every(isTeams)
    && Array.isArray(value.warnings) && value.warnings.every(isWarning);
}

export function isRoundCorrectionReceipt(value: unknown): value is RoundCorrectionReceipt {
  return isRecord(value) && isUuid(value.id) && isUuid(value.eventId) && isUuid(value.roundId)
    && isExpected(value.expected) && isRoundCorrectionInput(value.before) && isRoundCorrectionInput(value.after)
    && boundedText(value.reason, 240) && (value.reviewSummary === undefined || boundedText(value.reviewSummary, 500))
    && Array.isArray(value.warnings) && value.warnings.every(isWarning)
    && typeof value.recordedAt === 'string' && Number.isFinite(Date.parse(value.recordedAt))
    && isRecord(value.recordedBy) && isUuid(value.recordedBy.tenantId) && isUuid(value.recordedBy.objectId);
}

export function isRoundCorrectionWriteResult(value: unknown): value is RoundCorrectionWriteResult {
  return isRecord(value) && typeof value.applied === 'boolean'
    && (value.receiptId === undefined || isUuid(value.receiptId))
    && isRoundCorrectionReadModel(value.model);
}
