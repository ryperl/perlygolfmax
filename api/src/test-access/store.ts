import { odata } from '@azure/data-tables';
import type { TableClient, TransactionAction } from '@azure/data-tables';
import type { AccountIdentity } from '../../../src/domain/events.js';
import type {
  CreateTesterLink, EventTesterIdentity, RevokeTesterLink, TesterAccessManagement, TesterAccessResult, TesterLink,
} from '../../../src/domain/test-access.js';
import { testerLinkLifetimeMs } from '../../../src/domain/test-access.js';
import { isCreateTesterLink, isRevokeTesterLink, isTesterAccessResult, isTesterLink } from '../../../src/contracts/test-access.js';
import { isEventRevision, isUuid } from '../../../src/contracts/events.js';
import { maximumPrivateValueBytes } from '../../../src/contracts/private-values.js';
import { canonical, decode, digest, isConflict, optionalRow, page, revision } from '../catalog/entities.js';
import type { StoredRow } from '../catalog/entities.js';
import { assertEventAccessUnchanged, readEventAccess, requireEventOwner } from '../event-access.js';
import type { EventAccess } from '../event-access.js';
import { ApiError } from '../errors.js';
import { testerLinkKey, verifyTesterCredential } from './authority.js';

function project(row: StoredRow): TesterLink {
  const result: unknown = { linkId: row.linkId, state: row.state, createdAt: row.createdAt,
    expiresAt: row.expiresAt, revision: row.revision };
  if (!isTesterLink(result) || row.rowKey !== testerLinkKey(result.linkId)) throw new ApiError(503, 'INVALID_STORED_TESTER_LINK');
  return result;
}

export class TableTesterAccessStore {
  constructor(private readonly table: TableClient, private readonly now: () => Date = () => new Date()) {}

  verify(eventId: string, header: string | null): Promise<EventTesterIdentity> {
    return verifyTesterCredential(this.table, eventId, header);
  }

  private async owner(identity: AccountIdentity, eventId: string): Promise<EventAccess> {
    if (!isUuid(eventId)) throw new ApiError(400, 'INVALID_EVENT_ID');
    const access = await readEventAccess(this.table, identity, eventId);
    requireEventOwner(access);
    return access;
  }

  async list(identity: AccountIdentity, eventId: string, chargeRead: () => Promise<void> = async () => {}): Promise<TesterAccessManagement> {
    const access = await this.owner(identity, eventId);
    const links: TesterLink[] = [];
    let cursor: string | undefined;
    const cursors = new Set<string>();
    let bytes = 0;
    do {
      await chargeRead();
      const batch = await page(this.table, odata`PartitionKey eq ${eventId} and RowKey ge ${'tester-link:'} and RowKey lt ${'tester-link;'}`, cursor);
      for (const row of batch.rows) {
        if (row.partitionKey !== eventId) throw new ApiError(503, 'INVALID_STORED_TESTER_LINK');
        const link = project(row);
        bytes += Buffer.byteLength(canonical(link), 'utf8') + 1;
        if (bytes > maximumPrivateValueBytes - 4096) throw new ApiError(413, 'PRIVATE_VALUE_TOO_LARGE');
        links.push(link);
      }
      cursor = batch.continuationToken;
      if (cursor && cursors.has(cursor)) throw new ApiError(503, 'INVALID_STORED_TESTER_LINK');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    await assertEventAccessUnchanged(this.table, identity, eventId, access);
    return { eventId, eventStatus: access.summary.status, etag: access.summary.etag, scope: 'all-groups-in-event', links };
  }

  private async replay(eventId: string, requestId: string, fingerprint: string): Promise<TesterAccessResult | undefined> {
    const row = await optionalRow(this.table, eventId, `tester-request:${requestId}`);
    if (!row) return undefined;
    if (row.fingerprint !== fingerprint) throw new ApiError(409, 'TESTER_REQUEST_CONFLICT');
    const result = decode(row.content, isTesterAccessResult);
    if (result.operationId !== requestId) throw new ApiError(503, 'INVALID_STORED_TESTER_LINK');
    return result;
  }

  private checks(access: EventAccess, identity: AccountIdentity, requestId: string): TransactionAction[] {
    if (!access.member) throw new ApiError(403, 'EVENT_MANAGEMENT_FORBIDDEN');
    return [
      ['update', { partitionKey: access.summary.id, rowKey: 'event', testerRevision: requestId }, 'Merge', { etag: revision(access.event) }],
      ['update', { partitionKey: access.summary.id, rowKey: `member:${identity.objectId}`, role: 'owner' }, 'Merge', { etag: revision(access.member) }],
    ];
  }

  private async mutate(identity: AccountIdentity, eventId: string, input: CreateTesterLink | RevokeTesterLink,
    etag: string, requestId: string, action: 'create' | 'revoke'): Promise<TesterAccessResult> {
    if (!isUuid(requestId) || !isEventRevision(etag) || etag.includes(',')
      || (action === 'create' ? !isCreateTesterLink(input) : !isRevokeTesterLink(input))) throw new ApiError(400, 'INVALID_TESTER_REQUEST');
    const access = await this.owner(identity, eventId);
    const fingerprint = digest({ identity, action, input, etag });
    const replay = await this.replay(eventId, requestId, fingerprint);
    if (replay) return replay;
    if (access.summary.etag !== etag) throw new ApiError(409, 'EVENT_CHANGED');
    const actions = this.checks(access, identity, requestId);
    const result: TesterAccessResult = { operationId: requestId, linkId: input.linkId, state: action === 'create' ? 'active' : 'revoked' };
    if (action === 'create' && isCreateTesterLink(input)) {
      if (access.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
      const created = this.now().getTime();
      actions.push(['create', { partitionKey: eventId, rowKey: testerLinkKey(input.linkId), linkId: input.linkId,
        tokenHash: input.tokenHash, state: 'active', createdAt: new Date(created).toISOString(),
        expiresAt: new Date(created + testerLinkLifetimeMs).toISOString(), revision: requestId }]);
    } else if (isRevokeTesterLink(input)) {
      const link = await optionalRow(this.table, eventId, testerLinkKey(input.linkId));
      if (!link || link.partitionKey !== eventId) throw new ApiError(404, 'TESTER_LINK_NOT_FOUND');
      if (project(link).revision !== input.revision) throw new ApiError(409, 'TESTER_LINK_CHANGED');
      actions.push(['update', { partitionKey: eventId, rowKey: testerLinkKey(input.linkId),
        state: 'revoked', revision: requestId }, 'Merge', { etag: revision(link) }]);
    }
    actions.push(['create', { partitionKey: eventId, rowKey: `tester-request:${requestId}`, fingerprint,
      actorTenantId: identity.tenantId, actorObjectId: identity.objectId, action, at: this.now().toISOString(), content: canonical(result) }]);
    try { await this.table.submitTransaction(actions); }
    catch (error) {
      const committed = await this.replay(eventId, requestId, fingerprint);
      if (committed) return committed;
      if (isConflict(error)) throw new ApiError(409, 'TESTER_LINK_CHANGED');
      throw error;
    }
    return result;
  }

  create(identity: AccountIdentity, eventId: string, input: CreateTesterLink, etag: string, requestId: string): Promise<TesterAccessResult> {
    return this.mutate(identity, eventId, input, etag, requestId, 'create');
  }

  revoke(identity: AccountIdentity, eventId: string, input: RevokeTesterLink, etag: string, requestId: string): Promise<TesterAccessResult> {
    return this.mutate(identity, eventId, input, etag, requestId, 'revoke');
  }
}
