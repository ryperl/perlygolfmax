import type {
  AdmissionManagement, AdmissionResult, AdmissionState, ApproveInvitation, ClaimInvitation,
  CreateInvitation, InvitationLink, ManageInvitation, PlayerAdmissionStatus, PlayerInvitation,
} from '../domain/admission.js';
import { isEventRevision, isEventStatus, isRecord, isUuid } from './events.js';

function keys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
function label(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= 100; }
function instant(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
export function isAdmissionToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value);
}
export function isAdmissionState(value: unknown): value is AdmissionState {
  return value === 'open' || value === 'pending' || value === 'approved' || value === 'replaced' || value === 'revoked';
}
export function isVerificationCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-F0-9]{4}-[A-F0-9]{4}$/.test(value);
}
export function isCreateInvitation(value: unknown): value is CreateInvitation {
  return isRecord(value) && keys(value, ['inviteId', 'playerId', 'tokenHash'], ['replaceInviteId'])
    && isUuid(value.inviteId) && isUuid(value.playerId)
    && typeof value.tokenHash === 'string' && /^[a-f0-9]{64}$/.test(value.tokenHash)
    && (value.replaceInviteId === undefined || isUuid(value.replaceInviteId));
}
export function isClaimInvitation(value: unknown): value is ClaimInvitation {
  return isRecord(value) && keys(value, ['inviteId', 'token']) && isUuid(value.inviteId) && isAdmissionToken(value.token);
}
export function isManageInvitation(value: unknown): value is ManageInvitation {
  return isRecord(value) && keys(value, ['inviteId', 'revision']) && isUuid(value.inviteId) && isUuid(value.revision);
}
export function isApproveInvitation(value: unknown): value is ApproveInvitation {
  return isRecord(value) && keys(value, ['inviteId', 'revision', 'verificationCode'])
    && isUuid(value.inviteId) && isUuid(value.revision) && isVerificationCode(value.verificationCode);
}
export function isPlayerInvitation(value: unknown): value is PlayerInvitation {
  return isRecord(value) && keys(value, ['inviteId', 'playerId', 'displayName', 'state', 'createdAt', 'expiresAt', 'revision'], ['verificationCode'])
    && isUuid(value.inviteId) && isUuid(value.playerId) && label(value.displayName) && isAdmissionState(value.state)
    && instant(value.createdAt) && instant(value.expiresAt) && isUuid(value.revision)
    && (value.verificationCode === undefined || isVerificationCode(value.verificationCode));
}
export function isAdmissionManagement(value: unknown): value is AdmissionManagement {
  return isRecord(value) && keys(value, ['eventId', 'eventStatus', 'etag', 'roster', 'invitations', 'viewingPolicy'])
    && isEventStatus(value.eventStatus)
    && isUuid(value.eventId) && isEventRevision(value.etag) && value.viewingPolicy === 'all-active-events'
    && Array.isArray(value.roster) && value.roster.every((player: unknown) =>
      isRecord(player) && keys(player, ['playerId', 'displayName']) && isUuid(player.playerId) && label(player.displayName))
    && Array.isArray(value.invitations) && value.invitations.every(isPlayerInvitation);
}
export function isAdmissionResult(value: unknown): value is AdmissionResult {
  return isRecord(value) && keys(value, ['operationId', 'inviteId', 'state'])
    && isUuid(value.operationId) && isUuid(value.inviteId) && isAdmissionState(value.state);
}
export function isPlayerAdmissionStatus(value: unknown): value is PlayerAdmissionStatus {
  return isRecord(value) && keys(value, ['eventId', 'inviteId', 'state', 'eventName', 'displayName', 'verificationCode'])
    && isUuid(value.eventId) && isUuid(value.inviteId) && isAdmissionState(value.state) && value.state !== 'open'
    && label(value.eventName) && label(value.displayName) && isVerificationCode(value.verificationCode);
}
export function isInvitationLink(value: unknown): value is InvitationLink {
  return isRecord(value) && keys(value, ['eventId', 'inviteId', 'token'])
    && isUuid(value.eventId) && isUuid(value.inviteId) && isAdmissionToken(value.token);
}
