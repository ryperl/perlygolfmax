import { describe, expect, it } from 'vitest';
import {
  isCreateTesterLink, isEventTesterIdentity, isRenewTesterLink, isRevokeTesterLink, isTesterAccessManagement,
  isTesterAccessResult, isTesterCredential, isTesterLink,
} from './test-access';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const link = { linkId: id(1), revision: id(2), state: 'active',
  createdAt: '2026-01-01T00:00:00Z', expiresAt: '2026-01-02T00:00:00Z' };

describe('event-scoped tester link contracts', () => {
  it('accepts seven-day defaults, legacy one-day links and seven days from a valid renewal time only', () => {
    expect(isTesterLink(link)).toBe(true);
    expect(isTesterLink({ ...link, expiresAt: '2026-01-08T00:00:00Z' })).toBe(true);
    const renewed = { ...link, renewedAt: '2026-02-01T00:00:00Z', expiresAt: '2026-02-08T00:00:00Z' };
    expect(isTesterLink(renewed)).toBe(true);
    expect(isTesterAccessManagement({ eventId: id(3), eventStatus: 'active', etag: 'etag', scope: 'all-groups-in-event',
      links: [link, { ...renewed, linkId: id(4) }] })).toBe(true);
    for (const value of [
      { ...link, expiresAt: '2026-01-09T00:00:00Z' },
      { ...renewed, renewedAt: 'invalid' }, { ...renewed, renewedAt: null },
      { ...renewed, renewedAt: '2025-12-31T00:00:00Z', expiresAt: '2026-01-07T00:00:00Z' },
      { ...renewed, expiresAt: '2026-02-02T00:00:00Z' },
    ]) expect(isTesterLink(value)).toBe(false);
    expect(isRenewTesterLink({ linkId: id(1), revision: id(2) })).toBe(true);
    expect(isRenewTesterLink({ linkId: id(1), revision: id(2), expiresAt: renewed.expiresAt })).toBe(false);
  });
  it('accepts exact scoped digest-only management requests and rejects injected scope or account identity', () => {
    const create = { linkId: id(1), tokenHash: 'a'.repeat(64) };
    expect(isCreateTesterLink(create)).toBe(true);
    for (const value of [{ ...create, token: 'A'.repeat(43) }, { ...create, tokenHash: 'A'.repeat(64) },
      { ...create, eventId: id(3) }, { ...create, playerId: id(4) }]) expect(isCreateTesterLink(value)).toBe(false);
    expect(isRevokeTesterLink({ linkId: id(1), revision: id(2) })).toBe(true);
    expect(isRevokeTesterLink({ linkId: id(1), revision: '*' })).toBe(false);
    const actor = { kind: 'tester-link', eventId: id(3), linkId: id(1) };
    expect(isEventTesterIdentity(actor)).toBe(true);
    expect(isEventTesterIdentity({ ...actor, objectId: id(4) })).toBe(false);
    expect(isEventTesterIdentity({ ...actor, eventId: '*' })).toBe(false);
  });
  it('requires a canonical 32-byte credential and never accepts extra authority fields', () => {
    const credential = { eventId: id(3), linkId: id(1), token: 'A'.repeat(43) };
    expect(isTesterCredential(credential)).toBe(true);
    for (const value of [null, {}, { ...credential, token: 'A'.repeat(42) },
      { ...credential, token: `${'A'.repeat(42)}B` }, { ...credential, role: 'owner' },
      { ...credential, tenantId: id(4) }, { ...credential, eventId: 'other' }]) expect(isTesterCredential(value)).toBe(false);
  });
  it('validates expiry, exact public projections and unique links without disclosing hashes', () => {
    const management = { eventId: id(3), eventStatus: 'active', etag: 'fictional-etag', scope: 'all-groups-in-event', links: [link] };
    expect(isTesterAccessManagement(management)).toBe(true);
    expect(isTesterAccessManagement({ ...management, eventStatus: 'archived' })).toBe(true);
    for (const value of [{ ...management, scope: 'all-events' }, { ...management, links: [link, link] },
      { ...management, links: [{ ...link, tokenHash: 'a'.repeat(64) }] }]) expect(isTesterAccessManagement(value)).toBe(false);
    for (const value of [{ ...link, expiresAt: '2026-01-01T00:00:00Z' }, { ...link, expiresAt: '2026-01-03T00:00:00Z' },
      { ...link, createdAt: 'invalid' }, { ...link, state: 'owner' },
      { ...link, state: { toString: 1 } }]) expect(isTesterLink(value)).toBe(false);
    expect(isTesterLink({ ...link, state: 'revoked' })).toBe(true);
    expect(isTesterAccessResult({ operationId: id(2), linkId: id(1), state: 'active' })).toBe(true);
    expect(isTesterAccessResult({ operationId: id(2), linkId: id(1), state: 'approved' })).toBe(false);
  });
});
