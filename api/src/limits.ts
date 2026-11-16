import type { TableClient } from '@azure/data-tables';
import { setTimeout as delay } from 'node:timers/promises';
import type { ScoreActor } from '../../src/domain/test-access.js';
import type { PublicBrowseIdentity } from '../../src/domain/public-access.js';
import { isPublicBrowseIdentity } from '../../src/contracts/public-access.js';
import { isScoreActor } from '../../src/contracts/scoring.js';
import { isRecord } from '../../src/contracts/events.js';
import { ApiError } from './errors.js';
import { isMissingTableEntity } from './table-errors.js';

export type RequestClass = 'identity-read' | 'events-read' | 'events-create' | 'events-manage'
  | 'catalog-read' | 'catalog-write' | 'setup-read' | 'setup-write' | 'scores-read' | 'scores-write';
const limits: Readonly<Record<RequestClass, number>> = {
  'identity-read': 20, 'events-read': 60, 'events-create': 10, 'events-manage': 10,
  'catalog-read': 60, 'catalog-write': 60, 'setup-read': 60, 'setup-write': 30,
  'scores-read': 600, 'scores-write': 60,
};
const sharedPublicReadLimits: Readonly<Partial<Record<RequestClass, number>>> = {
  'events-read': 240, 'setup-read': 240,
};

export interface RequestLimiter {
  check(identity: ScoreActor | PublicBrowseIdentity, action: RequestClass, units?: number): Promise<void>;
}

export class TableRequestLimiter implements RequestLimiter {
  constructor(private readonly table: TableClient, private readonly now: () => number = Date.now) {}

  async check(identity: ScoreActor | PublicBrowseIdentity, action: RequestClass, units = 1): Promise<void> {
    if (!isScoreActor(identity) && !isPublicBrowseIdentity(identity)) throw new ApiError(503, 'INVALID_REQUEST_PRINCIPAL');
    const partitionKey = 'kind' in identity
      ? identity.kind === 'public-browse' ? 'quota:public-browse'
        : identity.kind === 'public-score' ? `quota:public-score:${identity.eventId}`
          : `quota:tester-link:${identity.eventId}:${identity.linkId}`
      : `quota:${identity.tenantId}:${identity.objectId}`;
    const rowKey = action;
    const limit = 'kind' in identity && (identity.kind === 'public-browse' || identity.kind === 'public-score')
      ? sharedPublicReadLimits[action] ?? limits[action] : limits[action];
    if (!Number.isSafeInteger(units) || units < 1 || units > limit) throw new ApiError(503, 'INVALID_REQUEST_QUOTA_COST');
    for (let attempt = 0; attempt < 16; attempt++) {
      try {
        let current;
        try {
          current = await this.table.getEntity(partitionKey, rowKey);
        } catch (error) {
          if (!isMissingTableEntity(error)) throw error;
          await this.table.createEntity({ partitionKey, rowKey, window: Math.floor(this.now() / 60_000), count: units });
          return;
        }
        if (typeof current.window !== 'number' || !Number.isSafeInteger(current.window) || current.window < 0
          || typeof current.count !== 'number'
          || !Number.isSafeInteger(current.count) || current.count < 0 || !current.etag) {
          throw new ApiError(503, 'INVALID_REQUEST_QUOTA');
        }
        const window = Math.max(current.window, Math.floor(this.now() / 60_000));
        if (current.window === window && units > limit - current.count) throw new ApiError(429, 'REQUEST_LIMIT_EXCEEDED');
        const count = current.window === window ? current.count + units : units;
        await this.table.updateEntity({ partitionKey, rowKey, window, count }, 'Replace', { etag: current.etag });
        return;
      } catch (error) {
        if (isRecord(error) && (error.statusCode === 409 || error.statusCode === 412)) {
          // Desynchronize competing instances instead of exhausting retries in lockstep.
          if (attempt < 15) await delay(25 + Math.floor(Math.random() * Math.min(500, 25 * 2 ** attempt)));
          continue;
        }
        throw error;
      }
    }
    throw new ApiError(429, 'REQUEST_LIMIT_CONTENTION');
  }
}
