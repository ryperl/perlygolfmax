import type {
  CreateTesterLink, EventTesterIdentity, RenewTesterLink, RevokeTesterLink, TesterAccessManagement,
  TesterAccessResult, TesterCredential, TesterLink,
} from '../domain/test-access.js';
import { testerLinkLifetimeMs } from '../domain/test-access.js';
import { isAdmissionToken } from './admission.js';
import { isEventRevision, isEventStatus, isRecord, isUuid } from './events.js';

const legacyTesterLinkLifetimeMs = 24 * 60 * 60 * 1000;

function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

export function isEventTesterIdentity(value: unknown): value is EventTesterIdentity {
  return isRecord(value) && keys(value, ['kind', 'eventId', 'linkId'])
    && value.kind === 'tester-link' && isUuid(value.eventId) && isUuid(value.linkId);
}

export function isTesterLink(value: unknown): value is TesterLink {
  if (!isRecord(value) || !keys(value, ['linkId', 'state', 'createdAt', 'expiresAt', 'revision',
    ...(value.renewedAt === undefined ? [] : ['renewedAt'])])
    || !isUuid(value.linkId) || !isUuid(value.revision) || value.state !== 'active' && value.state !== 'revoked'
    || typeof value.createdAt !== 'string' || value.createdAt.length > 40
    || typeof value.expiresAt !== 'string' || value.expiresAt.length > 40) return false;
  const created = Date.parse(value.createdAt);
  const expires = Date.parse(value.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires)) return false;
  if (value.renewedAt !== undefined) {
    if (typeof value.renewedAt !== 'string' || value.renewedAt.length > 40) return false;
    const renewed = Date.parse(value.renewedAt);
    return Number.isFinite(renewed) && renewed >= created && expires - renewed === testerLinkLifetimeMs;
  }
  const lifetime = expires - created;
  return lifetime === testerLinkLifetimeMs || lifetime === legacyTesterLinkLifetimeMs;
}

export function isTesterAccessManagement(value: unknown): value is TesterAccessManagement {
  return isRecord(value) && keys(value, ['eventId', 'eventStatus', 'etag', 'scope', 'links'])
    && isUuid(value.eventId) && isEventStatus(value.eventStatus) && isEventRevision(value.etag)
    && value.scope === 'all-groups-in-event' && Array.isArray(value.links) && value.links.every(isTesterLink)
    && new Set(value.links.map((link: TesterLink) => link.linkId)).size === value.links.length;
}

export function isCreateTesterLink(value: unknown): value is CreateTesterLink {
  return isRecord(value) && keys(value, ['linkId', 'tokenHash']) && isUuid(value.linkId)
    && typeof value.tokenHash === 'string' && /^[a-f0-9]{64}$/.test(value.tokenHash);
}

export function isRevokeTesterLink(value: unknown): value is RevokeTesterLink {
  return isRecord(value) && keys(value, ['linkId', 'revision']) && isUuid(value.linkId) && isUuid(value.revision);
}

export function isRenewTesterLink(value: unknown): value is RenewTesterLink {
  return isRevokeTesterLink(value);
}

export function isTesterAccessResult(value: unknown): value is TesterAccessResult {
  return isRecord(value) && keys(value, ['operationId', 'linkId', 'state'])
    && isUuid(value.operationId) && isUuid(value.linkId) && (value.state === 'active' || value.state === 'revoked');
}

export function isTesterCredential(value: unknown): value is TesterCredential {
  return isRecord(value) && keys(value, ['eventId', 'linkId', 'token'])
    && isUuid(value.eventId) && isUuid(value.linkId) && isAdmissionToken(value.token);
}
