import { describe, expect, it } from 'vitest';
import {
  isAdmissionManagement, isAdmissionResult, isAdmissionToken, isApproveInvitation,
  isClaimInvitation, isCreateInvitation, isInvitationLink, isManageInvitation, isPlayerAdmissionStatus,
} from './admission';
import { isEventSummary } from './events';

const id = '00000000-0000-4000-8000-000000000001';
const token = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc';
const invitation = { inviteId: id, playerId: id, tokenHash: 'a'.repeat(64) };
const pending = { eventId: id, inviteId: id, state: 'pending', eventName: 'Fictional Open', displayName: 'Fictional Golfer', verificationCode: 'ABCD-1234' };

describe('admission runtime boundaries', () => {
  it('accepts explicit bounded requests, canonical random secrets and derived viewer summaries', () => {
    expect(isCreateInvitation(invitation)).toBe(true);
    expect(isClaimInvitation({ inviteId: id, token })).toBe(true);
    expect(isManageInvitation({ inviteId: id, revision: id })).toBe(true);
    expect(isApproveInvitation({ inviteId: id, revision: id, verificationCode: 'ABCD-1234' })).toBe(true);
    expect(isInvitationLink({ eventId: id, inviteId: id, token })).toBe(true);
    expect(isAdmissionResult({ operationId: id, inviteId: id, state: 'approved' })).toBe(true);
    expect(isPlayerAdmissionStatus(pending)).toBe(true);
    expect(isEventSummary({ id, name: 'Fictional Open', createdAt: '2026-01-01', role: 'viewer', status: 'active', etag: 'v1' })).toBe(true);
  });

  it('rejects identity overrides, unknown keys, noncanonical tokens and forged broad capabilities', () => {
    for (const extra of [{ email: 'fictional@example.test' }, { tenantId: id }, { objectId: id }, { role: 'owner' }, { published: true }]) {
      expect(isCreateInvitation({ ...invitation, ...extra })).toBe(false);
      expect(isClaimInvitation({ inviteId: id, token, ...extra })).toBe(false);
      expect(isPlayerAdmissionStatus({ ...pending, ...extra })).toBe(false);
    }
    expect(isAdmissionToken(token.slice(0, -1) + 'B')).toBe(false);
    expect(isAdmissionToken(token + '=')).toBe(false);
    expect(isCreateInvitation({ ...invitation, tokenHash: 'a'.repeat(63) })).toBe(false);
    expect(isApproveInvitation({ inviteId: id, revision: '*', verificationCode: 'ABCD-1234' })).toBe(false);
    expect(isApproveInvitation({ inviteId: id, revision: id, verificationCode: 'not-verified' })).toBe(false);
    expect(isPlayerAdmissionStatus({ ...pending, state: 'open' })).toBe(false);
    expect(isAdmissionManagement({ eventId: id, etag: '*', roster: [], invitations: [], viewingPolicy: 'all-active-events' })).toBe(false);
  });

  it('allowlists human-facing owner management, never permitting hashes, tokens or account identifiers', () => {
    const saved = { inviteId: id, playerId: id, displayName: 'Fictional Golfer', state: 'open',
      createdAt: '2026-01-01', expiresAt: '2026-01-02', revision: id };
    const management = { eventId: id, eventStatus: 'active', etag: 'v1', roster: [{ playerId: id, displayName: 'Fictional Golfer' }],
      invitations: [saved], viewingPolicy: 'all-active-events' };
    expect(isAdmissionManagement(management)).toBe(true);
    for (const extra of [{ token }, { tokenHash: 'a'.repeat(64) }, { claimObjectId: id }]) {
      expect(isAdmissionManagement({ ...management, invitations: [{ ...saved, ...extra }] })).toBe(false);
    }
    expect(isAdmissionManagement({ ...management, viewingPolicy: 'invited-events-only' })).toBe(false);
  });
});
