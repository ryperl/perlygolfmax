import type { EventSetupInput, EventWorkspace, OverallCompetition, RoundSnapshot } from '../domain/setup.js';
import {
  boundedText, isCourseId, isCourseMetadata, isIndexObservation, isTeeProfile, isVersionId,
} from './catalog.js';
import { isEventRevision, isEventStartDate, isEventSummary, isRecord, isUuid } from './events.js';
import { isPlayerTeeProfiles, isPlayerTeeSelections } from './tees.js';

export function isOverallCompetition(value: unknown): value is OverallCompetition {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (value.kind === 'stroke-play') {
    return value.basis === 'gross'
      ? keys.length === 2 && keys.every((key) => key === 'kind' || key === 'basis')
      : value.basis === 'net' && keys.length === 3
        && keys.every((key) => ['kind', 'basis', 'handicapAllowancePercent'].includes(key))
        && typeof value.handicapAllowancePercent === 'number' && Number.isSafeInteger(value.handicapAllowancePercent)
        && value.handicapAllowancePercent >= 1 && value.handicapAllowancePercent <= 100;
  }
  return value.kind === 'stableford' && keys.length === 3
    && keys.every((key) => ['kind', 'credit', 'roundGames'].includes(key))
    && (value.credit === 'individual' || value.credit === 'team')
    && Array.isArray(value.roundGames) && value.roundGames.length <= 8
    && value.roundGames.every((binding: unknown) => isRecord(binding) && Object.keys(binding).length === 2
      && Object.keys(binding).every((key) => key === 'roundId' || key === 'gameId')
      && isUuid(binding.roundId) && isUuid(binding.gameId))
    && new Set(value.roundGames.map((binding: { readonly roundId: string }) => binding.roundId)).size === value.roundGames.length;
}

function location(value: unknown): value is string {
  return value === '' || boundedText(value, 200);
}

export function isRoundTeeTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function groups(value: unknown, playerIds: readonly string[], layout?: readonly { readonly number: number }[]): boolean {
  if (!Array.isArray(value) || value.length < 1) return false;
  const roster = new Set(playerIds);
  const numbers = new Set<number>();
  const assigned: string[] = [];
  for (const group of value) {
    if (!isRecord(group) || typeof group.number !== 'number' || !Number.isSafeInteger(group.number) || group.number < 1
      || group.startingHole !== undefined && (typeof group.startingHole !== 'number'
        || !Number.isSafeInteger(group.startingHole) || group.startingHole < 1 || group.startingHole > 18
        || layout !== undefined && !layout.some((hole) => hole.number === group.startingHole))
      || !Array.isArray(group.playerIds) || group.playerIds.length < 1 || group.playerIds.length > 4) return false;
    const groupIds: unknown[] = group.playerIds;
    if (!groupIds.every((id): id is string => isUuid(id) && roster.has(id))) return false;
    numbers.add(group.number);
    assigned.push(...groupIds);
  }
  return numbers.size === value.length && assigned.length === playerIds.length
    && new Set(assigned).size === playerIds.length;
}

export function isEventSetupInput(value: unknown): value is EventSetupInput {
  if (!isRecord(value) || !boundedText(value.name) || !location(value.location)
    || value.startDate !== undefined && value.startDate !== '' && !isEventStartDate(value.startDate)
    || value.endDate !== undefined && value.endDate !== '' && !isEventStartDate(value.endDate)
    || typeof value.startDate === 'string' && value.startDate !== '' && typeof value.endDate === 'string'
      && value.endDate !== '' && value.endDate < value.startDate
    || value.allowPerGolferTees !== undefined && typeof value.allowPerGolferTees !== 'boolean'
    || value.overallCompetition !== undefined && value.overallCompetition !== null && !isOverallCompetition(value.overallCompetition)
    || !Array.isArray(value.playerIds) || value.playerIds.length < 1
    || !value.playerIds.every(isUuid) || new Set(value.playerIds).size !== value.playerIds.length
    || !Array.isArray(value.rounds) || value.rounds.length < 1 || value.rounds.length > 8) return false;
  const players: readonly string[] = value.playerIds;
  const roster = new Set(players);
  return value.rounds.every((round: unknown) => isRecord(round) && isUuid(round.id) && boundedText(round.name)
    && (round.teeTime === undefined || round.teeTime === '' || isRoundTeeTime(round.teeTime))
    && (round.startDate === undefined || round.startDate === '' || isEventStartDate(round.startDate))
    && isCourseId(round.courseId) && isVersionId(round.courseVersionId) && typeof round.teeProfileId === 'number'
    && Number.isSafeInteger(round.teeProfileId) && round.teeProfileId > 0 && groups(round.groups, players)
    && (round.playerTeeSelections === undefined || isPlayerTeeSelections(round.playerTeeSelections)
      && round.playerTeeSelections.every((entry) => roster.has(entry.playerId)
        && (value.allowPerGolferTees !== false || entry.teeProfileId === round.teeProfileId))))
    && new Set(value.rounds.map((round: Record<string, unknown>) => round.id)).size === value.rounds.length;
}

function isRoundSnapshot(value: unknown, playerIds: readonly string[]): value is RoundSnapshot {
  const roster = new Set(playerIds);
  return isRecord(value) && isUuid(value.id) && boundedText(value.name)
    && (value.teeTime === undefined || isRoundTeeTime(value.teeTime))
    && (value.startDate === undefined || isEventStartDate(value.startDate))
    && (value.scoringStarted === undefined || typeof value.scoringStarted === 'boolean')
    && isCourseId(value.courseId) && isVersionId(value.courseVersionId)
    && isCourseMetadata(value.course) && isTeeProfile(value.teeProfile)
    && (value.playerTees === undefined || isPlayerTeeProfiles(value.playerTees, value.teeProfile, playerIds))
    && groups(value.groups, playerIds, value.teeProfile.holes) && Array.isArray(value.players)
    && value.players.length === playerIds.length
    && value.players.every((player: unknown) => isRecord(player) && isUuid(player.playerId)
      && roster.has(player.playerId) && boundedText(player.displayName)
      && (player.handicapIndex === undefined || player.handicapIndex === null || isIndexObservation(player.handicapIndex)))
    && new Set(value.players.map((player: Record<string, unknown>) => player.playerId)).size === playerIds.length;
}

export function isEventWorkspace(value: unknown): value is EventWorkspace {
  if (!isRecord(value) || !isEventSummary(value.event) || !isEventRevision(value.etag)
    || value.purseConfigured !== undefined && typeof value.purseConfigured !== 'boolean'
    || value.event.status === 'archived' && value.event.role !== 'owner'
    || value.canViewScores !== undefined && typeof value.canViewScores !== 'boolean'
    || value.testerAccess !== undefined && (value.testerAccess !== true || value.event.role !== 'viewer'
      || value.event.status !== 'active' || value.canViewScores !== true || value.viewerPlayerId !== undefined)
    || value.publicAccess !== undefined && (value.publicAccess !== true || value.event.role !== 'viewer'
      || value.event.status !== 'active' || value.canViewScores !== true || value.viewerPlayerId !== undefined
      || value.testerAccess !== undefined)
    || value.viewerPlayerId !== undefined && !isUuid(value.viewerPlayerId)
    || value.allowPerGolferTees !== undefined && typeof value.allowPerGolferTees !== 'boolean'
    || value.overallCompetition !== undefined && !isOverallCompetition(value.overallCompetition)
    || !location(value.location) || !Array.isArray(value.roster)
    || !value.roster.every((player: unknown) => isRecord(player) && isUuid(player.playerId) && boundedText(player.displayName))
    || !Array.isArray(value.rounds) || value.rounds.length > 8) return false;
  const ids = value.roster.map((player: { readonly playerId: string }) => player.playerId);
  return value.etag === value.event.etag && new Set(ids).size === ids.length
    && (value.viewerPlayerId === undefined || ids.includes(value.viewerPlayerId))
    && (value.rounds.length === 0 || ids.length >= 1)
    && value.rounds.every((round: unknown) => isRoundSnapshot(round, ids))
    && (value.allowPerGolferTees === true || value.rounds.every((round: RoundSnapshot) => !round.playerTees?.length))
    && new Set(value.rounds.map((round: RoundSnapshot) => round.id)).size === value.rounds.length
    && (value.event.role === 'owner' || value.rounds.every((round: RoundSnapshot) =>
      round.players.every((player) => player.handicapIndex === undefined)));
}
