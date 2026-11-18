import type { TableClient } from '@azure/data-tables';
import type { AccountIdentity } from '../../../src/domain/events.js';
import type { EventHandicapRefreshResult } from '../../../src/domain/player-handicap-update.js';
import type { RoundCorrectionReceipt } from '../../../src/domain/round-corrections.js';
import type { RoundSnapshot } from '../../../src/domain/setup.js';
import { isIndexObservation } from '../../../src/contracts/catalog.js';
import { isEventRevision, isRecord, isUuid } from '../../../src/contracts/events.js';
import { isEventHandicapRefreshResult } from '../../../src/contracts/player-handicap-update.js';
import { isRoundCorrectionReceipt } from '../../../src/contracts/round-corrections.js';
import { isScoreActor } from '../../../src/contracts/scoring.js';
import { sameScoreActor } from '../../../src/domain/scoring.js';
import { canonical, decode, isConflict, optionalRow, revision } from '../catalog/entities.js';
import { ApiError } from '../errors.js';
import { privateContent } from '../private-values.js';
import type { StoredScoringLock } from '../scoring/lock.js';
import { createEventOwnedEntity } from '../event-administration/writes.js';

export interface PlayerIndexRefreshReceipt {
  readonly id: string;
  readonly eventId: string;
  readonly playerId: string;
  readonly observationId: string;
  readonly expectedEtag: string;
  readonly recordedAt: string;
  readonly recordedBy: AccountIdentity;
  readonly updatedRoundIds: readonly string[];
  readonly completedRoundIds: readonly string[];
  readonly corrections: readonly RoundCorrectionReceipt[];
}

export const playerIndexRefreshKey = (id: string) => `player-index-refresh:${id}`;

function isReceipt(value: unknown): value is PlayerIndexRefreshReceipt {
  return isRecord(value) && isUuid(value.id) && isUuid(value.observationId) && isEventRevision(value.expectedEtag)
    && isEventHandicapRefreshResult({ eventId: value.eventId, playerId: value.playerId, etag: value.expectedEtag,
      updatedRoundIds: value.updatedRoundIds, completedRoundIds: value.completedRoundIds })
    && typeof value.recordedAt === 'string' && Number.isFinite(Date.parse(value.recordedAt))
    && isRecord(value.recordedBy) && isUuid(value.recordedBy.tenantId) && isUuid(value.recordedBy.objectId)
    && Array.isArray(value.updatedRoundIds) && Array.isArray(value.corrections)
    && value.corrections.every(isRoundCorrectionReceipt)
    && value.corrections.length === value.updatedRoundIds.length
    && value.corrections.every((entry, index) => entry.eventId === value.eventId && entry.id === value.id
      && Array.isArray(value.updatedRoundIds) && entry.roundId === value.updatedRoundIds[index]);
}

export async function playerIndexRefreshReplay(
  table: TableClient, identity: AccountIdentity, eventId: string, playerId: string,
  observationId: string, etag: string, requestId: string,
): Promise<PlayerIndexRefreshReceipt | undefined> {
  const key = playerIndexRefreshKey(requestId);
  const row = await optionalRow(table, eventId, key);
  if (!row) return undefined;
  const receipt = decode(await privateContent(table, eventId, key, row.content), isReceipt);
  if (row.kind !== 'player-index-refresh' || receipt.id !== requestId || receipt.eventId !== eventId
    || receipt.playerId !== playerId || receipt.observationId !== observationId || receipt.expectedEtag !== etag
    || receipt.recordedBy.tenantId !== identity.tenantId || receipt.recordedBy.objectId !== identity.objectId) {
    throw new ApiError(409, 'PLAYER_INDEX_REFRESH_REQUEST_CONFLICT');
  }
  return receipt;
}

/** Azure assigns the event ETag at commit; persist the first acknowledgement separately, never reapply the mutation. */
export async function acknowledgePlayerIndexRefresh(
  table: TableClient, receipt: PlayerIndexRefreshReceipt,
): Promise<EventHandicapRefreshResult> {
  const key = `${playerIndexRefreshKey(receipt.id)}:ack`;
  const read = async (): Promise<EventHandicapRefreshResult | undefined> => {
    const row = await optionalRow(table, receipt.eventId, key);
    if (!row) return undefined;
    const result = decode(row.content, isEventHandicapRefreshResult);
    if (row.kind !== 'player-index-refresh-ack' || result.eventId !== receipt.eventId || result.playerId !== receipt.playerId
      || canonical(result.updatedRoundIds) !== canonical(receipt.updatedRoundIds)
      || canonical(result.completedRoundIds) !== canonical(receipt.completedRoundIds)) {
      throw new ApiError(503, 'INVALID_PLAYER_INDEX_REFRESH');
    }
    return result;
  };
  const previous = await read();
  if (previous) return previous;
  const event = await optionalRow(table, receipt.eventId, 'event');
  if (!event) throw new ApiError(503, 'INVALID_STORED_EVENT');
  const result: EventHandicapRefreshResult = { eventId: receipt.eventId, playerId: receipt.playerId, etag: revision(event),
    updatedRoundIds: receipt.updatedRoundIds, completedRoundIds: receipt.completedRoundIds };
  try {
    await createEventOwnedEntity(table, receipt.eventId, {
      partitionKey: receipt.eventId, rowKey: key, kind: 'player-index-refresh-ack', content: canonical(result),
    });
  } catch (error) {
    const committed = await read();
    if (committed) return committed;
    if (isConflict(error)) throw new ApiError(409, 'PLAYER_INDEX_REFRESH_REQUEST_CONFLICT');
    throw error;
  }
  return result;
}

export async function validateRefreshCapture(
  table: TableClient, eventId: string, round: RoundSnapshot, lock: StoredScoringLock,
): Promise<void> {
  const key = `index-capture:${round.id}`;
  const row = await optionalRow(table, eventId, key);
  if (!row) throw new ApiError(503, 'INVALID_STORED_INDEX_CAPTURE');
  const capture = decode(await privateContent(table, eventId, key, row.content), isRecord);
  if (capture.kind !== 'index-capture' || capture.version !== 1 || capture.eventId !== eventId || capture.roundId !== round.id
    || capture.requestId !== lock.requestId || capture.recordedAt !== lock.startedAt || !isScoreActor(capture.recordedBy)
    || !sameScoreActor(capture.recordedBy, lock.startedBy)
    || !Array.isArray(capture.players) || capture.players.length !== round.players.length
    || !capture.players.every((entry: unknown) => isRecord(entry) && isUuid(entry.playerId)
      && (entry.handicapIndex === null || isIndexObservation(entry.handicapIndex)))
    || canonical(capture.players.map((entry: { playerId: string }) => entry.playerId).sort())
      !== canonical(round.players.map((entry) => entry.playerId).sort())) {
    throw new ApiError(503, 'INVALID_STORED_INDEX_CAPTURE');
  }
}
