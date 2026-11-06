import { odata } from '@azure/data-tables';
import type { TableClient } from '@azure/data-tables';
import type { AccountIdentity, EventSummary } from '../../src/domain/events.js';
import { isEventSummary, isUuid } from '../../src/contracts/events.js';
import { isPlayerInvitation, isVerificationCode } from '../../src/contracts/admission.js';
import { optionalRow, page, revision } from './catalog/entities.js';
import type { StoredRow } from './catalog/entities.js';
import { ApiError } from './errors.js';
import type { ScoreActor } from '../../src/domain/test-access.js';
import { isEventTesterIdentity } from '../../src/contracts/test-access.js';
import { readTesterAccess } from './test-access/authority.js';
import { isPublicScoreIdentity } from '../../src/contracts/public-access.js';
import { readPublicAccess } from './public-access/authority.js';

export interface EventAccess {
  readonly event: StoredRow;
  readonly summary: EventSummary;
  readonly member?: StoredRow;
  readonly memberEtag?: string;
  readonly viewerPlayerId?: string;
  readonly admittedPlayer: boolean;
  readonly testerLink?: StoredRow;
  readonly publicAccess?: true;
  readonly authorityProofs: readonly StoredRow[];
}

export function admissionIndexPartition(identity: AccountIdentity): string {
  return `admitted:${identity.tenantId}:${identity.objectId}`;
}
export function admissionIndexKey(eventId: string, admissionId: string): string { return `${eventId}:${admissionId}`; }

/** An immutable discovery row is only a locator; all three current source counterparts are authority. */
async function admissionProof(table: TableClient, identity: AccountIdentity, eventId: string, member: StoredRow): Promise<readonly StoredRow[] | undefined> {
  if (member.role !== 'member' || member.revoked !== undefined && member.revoked !== false || member.tenantId !== identity.tenantId
    || member.objectId !== identity.objectId || !isUuid(member.playerId) || !isUuid(member.admissionId)) return undefined;
  const [binding, admission, index, event] = await Promise.all([
    optionalRow(table, eventId, `player-account:${member.playerId}`),
    optionalRow(table, eventId, `admission:${member.admissionId}`),
    optionalRow(table, admissionIndexPartition(identity), admissionIndexKey(eventId, member.admissionId)),
    optionalRow(table, eventId, 'event'),
  ]);
  if (!binding || !admission || !index || !event || binding.revoked !== undefined && binding.revoked !== false || binding.playerId !== member.playerId
    || binding.tenantId !== identity.tenantId || binding.objectId !== identity.objectId || binding.admissionId !== member.admissionId
    || admission.inviteId !== member.admissionId || admission.state !== 'approved' || admission.published !== true || admission.playerId !== member.playerId
    || admission.claimTenantId !== identity.tenantId || admission.claimObjectId !== identity.objectId
    || index.eventId !== eventId || index.admissionId !== member.admissionId || index.playerId !== member.playerId
    || index.tenantId !== identity.tenantId || index.objectId !== identity.objectId) return undefined;
  if (!isVerificationCode(admission.verificationCode) || !isPlayerInvitation({
    inviteId: admission.inviteId, playerId: admission.playerId, displayName: admission.displayName,
    state: admission.state, createdAt: admission.createdAt, expiresAt: admission.expiresAt,
    revision: admission.revision, verificationCode: admission.verificationCode,
  })) return undefined;
  if (member.partitionKey !== eventId || member.rowKey !== `member:${identity.objectId}`
    || binding.partitionKey !== eventId || binding.rowKey !== `player-account:${member.playerId}`
    || admission.partitionKey !== eventId || admission.rowKey !== `admission:${member.admissionId}`
    || index.partitionKey !== admissionIndexPartition(identity) || index.rowKey !== admissionIndexKey(eventId, member.admissionId)
    || event.partitionKey !== eventId || event.rowKey !== 'event') return undefined;
  if (!isEventSummary({ id: eventId, name: event.name, createdAt: event.createdAt,
    ...(event.startDate === undefined || event.startDate === '' ? {} : { startDate: event.startDate }),
    status: event.status === undefined ? 'active' : event.status, etag: event.etag, role: 'member' })) return undefined;
  const rows = [member, binding, admission, index, event];
  if (rows.some((row) => typeof row.partitionKey !== 'string' || typeof row.rowKey !== 'string')) return undefined;
  rows.forEach(revision);
  return rows;
}

async function globalProof(table: TableClient, identity: AccountIdentity): Promise<readonly StoredRow[] | undefined> {
  const partition = admissionIndexPartition(identity);
  let cursor: string | undefined;
  const cursors = new Set<string>();
  do {
    const result = await page(table, odata`PartitionKey eq ${partition}`, cursor);
    for (const index of result.rows) {
      if (index.partitionKey !== partition || !isUuid(index.eventId) || !isUuid(index.admissionId)
        || index.rowKey !== admissionIndexKey(index.eventId, index.admissionId)) continue;
      const member = await optionalRow(table, index.eventId, `member:${identity.objectId}`);
      if (!member || member.admissionId !== index.admissionId) continue;
      const proof = await admissionProof(table, identity, index.eventId, member);
      if (proof) return proof;
    }
    cursor = result.continuationToken;
    if (cursor) {
      if (cursors.has(cursor)) throw new ApiError(503, 'INVALID_ADMISSION_INDEX');
      cursors.add(cursor);
    }
  } while (cursor);
  return undefined;
}

export async function readEventAccess(table: TableClient, identity: ScoreActor, eventId: string): Promise<EventAccess> {
  if ('kind' in identity) {
    if (identity.kind === 'public-score') {
      if (!isPublicScoreIdentity(identity)) throw new ApiError(403, 'PUBLIC_EVENT_NOT_AVAILABLE');
      return readPublicAccess(table, identity, eventId);
    }
    if (!isEventTesterIdentity(identity)) throw new ApiError(403, 'TESTER_ACCESS_ENDED');
    return readTesterAccess(table, identity, eventId);
  }
  const event = await optionalRow(table, eventId, 'event');
  if (!event) throw new ApiError(404, 'EVENT_NOT_FOUND');
  const candidate = await optionalRow(table, eventId, `member:${identity.objectId}`);
  const member = candidate && candidate.tenantId === identity.tenantId && candidate.objectId === identity.objectId
    && (candidate.revoked === undefined || candidate.revoked === false)
    && (candidate.role === 'owner' || candidate.role === 'member') ? candidate : undefined;
  const direct = member ? await admissionProof(table, identity, eventId, member) : undefined;
  const proof = direct ?? (member?.role === 'owner' ? undefined : await globalProof(table, identity));
  // Admission-bearing rows with incomplete publication are not legacy membership.
  const usableMember = member && (member.role === 'owner' || member.admissionId === undefined || direct) ? member : undefined;
  const role = usableMember?.role ?? (proof ? 'viewer' : undefined);
  if (!role) throw new ApiError(404, 'EVENT_NOT_FOUND');
  const summary: unknown = { id: eventId, name: event.name, createdAt: event.createdAt,
    ...(event.startDate === undefined || event.startDate === '' ? {} : { startDate: event.startDate }),
    status: event.status === undefined ? 'active' : event.status, etag: revision(event), role };
  if (!isEventSummary(summary)) throw new ApiError(503, 'INVALID_STORED_EVENT');
  if (summary.status === 'archived' && role !== 'owner') throw new ApiError(404, 'EVENT_NOT_FOUND');
  return { event, summary, ...(usableMember ? { member: usableMember, memberEtag: revision(usableMember) } : {}),
    ...(direct && member && typeof member.playerId === 'string' ? { viewerPlayerId: member.playerId } : {}),
    admittedPlayer: proof !== undefined, authorityProofs: [event, ...(usableMember ? [usableMember] : []), ...(proof ?? [])] };
}

export async function assertEventAccessUnchanged(table: TableClient, identity: ScoreActor, eventId: string, before: EventAccess): Promise<void> {
  const current = await readEventAccess(table, identity, eventId);
  if (current.summary.role !== before.summary.role || current.viewerPlayerId !== before.viewerPlayerId
    || current.admittedPlayer !== before.admittedPlayer) throw new ApiError(409, 'EVENT_CHANGED');
  for (const proof of before.authorityProofs) {
    if (typeof proof.partitionKey !== 'string' || typeof proof.rowKey !== 'string') throw new ApiError(503, 'INVALID_STORED_EVENT');
    const row = await optionalRow(table, proof.partitionKey, proof.rowKey);
    if (!row || revision(row) !== revision(proof)) throw new ApiError(409, 'EVENT_CHANGED');
  }
}

export function requireEventOwner(access: EventAccess): void {
  if (access.summary.role !== 'owner' || !access.member) throw new ApiError(403, 'EVENT_MANAGEMENT_FORBIDDEN');
}
