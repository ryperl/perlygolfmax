import type { TableClient } from '@azure/data-tables';
import type { AccountIdentity } from '../../../src/domain/events.js';
import { isRecord, isUuid } from '../../../src/contracts/events.js';
import { decode, optionalRow, revision } from '../catalog/entities.js';
import { ApiError } from '../errors.js';

export interface ScoringLock {
  readonly kind: 'score-lock';
  readonly eventId: string;
  readonly roundId: string;
  readonly requestId: string;
  readonly startedAt: string;
  readonly startedBy: AccountIdentity;
  readonly writtenPlayerIds: readonly string[];
}

function isScoringLock(value: unknown): value is ScoringLock {
  return isRecord(value) && value.kind === 'score-lock'
    && isUuid(value.eventId) && isUuid(value.roundId) && isUuid(value.requestId)
    && typeof value.startedAt === 'string' && value.startedAt.length <= 40 && Number.isFinite(Date.parse(value.startedAt))
    && isRecord(value.startedBy) && isUuid(value.startedBy.tenantId) && isUuid(value.startedBy.objectId)
    && Array.isArray(value.writtenPlayerIds) && value.writtenPlayerIds.length >= 1 && value.writtenPlayerIds.length <= 8
    && value.writtenPlayerIds.every(isUuid) && new Set(value.writtenPlayerIds).size === value.writtenPlayerIds.length;
}

export type StoredScoringLock = ScoringLock & { readonly etag: string };

export async function scoringLock(table: TableClient, eventId: string, roundId: string): Promise<StoredScoringLock | undefined> {
  if (!isUuid(eventId) || !isUuid(roundId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
  const row = await optionalRow(table, eventId, `score-lock:${roundId}`);
  if (!row) {
    const prefix = `score-card:${roundId}`;
    const evidence = await table.listEntities({
      queryOptions: { filter: `PartitionKey eq '${eventId}' and RowKey ge '${prefix}:' and RowKey lt '${prefix};'` },
    }).byPage({ maxPageSize: 1 }).next();
    // An empty partial page is not proof of absence. Never reinterpret persisted scoring as unlocked setup.
    if (!evidence.done && (evidence.value.length > 0 || evidence.value.continuationToken)) {
      throw new ApiError(503, 'INVALID_STORED_SCORE_LOCK');
    }
    return undefined;
  }
  const lock = decode(row.content, isScoringLock);
  if (lock.eventId !== eventId || lock.roundId !== roundId) throw new ApiError(503, 'INVALID_STORED_SCORE_LOCK');
  return {
    kind: lock.kind, eventId: lock.eventId, roundId: lock.roundId, requestId: lock.requestId,
    startedAt: lock.startedAt, startedBy: { tenantId: lock.startedBy.tenantId, objectId: lock.startedBy.objectId },
    writtenPlayerIds: [...lock.writtenPlayerIds], etag: revision(row),
  };
}
