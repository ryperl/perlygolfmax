import { odata } from '@azure/data-tables';
import type { TableClient } from '@azure/data-tables';
import type { EventPage } from '../../../src/domain/events.js';
import type { PublicBrowseIdentity } from '../../../src/domain/public-access.js';
import { isPublicBrowseIdentity } from '../../../src/contracts/public-access.js';
import { isUuid } from '../../../src/contracts/events.js';
import { page } from '../catalog/entities.js';
import { assertEventAccessUnchanged } from '../event-access.js';
import type { EventAccess } from '../event-access.js';
import { ApiError } from '../errors.js';
import { readPublicAccess } from './authority.js';

export class TablePublicEventStore {
  constructor(private readonly table: TableClient) {}

  async list(identity: PublicBrowseIdentity, continuationToken?: string): Promise<EventPage> {
    if (!isPublicBrowseIdentity(identity)) throw new ApiError(403, 'PUBLIC_EVENT_NOT_AVAILABLE');
    const result = await page(this.table, odata`RowKey eq ${'event'}`, continuationToken);
    const active: EventAccess[] = [];
    for (const row of result.rows) {
      if (!isUuid(row.partitionKey)) throw new ApiError(503, 'INVALID_STORED_EVENT');
      try {
        active.push(await readPublicAccess(this.table, { kind: 'public-score', eventId: row.partitionKey }, row.partitionKey));
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'PUBLIC_EVENT_NOT_AVAILABLE') throw error;
      }
    }
    for (const access of active) {
      await assertEventAccessUnchanged(this.table, { kind: 'public-score', eventId: access.summary.id }, access.summary.id, access);
    }
    return { events: active.map((access) => access.summary),
      ...(result.continuationToken ? { continuationToken: result.continuationToken } : {}) };
  }
}
