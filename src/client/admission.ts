import type {
  AdmissionManagement, AdmissionResult, ApproveInvitation, ClaimInvitation, CreateInvitation,
  InvitationLink, ManageInvitation, PlayerAdmissionStatus,
} from '../domain/admission';
import {
  isAdmissionManagement, isAdmissionResult, isApproveInvitation, isClaimInvitation,
  isCreateInvitation, isInvitationLink, isManageInvitation, isPlayerAdmissionStatus,
} from '../contracts/admission';
import { isEventRevision, isUuid } from '../contracts/events';
import { createPrivateRequest, readPrivateValue } from './private-request';

export interface AdmissionsClient {
  readonly list: (eventId: string, signal: AbortSignal) => Promise<AdmissionManagement>;
  readonly invite: (eventId: string, input: CreateInvitation, etag: string, requestId: string, signal: AbortSignal) => Promise<AdmissionResult>;
  readonly claim: (eventId: string, input: ClaimInvitation, requestId: string, signal: AbortSignal) => Promise<PlayerAdmissionStatus>;
  readonly approve: (eventId: string, input: ApproveInvitation, etag: string, requestId: string, signal: AbortSignal) => Promise<AdmissionResult>;
  readonly revoke: (eventId: string, input: ManageInvitation, etag: string, requestId: string, signal: AbortSignal) => Promise<AdmissionResult>;
  readonly status: (eventId: string, inviteId: string, signal: AbortSignal) => Promise<PlayerAdmissionStatus>;
}

export function createAdmissionsClient(apiUrl: string, getToken: () => Promise<string>, send: typeof fetch = fetch): AdmissionsClient {
  const request = createPrivateRequest(apiUrl, getToken, send);
  function path(eventId: string): string {
    if (!isUuid(eventId)) throw new Error('Invalid event.');
    return `events/${eventId}/admissions`;
  }
  async function mutate(eventId: string, action: 'invite' | 'approve' | 'revoke', input: { readonly inviteId: string }, etag: string, requestId: string, signal: AbortSignal) {
    if (!isEventRevision(etag) || !isUuid(requestId)) throw new Error('Invalid admission operation.');
    const result = await request(`${path(eventId)}/${action}`, signal, { method: 'POST', body: input, etag, requestId });
    if (!isAdmissionResult(result) || result.operationId !== requestId || result.inviteId !== input.inviteId
      || result.state !== (action === 'invite' ? 'open' : action === 'approve' ? 'approved' : 'revoked')) {
      throw new Error('Invalid admission response. Retry the original request.');
    }
    return result;
  }
  return {
    async list(eventId, signal) {
      const result = await readPrivateValue(request, path(eventId), signal);
      if (!isAdmissionManagement(result) || result.eventId !== eventId) throw new Error('Invalid admission management response.');
      return result;
    },
    async invite(eventId, input, etag, requestId, signal) {
      if (!isCreateInvitation(input)) throw new Error('Invalid invitation.');
      return mutate(eventId, 'invite', input, etag, requestId, signal);
    },
    async approve(eventId, input, etag, requestId, signal) {
      if (!isApproveInvitation(input)) throw new Error('Invalid approval.');
      return mutate(eventId, 'approve', input, etag, requestId, signal);
    },
    async revoke(eventId, input, etag, requestId, signal) {
      if (!isManageInvitation(input)) throw new Error('Invalid revocation.');
      return mutate(eventId, 'revoke', input, etag, requestId, signal);
    },
    async claim(eventId, input, requestId, signal) {
      if (!isClaimInvitation(input) || !isUuid(requestId)) throw new Error('Invalid invitation claim.');
      const result = await request(`${path(eventId)}/claim`, signal, { method: 'POST', body: input, requestId });
      if (!isPlayerAdmissionStatus(result) || result.eventId !== eventId || result.inviteId !== input.inviteId) throw new Error('Invalid invitation claim response.');
      return result;
    },
    async status(eventId, inviteId, signal) {
      if (!isUuid(inviteId)) throw new Error('Invalid invitation.');
      const result = await request(`${path(eventId)}/status?inviteId=${inviteId}`, signal);
      if (!isPlayerAdmissionStatus(result) || result.eventId !== eventId || result.inviteId !== inviteId) throw new Error('Invalid admission status response.');
      return result;
    },
  };
}

export async function generateInvitationSecret(): Promise<{ readonly token: string; readonly tokenHash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return { token, tokenHash: Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('') };
}

export function invitationUrl(baseUrl: string, link: InvitationLink): string {
  if (!isInvitationLink(link)) throw new Error('Invalid invitation link.');
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('A secure invitation URL is required.');
  url.search = '';
  url.hash = `join?${new URLSearchParams({ event: link.eventId, invite: link.inviteId, token: link.token }).toString()}`;
  return url.toString();
}

/** Parse a private fragment; the app clears it after claiming and bounds any sign-in continuation. */
export function readInvitationFragment(fragment: string): InvitationLink | undefined {
  if (!fragment.startsWith('#join?') || fragment.length > 1024) return undefined;
  try {
    const query = new URLSearchParams(fragment.slice('#join?'.length));
    if (query.size !== 3 || !query.has('event') || !query.has('invite') || !query.has('token')) return undefined;
    const parsed: unknown = { eventId: query.get('event'), inviteId: query.get('invite'), token: query.get('token') };
    return isInvitationLink(parsed) ? parsed : undefined;
  } catch { return undefined; }
}
