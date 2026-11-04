import type { EventSetupInput, EventWorkspace, RoundSnapshot } from '../domain/setup.js';
import {
  boundedText, isCourseId, isCourseMetadata, isIndexObservation, isTeeProfile, isVersionId,
} from './catalog.js';
import { isEventRevision, isEventSummary, isRecord, isUuid } from './events.js';

function location(value: unknown): value is string {
  return value === '' || boundedText(value, 200);
}

function groups(value: unknown, playerIds: readonly string[]): boolean {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return false;
  const numbers = new Set<number>();
  const assigned: string[] = [];
  for (const group of value) {
    if (!isRecord(group) || typeof group.number !== 'number' || ![1, 2, 3, 4].includes(group.number)
      || !Array.isArray(group.playerIds) || group.playerIds.length < 1 || group.playerIds.length > 4) return false;
    const groupIds: unknown[] = group.playerIds;
    if (!groupIds.every((id): id is string => isUuid(id) && playerIds.includes(id))) return false;
    numbers.add(group.number);
    assigned.push(...groupIds);
  }
  return numbers.size === value.length && assigned.length === playerIds.length
    && new Set(assigned).size === playerIds.length;
}

export function isEventSetupInput(value: unknown): value is EventSetupInput {
  if (!isRecord(value) || !boundedText(value.name) || !location(value.location)
    || !Array.isArray(value.playerIds) || value.playerIds.length < 4 || value.playerIds.length > 8
    || !value.playerIds.every(isUuid) || new Set(value.playerIds).size !== value.playerIds.length
    || !Array.isArray(value.rounds) || value.rounds.length < 1 || value.rounds.length > 8) return false;
  const players: readonly string[] = value.playerIds;
  return value.rounds.every((round: unknown) => isRecord(round) && isUuid(round.id) && boundedText(round.name)
    && isCourseId(round.courseId) && isVersionId(round.courseVersionId) && typeof round.teeProfileId === 'number'
    && Number.isSafeInteger(round.teeProfileId) && round.teeProfileId > 0 && groups(round.groups, players))
    && new Set(value.rounds.map((round: Record<string, unknown>) => round.id)).size === value.rounds.length;
}

function isRoundSnapshot(value: unknown, playerIds: readonly string[]): value is RoundSnapshot {
  return isRecord(value) && isUuid(value.id) && boundedText(value.name)
    && isCourseId(value.courseId) && isVersionId(value.courseVersionId)
    && isCourseMetadata(value.course) && isTeeProfile(value.teeProfile)
    && groups(value.groups, playerIds) && Array.isArray(value.players)
    && value.players.length === playerIds.length
    && value.players.every((player: unknown) => isRecord(player) && isUuid(player.playerId)
      && playerIds.includes(player.playerId) && boundedText(player.displayName)
      && (player.handicapIndex === undefined || player.handicapIndex === null || isIndexObservation(player.handicapIndex)))
    && new Set(value.players.map((player: Record<string, unknown>) => player.playerId)).size === playerIds.length;
}

export function isEventWorkspace(value: unknown): value is EventWorkspace {
  if (!isRecord(value) || !isEventSummary(value.event) || !isEventRevision(value.etag)
    || !location(value.location) || !Array.isArray(value.roster) || value.roster.length > 8
    || !value.roster.every((player: unknown) => isRecord(player) && isUuid(player.playerId) && boundedText(player.displayName))
    || !Array.isArray(value.rounds) || value.rounds.length > 8) return false;
  const ids = value.roster.map((player: { readonly playerId: string }) => player.playerId);
  return value.etag === value.event.etag && new Set(ids).size === ids.length
    && (value.rounds.length === 0 || ids.length >= 4)
    && value.rounds.every((round: unknown) => isRoundSnapshot(round, ids))
    && new Set(value.rounds.map((round: RoundSnapshot) => round.id)).size === value.rounds.length
    && (value.event.role === 'owner' || value.rounds.every((round: RoundSnapshot) =>
      round.players.every((player) => player.handicapIndex === undefined)));
}
