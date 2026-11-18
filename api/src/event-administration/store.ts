import { odata } from '@azure/data-tables';
import type { TableClient, TransactionAction } from '@azure/data-tables';
import type { AccountIdentity, EventStatus } from '../../../src/domain/events.js';
import type {
  AdministrableEvent, EventDeletionPage, EventDeletionResult, EventRestoreResult, QuickRoundAdministrationPage,
} from '../../../src/domain/event-administration.js';
import { isAdministrableEvent } from '../../../src/contracts/event-administration.js';
import { isUuid } from '../../../src/contracts/events.js';
import { canonical, digest, optionalRow, page, revision, transaction } from '../catalog/entities.js';
import type { StoredRow } from '../catalog/entities.js';
import { admissionIndexKey, admissionIndexPartition, readEventAccess, requireEventOwner } from '../event-access.js';
import { ApiError } from '../errors.js';
import { decodeAdministrationCursor, encodeAdministrationCursor } from './cursor.js';

const fenceKey = 'event-write-fence';
const validPhases = ['admissions', 'locators', 'rows', 'done'] as const;
type Phase = typeof validPhases[number];

function eventSummary(eventId: string, row: StoredRow): AdministrableEvent {
  const value = { id: eventId, name: row.name, status: row.status, etag: revision(row) };
  if (!isAdministrableEvent(value)) throw new ApiError(503, 'INVALID_STORED_EVENT');
  return value;
}

function jobPhase(row: StoredRow): Phase {
  const phase = validPhases.find((value) => value === row.phase);
  if (!phase || row.kind !== 'event-deletion' || !isUuid(row.requestId)
    || typeof row.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(row.fingerprint)
    || row.status !== (phase === 'done' ? 'deleted' : 'deleting')) throw new ApiError(503, 'INVALID_DELETION_JOB');
  return phase;
}

export class TableEventAdministration {
  constructor(private readonly table: TableClient, private readonly canManage: (identity: AccountIdentity) => boolean) {}

  private manager(identity: AccountIdentity): void {
    if (!this.canManage(identity)) throw new ApiError(403, 'EVENT_ADMINISTRATION_FORBIDDEN');
  }

  async listQuick(identity: AccountIdentity, status: EventStatus, cursor?: string): Promise<QuickRoundAdministrationPage> {
    this.manager(identity);
    const source = `quick-administration:${status}`;
    // This bounded server-filtered header query also finds legacy ownerless Quick rounds.
    const result = await page(this.table,
      odata`RowKey eq ${'event'} and quickRound eq true and quickRoundReady eq true and status eq ${status}`,
      decodeAdministrationCursor(source, cursor));
    const events: AdministrableEvent[] = [];
    for (const candidate of result.rows) {
      if (!isUuid(candidate.partitionKey) || candidate.rowKey !== 'event') throw new ApiError(503, 'INVALID_STORED_EVENT');
      const current = await optionalRow(this.table, candidate.partitionKey, 'event');
      if (!current || current.quickRound !== true || current.quickRoundReady !== true || current.status !== status) continue;
      if (revision(current) !== revision(candidate)) throw new ApiError(409, 'EVENT_CHANGED');
      events.push(eventSummary(candidate.partitionKey, current));
    }
    const continuationToken = encodeAdministrationCursor(source, result.continuationToken);
    return { events, ...(continuationToken ? { continuationToken } : {}) };
  }

  async restore(identity: AccountIdentity, eventId: string, expected: string, requestId: string): Promise<EventRestoreResult> {
    this.manager(identity);
    const event = await optionalRow(this.table, eventId, 'event');
    if (!event || event.quickRound !== true || event.quickRoundReady !== true
      || event.status !== 'active' && event.status !== 'archived') throw new ApiError(404, 'QUICK_ROUND_NOT_FOUND');
    const binding = { eventId, expected, requestId, identity };
    const key = `quick-restore:${requestId}`;
    const result: EventRestoreResult = { eventId, requestId, status: 'active' };
    const receipt = await optionalRow(this.table, eventId, key);
    if (receipt) {
      if (receipt.fingerprint !== digest(binding)) throw new ApiError(409, 'RESTORE_REQUEST_CONFLICT');
      if (event.status !== 'active') throw new ApiError(409, 'EVENT_CHANGED');
      return result;
    }
    if (event.status !== 'archived' || revision(event) !== expected) throw new ApiError(409, 'EVENT_CHANGED');
    await transaction(this.table, [
      ['update', { partitionKey: eventId, rowKey: 'event', status: 'active' }, 'Merge', { etag: expected }],
      ['create', { partitionKey: eventId, rowKey: key, kind: 'quick-restore', fingerprint: digest(binding),
        content: canonical({ request: binding, recordedAt: new Date().toISOString(), recordedBy: identity,
          before: 'archived', after: 'active' }) }],
    ], 'EVENT_CHANGED');
    return result;
  }

  async deleteArchived(identity: AccountIdentity, eventId: string, expected: string, confirmation: string,
    requestId: string): Promise<EventDeletionResult> {
    this.manager(identity);
    const fingerprint = digest({ identity, eventId, expected, confirmation, requestId });
    const event = await optionalRow(this.table, eventId, 'event');
    if (!event) throw new ApiError(404, 'EVENT_NOT_FOUND');
    if (event.kind === 'event-deletion') {
      jobPhase(event);
      if (event.requestId !== requestId || event.fingerprint !== fingerprint) throw new ApiError(409, 'DELETE_REQUEST_CONFLICT');
      return this.continueDeletion(identity, eventId, requestId);
    }
    if (event.status !== 'archived') throw new ApiError(409, 'ARCHIVE_BEFORE_DELETION');
    if (revision(event) !== expected) throw new ApiError(409, 'EVENT_CHANGED');
    if (typeof event.name !== 'string' || confirmation !== event.name) throw new ApiError(400, 'EVENT_NAME_CONFIRMATION_REQUIRED');
    const actions: TransactionAction[] = [];
    if (event.quickRound !== true || event.quickRoundReady !== true) {
      const access = await readEventAccess(this.table, identity, eventId);
      requireEventOwner(access);
      if (!access.member || access.summary.etag !== expected) throw new ApiError(409, 'EVENT_CHANGED');
      actions.push(['update', { partitionKey: eventId, rowKey: `member:${identity.objectId}`, role: 'owner' },
        'Merge', { etag: revision(access.member) }]);
    }
    const fence = await optionalRow(this.table, eventId, fenceKey);
    actions.push(fence
      ? ['update', { partitionKey: eventId, rowKey: fenceKey, state: 'blocked' }, 'Replace', { etag: revision(fence) }]
      : ['create', { partitionKey: eventId, rowKey: fenceKey, state: 'blocked' }]);
    // Replace strips the event's business metadata. This nonbusiness header permanently reserves its identity.
    actions.push(['update', { partitionKey: eventId, rowKey: 'event', kind: 'event-deletion', status: 'deleting',
      phase: 'admissions', requestId, fingerprint }, 'Replace', { etag: expected }]);
    await transaction(this.table, actions, 'EVENT_CHANGED');
    return this.continueDeletion(identity, eventId, requestId);
  }

  async listDeletions(identity: AccountIdentity, cursor?: string): Promise<EventDeletionPage> {
    this.manager(identity);
    const source = 'event-deletions';
    const result = await page(this.table, odata`RowKey eq ${'event'} and kind eq ${'event-deletion'} and status eq ${'deleting'}`,
      decodeAdministrationCursor(source, cursor));
    const deletions: EventDeletionResult[] = [];
    for (const row of result.rows) {
      if (!isUuid(row.partitionKey)) throw new ApiError(503, 'INVALID_DELETION_JOB');
      if (jobPhase(row) !== 'done' && isUuid(row.requestId)) {
        deletions.push({ eventId: row.partitionKey, requestId: row.requestId, state: 'deleting' });
      }
    }
    const continuationToken = encodeAdministrationCursor(source, result.continuationToken);
    return { deletions, ...(continuationToken ? { continuationToken } : {}) };
  }

  private async locatorTombstone(partitionKey: string, rowKey: string): Promise<void> {
    const existing = await optionalRow(this.table, partitionKey, rowKey);
    if (existing?.kind === 'deleted-event-locator') return;
    const tombstone = { partitionKey, rowKey, kind: 'deleted-event-locator' };
    // Preserve only locator keys, not names, profile data or audit actors. A late immutable create must conflict.
    await transaction(this.table, existing
      ? [['update', tombstone, 'Replace', { etag: revision(existing) }]]
      : [['create', tombstone]], 'DELETION_RETRY_REQUIRED');
  }

  async continueDeletion(identity: AccountIdentity, eventId: string, requestId: string): Promise<EventDeletionResult> {
    this.manager(identity);
    const job = await optionalRow(this.table, eventId, 'event');
    if (!job || job.kind !== 'event-deletion') throw new ApiError(404, 'DELETION_NOT_FOUND');
    const phase = jobPhase(job);
    if (job.requestId !== requestId) throw new ApiError(409, 'DELETE_REQUEST_CONFLICT');
    const result = (done: boolean): EventDeletionResult => ({ eventId, requestId, state: done ? 'deleted' : 'deleting' });
    if (phase === 'done') return result(true);
    const cursor = typeof job.cursor === 'string' && job.cursor ? job.cursor : undefined;
    if (phase === 'admissions') {
      const batch = await page(this.table,
        odata`PartitionKey eq ${eventId} and RowKey ge ${'admission:'} and RowKey lt ${'admission;'}`, cursor);
      for (const row of batch.rows) {
        if (isUuid(row.claimTenantId) && isUuid(row.claimObjectId) && isUuid(row.inviteId)) {
          await this.locatorTombstone(admissionIndexPartition({ tenantId: row.claimTenantId, objectId: row.claimObjectId }),
            admissionIndexKey(eventId, row.inviteId));
        }
      }
      await this.advance(job, batch.continuationToken ? phase : 'locators', batch.continuationToken);
    } else if (phase === 'locators') {
      // Only event-linked locators can live outside the event partition in the current storage schema.
      const batch = await page(this.table, odata`eventId eq ${eventId}`, cursor);
      for (const row of batch.rows) {
        if (row.partitionKey === eventId) continue;
        if (typeof row.partitionKey !== 'string' || !row.partitionKey.startsWith('admitted:')
          || typeof row.rowKey !== 'string' || !row.rowKey.startsWith(`${eventId}:`)) {
          throw new ApiError(503, 'UNKNOWN_EVENT_LOCATOR');
        }
        await this.locatorTombstone(row.partitionKey, row.rowKey);
      }
      await this.advance(job, batch.continuationToken ? phase : 'rows', batch.continuationToken);
    } else {
      // Re-read the first bounded page after each batch, so deleting rows cannot invalidate an SDK cursor.
      const batch = await page(this.table, odata`PartitionKey eq ${eventId}`);
      const business = batch.rows.filter((row) => row.rowKey !== 'event' && row.rowKey !== fenceKey);
      if (business.length) {
        await transaction(this.table, [
          ['update', { partitionKey: eventId, rowKey: 'event', phase }, 'Merge', { etag: revision(job) }],
          ...business.map((row): TransactionAction => {
            if (typeof row.rowKey !== 'string') throw new ApiError(503, 'INVALID_EVENT_ROW');
            return ['delete', { partitionKey: eventId, rowKey: row.rowKey }];
          }),
        ], 'DELETION_RETRY_REQUIRED');
      } else {
        if (batch.continuationToken) throw new ApiError(503, 'DELETION_VERIFICATION_FAILED');
        await this.advance(job, 'done');
        return result(true);
      }
    }
    return result(false);
  }

  private async advance(job: StoredRow, phase: Phase, cursor?: string): Promise<void> {
    if (typeof job.partitionKey !== 'string') throw new ApiError(503, 'INVALID_DELETION_JOB');
    await transaction(this.table, [
      ['update', { partitionKey: job.partitionKey, rowKey: 'event', kind: 'event-deletion',
        status: phase === 'done' ? 'deleted' : 'deleting', phase, cursor: cursor ?? '',
        requestId: job.requestId, fingerprint: job.fingerprint }, 'Replace', { etag: revision(job) }],
    ], 'DELETION_RETRY_REQUIRED');
  }
}
