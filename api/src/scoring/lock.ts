import type { TableClient } from '@azure/data-tables';
import type { ScoreActor } from '../../../src/domain/test-access.js';
import { scoreActor } from '../../../src/domain/scoring.js';
import { isScoreActor } from '../../../src/contracts/scoring.js';
import { isRecord, isUuid } from '../../../src/contracts/events.js';
import { decode, optionalRow, revision } from '../catalog/entities.js';
import { ApiError } from '../errors.js';
import { privateContent } from '../private-values.js';

export interface ScoringLock {
  readonly kind: 'score-lock';
  readonly eventId: string;
  readonly roundId: string;
  readonly requestId: string;
  readonly startedAt: string;
  readonly startedBy: ScoreActor;
  readonly writtenPlayerIds: readonly string[];
}

function isScoringLock(value: unknown): value is ScoringLock {
  return isRecord(value) && value.kind === 'score-lock'
    && isUuid(value.eventId) && isUuid(value.roundId) && isUuid(value.requestId)
    && typeof value.startedAt === 'string' && value.startedAt.length <= 40 && Number.isFinite(Date.parse(value.startedAt))
    && isScoreActor(value.startedBy) && (!('kind' in value.startedBy) || value.startedBy.eventId === value.eventId)
    && Array.isArray(value.writtenPlayerIds) && value.writtenPlayerIds.length >= 1
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
  const lock = decode(await privateContent(table, eventId, `score-lock:${roundId}`, row.content), isScoringLock);
  if (lock.eventId !== eventId || lock.roundId !== roundId) throw new ApiError(503, 'INVALID_STORED_SCORE_LOCK');
  return {
    kind: lock.kind, eventId: lock.eventId, roundId: lock.roundId, requestId: lock.requestId,
    startedAt: lock.startedAt, startedBy: scoreActor(lock.startedBy),
    writtenPlayerIds: [...lock.writtenPlayerIds], etag: revision(row),
  };
}
