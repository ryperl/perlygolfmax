import { odata } from '@azure/data-tables';
import type { TableClient, TableEntityResult } from '@azure/data-tables';
import type { AccountIdentity, EventPage, EventStatus, EventSummary, GolfEvent } from '../../../src/domain/events.js';
import { isEventRevision, isEventSummary, isRecord } from '../../../src/contracts/events.js';
import { ApiError } from '../errors.js';
import { isMissingTableEntity } from '../table-errors.js';
import { assertEventAccessUnchanged, readEventAccess } from '../event-access.js';

export interface EventStore {
  list(identity: AccountIdentity, continuationToken?: string, status?: EventStatus): Promise<EventPage>;
  create(identity: AccountIdentity, event: GolfEvent): Promise<EventSummary>;
  setStatus(identity: AccountIdentity, id: string, status: EventStatus, etag: string): Promise<EventSummary>;
}

function summary(id: string, event: Readonly<Record<string, unknown>>, membership: Readonly<Record<string, unknown>>): EventSummary {
  const result = {
    id, name: event.name, createdAt: event.createdAt, role: membership.role,
    ...(event.startDate === undefined || event.startDate === '' ? {} : { startDate: event.startDate }),
    status: event.status === undefined ? 'active' : event.status, etag: event.etag,
  };
  if (!isEventSummary(result)) throw new ApiError(503, 'INVALID_STORED_EVENT');
  return result;
}

export class TableEventStore implements EventStore {
  constructor(private readonly table: TableClient) {}

  private async membership(identity: AccountIdentity, id: string): Promise<TableEntityResult<Record<string, unknown>> | undefined> {
    try {
      const member = await this.table.getEntity(id, `member:${identity.objectId}`);
      return member.tenantId === identity.tenantId && member.objectId === identity.objectId
        && (member.revoked === undefined || member.revoked === false) ? member : undefined;
    } catch (error) {
      if (isMissingTableEntity(error)) return undefined;
      throw error;
    }
  }

  async list(identity: AccountIdentity, continuationToken?: string, status: EventStatus = 'active'): Promise<EventPage> {
    const results: EventSummary[] = [];
    const pages = this.table.listEntities({ queryOptions: { filter: odata`RowKey eq ${'event'}` } })
      .byPage({ maxPageSize: 50, ...(continuationToken ? { continuationToken } : {}) });
    const next = await pages.next();
    if (next.done) return { events: [] };
    const page = next.value;
    for (const event of page) {
      if (typeof event.partitionKey !== 'string') throw new ApiError(503, 'INVALID_STORED_EVENT');
      try {
        const access = await readEventAccess(this.table, identity, event.partitionKey);
        const item = access.summary;
        if (item.status === status && (status === 'active' || item.role === 'owner')) {
          await assertEventAccessUnchanged(this.table, identity, event.partitionKey, access);
          results.push(item);
        }
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
      }
    }
    return { events: results, ...(page.continuationToken ? { continuationToken: page.continuationToken } : {}) };
  }

  async create(identity: AccountIdentity, event: GolfEvent): Promise<EventSummary> {
    try {
      await this.table.submitTransaction([
        ['create', { partitionKey: event.id, rowKey: 'event', name: event.name, createdAt: event.createdAt, status: 'active', creatorTenantId: identity.tenantId, creatorObjectId: identity.objectId }],
        ['create', { partitionKey: event.id, rowKey: `member:${identity.objectId}`, tenantId: identity.tenantId, objectId: identity.objectId, role: 'owner' }],
      ]);
    } catch (error) {
      if (!isRecord(error) || error.statusCode !== 409) throw error;
    }
    const stored = await this.table.getEntity(event.id, 'event');
    if (stored.creatorTenantId !== identity.tenantId || stored.creatorObjectId !== identity.objectId || stored.name !== event.name) {
      throw new ApiError(409, 'EVENT_REQUEST_CONFLICT');
    }
    const member = await this.membership(identity, event.id);
    if (!member) throw new ApiError(403, 'EVENT_ACCESS_REVOKED');
    return summary(event.id, stored, member);
  }

  async setStatus(identity: AccountIdentity, id: string, status: EventStatus, etag: string): Promise<EventSummary> {
    const member = await this.membership(identity, id);
    if (!member) throw new ApiError(404, 'EVENT_NOT_FOUND');
    if (member.role !== 'owner') throw new ApiError(403, 'EVENT_MANAGEMENT_FORBIDDEN');
    if (!isEventRevision(member.etag)) throw new ApiError(503, 'INVALID_STORED_EVENT');
    let stored;
    try { stored = await this.table.getEntity(id, 'event'); }
    catch (error) {
      if (isMissingTableEntity(error)) throw new ApiError(404, 'EVENT_NOT_FOUND');
      throw error;
    }
    const current = summary(id, stored, member);
    if (current.etag !== etag) throw new ApiError(409, 'EVENT_CHANGED');
    if (current.status === status) return current;
    try {
      // Check the owner grant and event revision together; neither may change mid-write.
      await this.table.submitTransaction([
        ['update', { partitionKey: id, rowKey: 'event', status }, 'Merge', { etag }],
        ['update', { partitionKey: id, rowKey: `member:${identity.objectId}`, tenantId: identity.tenantId, objectId: identity.objectId, role: 'owner' }, 'Merge', { etag: member.etag }],
      ]);
      const updated = await this.table.getEntity(id, 'event');
      const owner = await this.membership(identity, id);
      if (!owner || owner.role !== 'owner') throw new ApiError(403, 'EVENT_MANAGEMENT_FORBIDDEN');
      const result = summary(id, updated, owner);
      if (result.status !== status) throw new ApiError(409, 'EVENT_CHANGED');
      return result;
    } catch (error) {
      if (isRecord(error) && (error.statusCode === 412 || error.statusCode === 404 && isMissingTableEntity(error))) {
        throw new ApiError(409, 'EVENT_CHANGED');
      }
      throw error;
    }
  }
}
