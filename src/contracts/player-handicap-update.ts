import type { EventHandicapRefreshResult } from '../domain/player-handicap-update.js';
import { isEventRevision, isRecord, isUuid } from './events.js';

export function isEventHandicapRefreshResult(value: unknown): value is EventHandicapRefreshResult {
  return isRecord(value) && Object.keys(value).length === 5
    && isUuid(value.eventId) && isUuid(value.playerId) && isEventRevision(value.etag)
    && Array.isArray(value.updatedRoundIds) && value.updatedRoundIds.every(isUuid)
    && Array.isArray(value.completedRoundIds) && value.completedRoundIds.every(isUuid)
    && new Set([...value.updatedRoundIds, ...value.completedRoundIds]).size
      === value.updatedRoundIds.length + value.completedRoundIds.length
    && value.updatedRoundIds.length + value.completedRoundIds.length <= 8;
}
