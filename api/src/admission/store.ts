import { createHash, timingSafeEqual } from 'node:crypto';
import { odata } from '@azure/data-tables';
import type { TableClient, TransactionAction } from '@azure/data-tables';
import type { AccountIdentity } from '../../../src/domain/events.js';
import type {
  AdmissionManagement, AdmissionResult, ApproveInvitation, ClaimInvitation, CreateInvitation,
  ManageInvitation, PlayerAdmissionStatus, PlayerInvitation,
} from '../../../src/domain/admission.js';
import { isAdmissionResult, isPlayerAdmissionStatus, isPlayerInvitation } from '../../../src/contracts/admission.js';
import { isRecord, isUuid } from '../../../src/contracts/events.js';
import { canonical, decode, digest, isConflict, optionalRow, page, revision, transaction } from '../catalog/entities.js';
import type { StoredRow } from '../catalog/entities.js';
import {
  admissionIndexKey, admissionIndexPartition, assertEventAccessUnchanged, readEventAccess, requireEventOwner,
} from '../event-access.js';
import type { EventAccess } from '../event-access.js';
import { privateContent } from '../private-values.js';
import { ApiError } from '../errors.js';

export interface AdmissionStore {
  list(identity: AccountIdentity, eventId: string): Promise<AdmissionManagement>;
  invite(identity: AccountIdentity, eventId: string, input: CreateInvitation, etag: string, requestId: string): Promise<AdmissionResult>;
  claim(identity: AccountIdentity, eventId: string, input: ClaimInvitation, requestId: string): Promise<PlayerAdmissionStatus>;
  approve(identity: AccountIdentity, eventId: string, input: ApproveInvitation, etag: string, requestId: string): Promise<AdmissionResult>;
  revoke(identity: AccountIdentity, eventId: string, input: ManageInvitation, etag: string, requestId: string): Promise<AdmissionResult>;
  status(identity: AccountIdentity, eventId: string, inviteId: string): Promise<PlayerAdmissionStatus>;
}

function actor(row: StoredRow, identity: AccountIdentity): boolean {
  return row.claimTenantId === identity.tenantId && row.claimObjectId === identity.objectId;
}
function rowKey(row: StoredRow): string {
  if (typeof row.rowKey !== 'string') throw new ApiError(503, 'INVALID_STORED_ADMISSION');
  return row.rowKey;
}
function sameToken(token: string, stored: unknown): boolean {
  const actual = createHash('sha256').update(token).digest();
  return typeof stored === 'string' && /^[a-f0-9]{64}$/.test(stored)
    && timingSafeEqual(actual, Buffer.from(stored, 'hex'));
}
function projection(row: StoredRow): PlayerInvitation {
  const result: unknown = { inviteId: row.inviteId, playerId: row.playerId, displayName: row.displayName,
    state: row.state === 'approved' && row.published !== true ? 'pending' : row.state,
    createdAt: row.createdAt, expiresAt: row.expiresAt, revision: row.revision,
    ...(typeof row.verificationCode === 'string' ? { verificationCode: row.verificationCode } : {}) };
  if (!isPlayerInvitation(result)) throw new ApiError(503, 'INVALID_STORED_ADMISSION');
  return result;
}

export class TableAdmissionStore implements AdmissionStore {
  constructor(private readonly table: TableClient, private readonly now: () => Date = () => new Date()) {}

  private async owner(identity: AccountIdentity, eventId: string, active = true): Promise<EventAccess> {
    const access = await readEventAccess(this.table, identity, eventId);
    requireEventOwner(access);
    if (active && access.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    return access;
  }

  private async roster(eventId: string): Promise<readonly { readonly playerId: string; readonly displayName: string }[]> {
    const workspace = await optionalRow(this.table, eventId, 'workspace');
    if (!workspace) return [];
    const content = await privateContent(this.table, eventId, 'workspace', workspace.content);
    const saved = decode(content, (value): value is Record<string, unknown> => isRecord(value));
    if (!Array.isArray(saved.roster)) throw new ApiError(503, 'INVALID_STORED_WORKSPACE');
    const players: { playerId: string; displayName: string }[] = [];
    for (const player of saved.roster) {
      if (!isRecord(player) || !isUuid(player.playerId) || typeof player.displayName !== 'string'
        || !player.displayName.trim() || player.displayName.length > 100) throw new ApiError(503, 'INVALID_STORED_WORKSPACE');
      players.push({ playerId: player.playerId, displayName: player.displayName });
    }
    return players;
  }

  private async invitation(eventId: string, inviteId: string): Promise<StoredRow> {
    const row = await optionalRow(this.table, eventId, `admission:${inviteId}`);
    if (!row || row.partitionKey !== eventId || row.rowKey !== `admission:${inviteId}` || row.inviteId !== inviteId) {
      throw new ApiError(404, 'INVITATION_NOT_FOUND');
    }
    projection(row);
    return row;
  }

  private operation(identity: AccountIdentity, action: string, input: unknown, etag?: string): string {
    // Tokens are represented solely by a digest even in durable operation bindings.
    return digest({ identity, action, input, etag: etag ?? null });
  }

  private async replay(eventId: string, requestId: string, fingerprint: string): Promise<StoredRow | undefined> {
    const receipt = await optionalRow(this.table, eventId, `admission-request:${requestId}`);
    if (receipt && receipt.fingerprint !== fingerprint) throw new ApiError(409, 'ADMISSION_REQUEST_CONFLICT');
    return receipt;
  }

  private checks(access: EventAccess, identity: AccountIdentity, requestId: string): TransactionAction[] {
    if (!access.member) throw new ApiError(403, 'EVENT_MANAGEMENT_FORBIDDEN');
    return [
      ['update', { partitionKey: access.summary.id, rowKey: 'event', admissionRevision: requestId }, 'Merge', { etag: revision(access.event) }],
      ['update', { partitionKey: access.summary.id, rowKey: `member:${identity.objectId}`, role: 'owner' }, 'Merge', { etag: revision(access.member) }],
    ];
  }

  private receipt(eventId: string, identity: AccountIdentity, action: string, requestId: string, fingerprint: string, result: AdmissionResult) {
    return { partitionKey: eventId, rowKey: `admission-request:${requestId}`, fingerprint, action,
      actorTenantId: identity.tenantId, actorObjectId: identity.objectId, at: this.now().toISOString(), content: canonical(result) };
  }

  async list(identity: AccountIdentity, eventId: string): Promise<AdmissionManagement> {
    const access = await this.owner(identity, eventId, false);
    const roster = await this.roster(eventId);
    const invitations: PlayerInvitation[] = [];
    let cursor: string | undefined;
    do {
      const result = await page(this.table, odata`PartitionKey eq ${eventId} and RowKey ge ${'admission:'} and RowKey lt ${'admission;'}`, cursor);
      invitations.push(...result.rows.map(projection));
      cursor = result.continuationToken;
    } while (cursor);
    await assertEventAccessUnchanged(this.table, identity, eventId, access);
    return { eventId, eventStatus: access.summary.status, etag: access.summary.etag, roster, invitations, viewingPolicy: 'all-active-events' };
  }

  async invite(identity: AccountIdentity, eventId: string, input: CreateInvitation, etag: string, requestId: string): Promise<AdmissionResult> {
    const access = await this.owner(identity, eventId);
    const fingerprint = this.operation(identity, 'invite', input, etag);
    const replay = await this.replay(eventId, requestId, fingerprint);
    if (replay) return decode(replay.content, isAdmissionResult);
    if (access.summary.etag !== etag) throw new ApiError(409, 'EVENT_CHANGED');
    const player = (await this.roster(eventId)).find((candidate) => candidate.playerId === input.playerId);
    if (!player) throw new ApiError(400, 'ROSTER_PLAYER_REQUIRED');
    const binding = await optionalRow(this.table, eventId, `player-account:${input.playerId}`);
    if (binding && binding.revoked !== true) throw new ApiError(409, 'PLAYER_ALREADY_BOUND');
    const slot = await optionalRow(this.table, eventId, `admission-slot:${input.playerId}`);
    const actions = this.checks(access, identity, requestId);
    if (slot) {
      if (!isUuid(slot.inviteId)) throw new ApiError(503, 'INVALID_STORED_ADMISSION');
      const old = await this.invitation(eventId, slot.inviteId);
      if ((old.state === 'open' || old.state === 'pending') && input.replaceInviteId !== slot.inviteId) throw new ApiError(409, 'EXPLICIT_REPLACEMENT_REQUIRED');
      if (input.replaceInviteId !== undefined && input.replaceInviteId !== slot.inviteId) throw new ApiError(409, 'INVITATION_CHANGED');
      if (old.state === 'approved') throw new ApiError(409, 'PLAYER_ALREADY_BOUND');
      actions.push(['update', { partitionKey: eventId, rowKey: rowKey(slot), inviteId: input.inviteId }, 'Merge', { etag: revision(slot) }]);
      if (old.state === 'open' || old.state === 'pending') actions.push(['update', {
        partitionKey: eventId, rowKey: rowKey(old), state: 'replaced', revision: requestId,
      }, 'Merge', { etag: revision(old) }]);
    } else {
      if (input.replaceInviteId !== undefined) throw new ApiError(409, 'INVITATION_CHANGED');
      actions.push(['create', { partitionKey: eventId, rowKey: `admission-slot:${input.playerId}`, inviteId: input.inviteId }]);
    }
    const result: AdmissionResult = { operationId: requestId, inviteId: input.inviteId, state: 'open' };
    const createdAt = this.now().toISOString();
    actions.push(['create', { partitionKey: eventId, rowKey: `admission:${input.inviteId}`, ...player, inviteId: input.inviteId,
      tokenHash: input.tokenHash, createdAt, expiresAt: new Date(Date.parse(createdAt) + 24 * 60 * 60 * 1000).toISOString(),
      state: 'open', revision: requestId }],
    ['create', this.receipt(eventId, identity, 'invite', requestId, fingerprint, result)]);
    await transaction(this.table, actions, 'ADMISSION_CHANGED');
    return result;
  }

  async claim(identity: AccountIdentity, eventId: string, input: ClaimInvitation, requestId: string): Promise<PlayerAdmissionStatus> {
    const fingerprint = this.operation(identity, 'claim', { inviteId: input.inviteId, tokenHash: createHash('sha256').update(input.token).digest('hex') });
    const replay = await this.replay(eventId, requestId, fingerprint);
    if (replay) return this.status(identity, eventId, input.inviteId);
    const [event, member, invite] = await Promise.all([
      optionalRow(this.table, eventId, 'event'), optionalRow(this.table, eventId, `member:${identity.objectId}`),
      this.invitation(eventId, input.inviteId),
    ]);
    if (!event || event.status === 'archived') throw new ApiError(404, 'INVITATION_NOT_FOUND');
    if (!sameToken(input.token, invite.tokenHash) || Date.parse(String(invite.expiresAt)) <= this.now().getTime()) throw new ApiError(404, 'INVITATION_NOT_FOUND');
    if (invite.state !== 'open') throw new ApiError(409, 'INVITATION_UNAVAILABLE');
    if (member && (member.role === 'owner' || member.revoked !== true && member.admissionId !== undefined
      || member.tenantId !== identity.tenantId || member.objectId !== identity.objectId)) throw new ApiError(409, 'ACCOUNT_ALREADY_BOUND');
    const binding = await optionalRow(this.table, eventId, `player-account:${String(invite.playerId)}`);
    if (binding && binding.revoked !== true) throw new ApiError(409, 'PLAYER_ALREADY_BOUND');
    const slot = await optionalRow(this.table, eventId, `admission-slot:${String(invite.playerId)}`);
    if (!slot || slot.inviteId !== input.inviteId) throw new ApiError(409, 'INVITATION_UNAVAILABLE');
    const code = digest({ identity, eventId, inviteId: input.inviteId, requestId }).slice(0, 8).toUpperCase();
    const verificationCode = `${code.slice(0, 4)}-${code.slice(4)}`;
    const pending = { ...invite, claimTenantId: identity.tenantId, claimObjectId: identity.objectId,
      state: 'pending', revision: requestId, verificationCode };
    const actions: TransactionAction[] = [
      ['update', { partitionKey: eventId, rowKey: 'event', admissionRevision: requestId }, 'Merge', { etag: revision(event) }],
      ['update', { partitionKey: eventId, rowKey: rowKey(invite), claimTenantId: identity.tenantId, claimObjectId: identity.objectId,
        state: 'pending', revision: requestId, verificationCode }, 'Merge', { etag: revision(invite) }],
      ['update', { partitionKey: eventId, rowKey: rowKey(slot), inviteId: input.inviteId }, 'Merge', { etag: revision(slot) }],
      ['create', this.receipt(eventId, identity, 'claim', requestId, fingerprint, { operationId: requestId, inviteId: input.inviteId, state: 'pending' })],
    ];
    if (member) actions.push(['update', { partitionKey: eventId, rowKey: rowKey(member), role: member.role }, 'Merge', { etag: revision(member) }]);
    await transaction(this.table, actions, 'ADMISSION_CHANGED');
    return this.playerStatus(eventId, event, pending);
  }

  private playerStatus(eventId: string, event: StoredRow, invite: StoredRow): PlayerAdmissionStatus {
    const result: unknown = { eventId, inviteId: invite.inviteId, eventName: event.name,
      displayName: invite.displayName, state: invite.state, verificationCode: invite.verificationCode };
    if (!isPlayerAdmissionStatus(result)) throw new ApiError(503, 'INVALID_STORED_ADMISSION');
    return result;
  }

  async status(identity: AccountIdentity, eventId: string, inviteId: string): Promise<PlayerAdmissionStatus> {
    const [invite, event] = await Promise.all([this.invitation(eventId, inviteId), optionalRow(this.table, eventId, 'event')]);
    if (!event || !actor(invite, identity)) throw new ApiError(404, 'INVITATION_NOT_FOUND');
    if (invite.state === 'approved') {
      const access = await readEventAccess(this.table, identity, eventId);
      if (access.viewerPlayerId !== invite.playerId || !access.admittedPlayer) throw new ApiError(409, 'ADMISSION_PUBLICATION_PENDING');
      await assertEventAccessUnchanged(this.table, identity, eventId, access);
    }
    return this.playerStatus(eventId, event, invite);
  }

  async approve(identity: AccountIdentity, eventId: string, input: ApproveInvitation, etag: string, requestId: string): Promise<AdmissionResult> {
    let access = await this.owner(identity, eventId);
    const fingerprint = this.operation(identity, 'approve', input, etag);
    const replay = await this.replay(eventId, requestId, fingerprint);
    let invite = await this.invitation(eventId, input.inviteId);
    if (replay && invite.published === true) {
      if (invite.state !== 'approved' || !isUuid(invite.claimTenantId) || !isUuid(invite.claimObjectId)) throw new ApiError(409, 'ADMISSION_CHANGED');
      const current = await readEventAccess(this.table, { tenantId: invite.claimTenantId, objectId: invite.claimObjectId }, eventId);
      if (current.viewerPlayerId !== invite.playerId || !current.admittedPlayer) throw new ApiError(409, 'ADMISSION_CHANGED');
      await assertEventAccessUnchanged(this.table, { tenantId: invite.claimTenantId, objectId: invite.claimObjectId }, eventId, current);
      return decode(replay.content, isAdmissionResult);
    }
    if (!replay) {
      if (access.summary.etag !== etag || invite.revision !== input.revision) throw new ApiError(409, 'ADMISSION_CHANGED');
      if (invite.state !== 'pending' || invite.verificationCode !== input.verificationCode
        || Date.parse(String(invite.expiresAt)) <= this.now().getTime()
        || !isUuid(invite.claimTenantId) || !isUuid(invite.claimObjectId)) throw new ApiError(409, 'INVITATION_UNAVAILABLE');
      if (!(await this.roster(eventId)).some((player) => player.playerId === invite.playerId)) throw new ApiError(409, 'ROSTER_PLAYER_REQUIRED');
      const member = await optionalRow(this.table, eventId, `member:${invite.claimObjectId}`);
      const binding = await optionalRow(this.table, eventId, `player-account:${String(invite.playerId)}`);
      const slot = await optionalRow(this.table, eventId, `admission-slot:${String(invite.playerId)}`);
      if (!slot || slot.inviteId !== input.inviteId) throw new ApiError(409, 'INVITATION_UNAVAILABLE');
      if (member && (member.role === 'owner' || member.tenantId !== invite.claimTenantId || member.objectId !== invite.claimObjectId
        || member.revoked !== true && member.admissionId !== undefined)) throw new ApiError(409, 'ACCOUNT_ALREADY_BOUND');
      if (binding && binding.revoked !== true) throw new ApiError(409, 'PLAYER_ALREADY_BOUND');
      const result: AdmissionResult = { operationId: requestId, inviteId: input.inviteId, state: 'approved' };
      const actions = this.checks(access, identity, requestId);
      const grant = { partitionKey: eventId, rowKey: `member:${invite.claimObjectId}`, tenantId: invite.claimTenantId,
        objectId: invite.claimObjectId, role: 'member', playerId: invite.playerId, admissionId: input.inviteId, revoked: false };
      const account = { ...grant, rowKey: `player-account:${String(invite.playerId)}` };
      // These counterparts remain unusable until discovery publication is confirmed and activated below.
      actions.push(member ? ['update', grant, 'Replace', { etag: revision(member) }] : ['create', grant],
        binding ? ['update', account, 'Replace', { etag: revision(binding) }] : ['create', account],
        ['update', { partitionKey: eventId, rowKey: rowKey(slot), inviteId: input.inviteId }, 'Merge', { etag: revision(slot) }],
        ['update', { partitionKey: eventId, rowKey: rowKey(invite), state: 'approved', published: false, revision: requestId,
          approvalRequestId: requestId }, 'Merge', { etag: revision(invite) }],
        ['create', this.receipt(eventId, identity, 'approve', requestId, fingerprint, result)]);
      await transaction(this.table, actions, 'ADMISSION_CHANGED');
      invite = await this.invitation(eventId, input.inviteId);
    }
    if (invite.state !== 'approved' || invite.approvalRequestId !== requestId
      || !isUuid(invite.claimTenantId) || !isUuid(invite.claimObjectId)) throw new ApiError(409, 'ADMISSION_CHANGED');
    const claimant = { tenantId: invite.claimTenantId, objectId: invite.claimObjectId };
    const index = { partitionKey: admissionIndexPartition(claimant), rowKey: admissionIndexKey(eventId, input.inviteId),
      eventId, admissionId: input.inviteId, playerId: invite.playerId, ...claimant };
    try { await this.table.createEntity(index); }
    catch (error) {
      if (!isConflict(error)) throw error;
      const saved = await optionalRow(this.table, index.partitionKey, index.rowKey);
      if (!saved || Object.entries(index).some(([key, value]) => saved[key] !== value)) throw new ApiError(503, 'INVALID_ADMISSION_INDEX');
    }
    access = await this.owner(identity, eventId);
    invite = await this.invitation(eventId, input.inviteId);
    if (invite.state !== 'approved' || invite.approvalRequestId !== requestId) throw new ApiError(409, 'ADMISSION_CHANGED');
    if (invite.published !== true) {
      const member = await optionalRow(this.table, eventId, `member:${claimant.objectId}`);
      const binding = await optionalRow(this.table, eventId, `player-account:${String(invite.playerId)}`);
      if (!member || !binding || member.admissionId !== input.inviteId || binding.admissionId !== input.inviteId
        || member.revoked === true || binding.revoked === true) throw new ApiError(409, 'ADMISSION_CHANGED');
      await transaction(this.table, [...this.checks(access, identity, requestId),
        ['update', { partitionKey: eventId, rowKey: rowKey(invite), published: true }, 'Merge', { etag: revision(invite) }],
        ['update', { partitionKey: eventId, rowKey: rowKey(member), admissionId: input.inviteId }, 'Merge', { etag: revision(member) }],
        ['update', { partitionKey: eventId, rowKey: rowKey(binding), admissionId: input.inviteId }, 'Merge', { etag: revision(binding) }],
      ], 'ADMISSION_CHANGED');
    }
    const validated = await readEventAccess(this.table, claimant, eventId);
    if (validated.viewerPlayerId !== invite.playerId || !validated.admittedPlayer) throw new ApiError(409, 'ADMISSION_CHANGED');
    await assertEventAccessUnchanged(this.table, claimant, eventId, validated);
    await assertEventAccessUnchanged(this.table, identity, eventId, await this.owner(identity, eventId));
    return { operationId: requestId, inviteId: input.inviteId, state: 'approved' };
  }

  async revoke(identity: AccountIdentity, eventId: string, input: ManageInvitation, etag: string, requestId: string): Promise<AdmissionResult> {
    const access = await this.owner(identity, eventId, false);
    const fingerprint = this.operation(identity, 'revoke', input, etag);
    const replay = await this.replay(eventId, requestId, fingerprint);
    if (replay) return decode(replay.content, isAdmissionResult);
    const invite = await this.invitation(eventId, input.inviteId);
    if (access.summary.etag !== etag || invite.revision !== input.revision) throw new ApiError(409, 'ADMISSION_CHANGED');
    if (invite.state !== 'open' && invite.state !== 'pending' && invite.state !== 'approved') throw new ApiError(409, 'INVITATION_UNAVAILABLE');
    const actions = this.checks(access, identity, requestId);
    if (invite.state === 'approved') {
      const member = await optionalRow(this.table, eventId, `member:${String(invite.claimObjectId)}`);
      const binding = await optionalRow(this.table, eventId, `player-account:${String(invite.playerId)}`);
      if (!member || !binding || member.role === 'owner' || member.admissionId !== input.inviteId
        || binding.admissionId !== input.inviteId) throw new ApiError(409, 'ADMISSION_CHANGED');
      actions.push(['update', { partitionKey: eventId, rowKey: rowKey(member), revoked: true }, 'Merge', { etag: revision(member) }],
        ['update', { partitionKey: eventId, rowKey: rowKey(binding), revoked: true }, 'Merge', { etag: revision(binding) }]);
    }
    const result: AdmissionResult = { operationId: requestId, inviteId: input.inviteId, state: 'revoked' };
    actions.push(['update', { partitionKey: eventId, rowKey: rowKey(invite), state: 'revoked', published: false, revision: requestId }, 'Merge', { etag: revision(invite) }],
      ['create', this.receipt(eventId, identity, 'revoke', requestId, fingerprint, result)]);
    await transaction(this.table, actions, 'ADMISSION_CHANGED');
    return result;
  }
}
