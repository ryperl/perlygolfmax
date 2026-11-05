import type { AccountIdentity } from '../../../src/domain/events.js';
import type { IndexObservation } from '../../../src/domain/catalog.js';
import { isIndexObservation } from '../../../src/contracts/catalog.js';
import { isEventRevision, isRecord, isUuid } from '../../../src/contracts/events.js';

export interface CapturedIndexInput {
  readonly playerId: string;
  readonly handicapIndex: IndexObservation | null;
}

export interface IndexRefreshAudit {
  readonly eventId: string;
  readonly roundId: string;
  readonly requestId: string;
  readonly expectedEtag: string;
  readonly recordedAt: string;
  readonly recordedBy: AccountIdentity;
  readonly previous: readonly CapturedIndexInput[];
  readonly updated: readonly CapturedIndexInput[];
}

function isCapturedInputs(value: unknown): value is readonly CapturedIndexInput[] {
  if (!Array.isArray(value) || value.length < 1) return false;
  const inputs: unknown[] = value;
  return inputs.every((entry): entry is CapturedIndexInput => isRecord(entry) && isUuid(entry.playerId)
    && (entry.handicapIndex === null || isIndexObservation(entry.handicapIndex)))
    && new Set(inputs.map((entry) => entry.playerId)).size === inputs.length;
}

export function isIndexRefreshAudit(value: unknown): value is IndexRefreshAudit {
  if (!isRecord(value) || !isUuid(value.eventId) || !isUuid(value.roundId) || !isUuid(value.requestId)
    || !isEventRevision(value.expectedEtag) || typeof value.recordedAt !== 'string' || value.recordedAt.length > 40
    || !Number.isFinite(Date.parse(value.recordedAt)) || !isRecord(value.recordedBy)
    || !isUuid(value.recordedBy.tenantId) || !isUuid(value.recordedBy.objectId)
    || !isCapturedInputs(value.previous) || !isCapturedInputs(value.updated)) return false;
  const updated = value.updated;
  const ids = new Set(updated.map((entry) => entry.playerId));
  return value.previous.length === updated.length
    && value.previous.every((entry) => ids.has(entry.playerId));
}
