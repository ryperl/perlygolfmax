import type { ScoresClient } from './scoring';
import { createScoresClient } from './scoring';
import { generateInvitationSecret } from './admission';
import { createPrivateRequest, PrivateRequestError, readPrivateValue } from './private-request';
import type { EventWorkspace } from '../domain/setup';
import type {
  CreateTesterLink, RevokeTesterLink, TesterAccessManagement, TesterAccessResult, TesterCredential,
} from '../domain/test-access';
import {
  isCreateTesterLink, isEventTesterIdentity, isRevokeTesterLink, isTesterAccessManagement,
  isTesterAccessResult, isTesterCredential,
} from '../contracts/test-access';
import { isEventRevision, isUuid } from '../contracts/events';
import { isEventWorkspace } from '../contracts/setup';

export interface TesterAccessClient {
  readonly list: (eventId: string, signal: AbortSignal) => Promise<TesterAccessManagement>;
  readonly create: (eventId: string, input: CreateTesterLink, etag: string, requestId: string, signal: AbortSignal) => Promise<TesterAccessResult>;
  readonly revoke: (eventId: string, input: RevokeTesterLink, etag: string, requestId: string, signal: AbortSignal) => Promise<TesterAccessResult>;
  readonly workspace: (credential: TesterCredential, signal: AbortSignal) => Promise<EventWorkspace>;
  readonly bindScores: (credential: TesterCredential) => ScoresClient;
}

export const generateTesterSecret = generateInvitationSecret;

export function testerUrl(baseUrl: string, credential: TesterCredential): string {
  if (!isTesterCredential(credential)) throw new Error('Invalid tester link.');
  const url = new URL(baseUrl);
  if (url.username || url.password || url.protocol !== 'https:'
    && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('A secure tester URL is required.');
  url.search = '';
  url.hash = `tester?${new URLSearchParams({ event: credential.eventId, link: credential.linkId, token: credential.token }).toString()}`;
  return url.toString();
}

export function readTesterFragment(hash: string): TesterCredential | undefined {
  if (!hash.startsWith('#tester?') || hash.length > 1024) return undefined;
  const query = new URLSearchParams(hash.slice(8));
  if (query.size !== 3 || ['event', 'link', 'token'].some((key) => query.getAll(key).length !== 1)) return undefined;
  const value = { eventId: query.get('event'), linkId: query.get('link'), token: query.get('token') };
  return isTesterCredential(value) ? value : undefined;
}

export function createTesterAccessClient(apiUrl: string, getToken: () => Promise<string>, send: typeof fetch = fetch): TesterAccessClient {
  const ownerRequest = createPrivateRequest(apiUrl, getToken, send);
  function ownerPath(eventId: string): string {
    if (!isUuid(eventId)) throw new Error('Invalid event identifier.');
    return `events/${eventId}/test-access`;
  }
  function guest(credential: TesterCredential) {
    if (!isTesterCredential(credential)) throw new Error('Invalid tester link.');
    const { eventId, linkId, token } = credential;
    const key = () => Promise.resolve(`${linkId}.${token}`);
    return { eventId, linkId, key, request: createPrivateRequest(`${apiUrl}/tester`, key, send, 4096, 'Tester') };
  }
  async function mutate(eventId: string, action: 'create' | 'revoke', input: CreateTesterLink | RevokeTesterLink,
    etag: string, requestId: string, signal: AbortSignal): Promise<TesterAccessResult> {
    if (!isEventRevision(etag) || !isUuid(requestId)
      || (action === 'create' ? !isCreateTesterLink(input) : !isRevokeTesterLink(input))) throw new Error('Invalid tester access operation.');
    const value = await ownerRequest(`${ownerPath(eventId)}/${action}`, signal, { method: 'POST', body: input, etag, requestId });
    if (!isTesterAccessResult(value) || value.operationId !== requestId || value.linkId !== input.linkId
      || value.state !== (action === 'create' ? 'active' : 'revoked')) throw new Error('Invalid tester access acknowledgement. Retry the original operation.');
    return value;
  }
  return {
    async list(eventId, signal) {
      const value = await readPrivateValue(ownerRequest, ownerPath(eventId), signal);
      if (!isTesterAccessManagement(value) || value.eventId !== eventId) throw new Error('Invalid tester access management response.');
      return value;
    },
    create: (eventId, input, etag, requestId, signal) => mutate(eventId, 'create', input, etag, requestId, signal),
    revoke: (eventId, input, etag, requestId, signal) => mutate(eventId, 'revoke', input, etag, requestId, signal),
    async workspace(credential, signal) {
      const access = guest(credential);
      const value = await readPrivateValue(access.request, `events/${access.eventId}/workspace`, signal);
      if (!isEventWorkspace(value) || value.event.id !== access.eventId || value.event.role !== 'viewer'
        || value.testerAccess !== true || value.canViewScores !== true || value.viewerPlayerId !== undefined) {
        throw new Error('Invalid tester workspace response. Nothing was loaded.');
      }
      return value;
    },
    bindScores(credential) {
      const access = guest(credential);
      const scores = createScoresClient(`${apiUrl}/tester`, access.key, send, 'Tester');
      function scope(eventId: string) {
        if (eventId !== access.eventId) throw new Error('This tester link is limited to its event. Nothing was sent.');
      }
      return {
        async load(eventId, roundId, signal) {
          scope(eventId);
          const value = await scores.load(eventId, roundId, signal);
          if (value.permissions?.role !== 'tester') throw new Error('Invalid tester score permissions. Nothing was loaded.');
          return value;
        },
        async save(eventId, roundId, playerId, holeNumber, score, etag, requestId, signal) {
          scope(eventId);
          const value = await scores.save(eventId, roundId, playerId, holeNumber, score, etag, requestId, signal);
          if (value.round.permissions?.role !== 'tester' || !isEventTesterIdentity(value.change.recordedBy)
            || value.change.recordedBy.eventId !== access.eventId || value.change.recordedBy.linkId !== access.linkId) {
            throw new Error('Invalid tester save acknowledgement. The outcome is uncertain; retain this draft and request ID and refresh to review.');
          }
          return value;
        },
        history: () => Promise.reject(new PrivateRequestError(403, 'Tester access does not include audit history.')),
        saveGames: () => Promise.reject(new PrivateRequestError(403, 'Tester access does not include game management.')),
      };
    },
  };
}
