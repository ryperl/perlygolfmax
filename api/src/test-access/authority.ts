import { createHash, timingSafeEqual } from 'node:crypto';
import type { TableClient } from '@azure/data-tables';
import type { EventTesterIdentity } from '../../../src/domain/test-access.js';
import { isEventSummary } from '../../../src/contracts/events.js';
import { isTesterCredential, isTesterLink } from '../../../src/contracts/test-access.js';
import { optionalRow, revision } from '../catalog/entities.js';
import type { StoredRow } from '../catalog/entities.js';
import type { EventAccess } from '../event-access.js';
import { ApiError } from '../errors.js';

export function testerLinkKey(linkId: string): string { return `tester-link:${linkId}`; }

export function activeTesterLink(row: StoredRow, identity: EventTesterIdentity, now = Date.now()): boolean {
  return row.partitionKey === identity.eventId && row.rowKey === testerLinkKey(identity.linkId)
    && row.linkId === identity.linkId && isTesterLink({
      linkId: row.linkId, state: row.state, createdAt: row.createdAt, expiresAt: row.expiresAt, revision: row.revision,
    }) && row.state === 'active' && Date.parse(String(row.expiresAt)) > now;
}

export async function readTesterAccess(table: TableClient, identity: EventTesterIdentity, eventId: string): Promise<EventAccess> {
  if (identity.eventId !== eventId) throw new ApiError(403, 'TESTER_ACCESS_ENDED');
  const [event, link] = await Promise.all([
    optionalRow(table, eventId, 'event'), optionalRow(table, eventId, testerLinkKey(identity.linkId)),
  ]);
  if (!event || !link || !activeTesterLink(link, identity)
    || event.partitionKey !== eventId || event.rowKey !== 'event'
    || event.status !== undefined && event.status !== 'active') throw new ApiError(403, 'TESTER_ACCESS_ENDED');
  const summary: unknown = { id: eventId, name: event.name, createdAt: event.createdAt,
    status: 'active', etag: revision(event), role: 'viewer' };
  if (!isEventSummary(summary)) throw new ApiError(503, 'INVALID_STORED_EVENT');
  revision(link);
  return { event, summary, admittedPlayer: false, testerLink: link, authorityProofs: [event, link] };
}

export async function verifyTesterCredential(table: TableClient, eventId: string, header: string | null): Promise<EventTesterIdentity> {
  const match = header === null ? null : /^Tester ([a-fA-F0-9-]{36})\.([A-Za-z0-9_-]{43})$/.exec(header);
  const credential: unknown = { eventId, linkId: match?.[1], token: match?.[2] };
  if (!isTesterCredential(credential)) throw new ApiError(403, 'TESTER_ACCESS_ENDED');
  const identity: EventTesterIdentity = { kind: 'tester-link', eventId, linkId: credential.linkId };
  const access = await readTesterAccess(table, identity, eventId);
  const stored = access.testerLink?.tokenHash;
  const actual = createHash('sha256').update(credential.token).digest();
  if (typeof stored !== 'string' || !/^[a-f0-9]{64}$/.test(stored)
    || !timingSafeEqual(actual, Buffer.from(stored, 'hex'))) throw new ApiError(403, 'TESTER_ACCESS_ENDED');
  return identity;
}
