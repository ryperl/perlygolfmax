import type { TeeProfile } from '../domain/catalog.js';
import type { PlayerTeeProfile, PlayerTeeSelection } from '../domain/tees.js';
import { compatibleTeeLayouts } from '../domain/tees.js';
import { isTeeProfile } from './catalog.js';
import { isRecord, isUuid } from './events.js';

export function isPlayerTeeSelections(value: unknown): value is readonly PlayerTeeSelection[] {
  return Array.isArray(value) && value.every((entry: unknown) => isRecord(entry)
    && Object.keys(entry).length === 2 && isUuid(entry.playerId)
    && typeof entry.teeProfileId === 'number' && Number.isSafeInteger(entry.teeProfileId) && entry.teeProfileId > 0)
    && new Set(value.map((entry: PlayerTeeSelection) => entry.playerId)).size === value.length;
}

export function isPlayerTeeProfiles(
  value: unknown, common: Pick<TeeProfile, 'holeCount' | 'holes'>, playerIds: readonly string[],
): value is readonly PlayerTeeProfile[] {
  const players = new Set(playerIds);
  return Array.isArray(value) && value.every((entry: unknown) => isRecord(entry)
    && Object.keys(entry).length === 2 && isUuid(entry.playerId) && players.has(entry.playerId)
    && isTeeProfile(entry.profile) && compatibleTeeLayouts(common, entry.profile))
    && new Set(value.map((entry: PlayerTeeProfile) => entry.playerId)).size === value.length;
}
