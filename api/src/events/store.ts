import { odata } from '@azure/data-tables';
import type { TableClient } from '@azure/data-tables';
import type { AccountIdentity, EventPage, EventSummary, GolfEvent } from '../../../src/domain/events.js';
import { isEventSummary, isRecord } from '../../../src/contracts/events.js';
import { ApiError } from '../errors.js';
import { isMissingTableEntity } from '../table-errors.js';

export interface EventStore {
  list(identity: AccountIdentity, continuationToken?: string): Promise<EventPage>;
  create(identity: AccountIdentity, event: GolfEvent): Promise<EventSummary>;
}

export class TableEventStore implements EventStore {
  constructor(private readonly table: TableClient) {}

  async list(identity: AccountIdentity, continuationToken?: string): Promise<EventPage> {
    const results: EventSummary[] = [];
    const pages = this.table.listEntities({ queryOptions: { filter: odata`RowKey eq ${'event'}` } })
      .byPage({ maxPageSize: 50, ...(continuationToken ? { continuationToken } : {}) });
    const next = await pages.next();
    if (next.done) return { events: [] };
    const page = next.value;
    for (const event of page) {
      if (typeof event.partitionKey !== 'string') throw new ApiError(503, 'INVALID_STORED_EVENT');
      let member;
      try {
        member = await this.table.getEntity(event.partitionKey, `member:${identity.objectId}`);
      } catch (error) {
        if (isMissingTableEntity(error)) continue;
        throw error;
      }
      if (member.tenantId !== identity.tenantId || member.objectId !== identity.objectId) continue;
      const summary = { id: event.partitionKey, name: event.name, createdAt: event.createdAt, role: member.role };
      if (!isEventSummary(summary)) throw new ApiError(503, 'INVALID_STORED_EVENT');
      results.push(summary);
    }
    return { events: results, ...(page.continuationToken ? { continuationToken: page.continuationToken } : {}) };
  }

  async create(identity: AccountIdentity, event: GolfEvent): Promise<EventSummary> {
    try {
      await this.table.submitTransaction([
        ['create', { partitionKey: event.id, rowKey: 'event', name: event.name, createdAt: event.createdAt, creatorTenantId: identity.tenantId, creatorObjectId: identity.objectId }],
        ['create', { partitionKey: event.id, rowKey: `member:${identity.objectId}`, tenantId: identity.tenantId, objectId: identity.objectId, role: 'owner' }],
      ]);
      return { ...event, role: 'owner' };
    } catch (error) {
      if (!isRecord(error) || error.statusCode !== 409) throw error;
      const existing = await this.table.getEntity(event.id, 'event');
      if (existing.creatorTenantId !== identity.tenantId || existing.creatorObjectId !== identity.objectId || existing.name !== event.name) {
        throw new ApiError(409, 'EVENT_REQUEST_CONFLICT');
      }
      let member;
      try { member = await this.table.getEntity(event.id, `member:${identity.objectId}`); }
      catch (membershipError) {
        if (isMissingTableEntity(membershipError)) throw new ApiError(403, 'EVENT_ACCESS_REVOKED');
        throw membershipError;
      }
      if (member.tenantId !== identity.tenantId || member.objectId !== identity.objectId) throw new ApiError(403, 'EVENT_ACCESS_REVOKED');
      const summary = { id: event.id, name: existing.name, createdAt: existing.createdAt, role: member.role };
      if (!isEventSummary(summary)) throw new ApiError(503, 'INVALID_STORED_EVENT');
      return summary;
    }
  }
}
