import type { TableClient } from '@azure/data-tables';
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
  'scores-read': 60, 'scores-write': 60,
};

export interface RequestLimiter {
  check(identity: ScoreActor | PublicBrowseIdentity, action: RequestClass): Promise<void>;
}

export class TableRequestLimiter implements RequestLimiter {
  constructor(private readonly table: TableClient, private readonly now: () => number = Date.now) {}

  async check(identity: ScoreActor | PublicBrowseIdentity, action: RequestClass): Promise<void> {
    if (!isScoreActor(identity) && !isPublicBrowseIdentity(identity)) throw new ApiError(503, 'INVALID_REQUEST_PRINCIPAL');
    const partitionKey = 'kind' in identity
      ? identity.kind === 'public-browse' ? 'quota:public-browse'
        : identity.kind === 'public-score' ? `quota:public-score:${identity.eventId}`
          : `quota:tester-link:${identity.eventId}:${identity.linkId}`
      : `quota:${identity.tenantId}:${identity.objectId}`;
    const rowKey = action;
    const window = Math.floor(this.now() / 60_000);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        let current;
        try {
          current = await this.table.getEntity(partitionKey, rowKey);
        } catch (error) {
          if (!isMissingTableEntity(error)) throw error;
          await this.table.createEntity({ partitionKey, rowKey, window, count: 1 });
          return;
        }
        if (typeof current.window !== 'number' || !Number.isSafeInteger(current.window) || current.window < 0
          || typeof current.count !== 'number'
          || !Number.isSafeInteger(current.count) || current.count < 0 || !current.etag) {
          throw new ApiError(503, 'INVALID_REQUEST_QUOTA');
        }
        if (current.window === window && current.count >= limits[action]) throw new ApiError(429, 'REQUEST_LIMIT_EXCEEDED');
        const count = current.window === window ? current.count + 1 : 1;
        await this.table.updateEntity({ partitionKey, rowKey, window, count }, 'Replace', { etag: current.etag });
        return;
      } catch (error) {
        if (isRecord(error) && (error.statusCode === 409 || error.statusCode === 412)) continue;
        throw error;
      }
    }
    throw new ApiError(429, 'REQUEST_LIMIT_EXCEEDED');
  }
}
