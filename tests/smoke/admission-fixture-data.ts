import type { AdmissionsClient } from '../../src/client/admission';
import type { AdmissionManagement, PlayerAdmissionStatus } from '../../src/domain/admission';

export function fictionalAdmissionId(number: number): string {
  return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
}

export function fictionalAdmissionsClient(): AdmissionsClient {
  const pendingId = fictionalAdmissionId(200);
  let value: AdmissionManagement = {
    eventId: fictionalAdmissionId(100), eventStatus: 'active', etag: '"fictional-event-v1"', viewingPolicy: 'all-active-events',
    roster: Array.from({ length: 125 }, (_, index) => ({
      playerId: fictionalAdmissionId(index + 1), displayName: `Fictional golfer ${String(index + 1)}`,
    })),
    invitations: [{ inviteId: pendingId, playerId: fictionalAdmissionId(1), displayName: 'Fictional golfer 1',
      state: 'pending', revision: fictionalAdmissionId(300), verificationCode: 'ABCD-1234',
      createdAt: '2026-01-01T00:00:00Z', expiresAt: '2026-01-02T00:00:00Z' }],
  };
  let playerState: PlayerAdmissionStatus['state'] = 'pending';
  return {
    list: () => Promise.resolve(value),
    invite: (_event, input, _etag, operationId) => {
      value = { ...value, invitations: [...value.invitations.map((invite) =>
        invite.inviteId === input.replaceInviteId ? { ...invite, state: 'replaced' as const } : invite),
      { inviteId: input.inviteId, playerId: input.playerId,
        displayName: value.roster.find((player) => player.playerId === input.playerId)?.displayName ?? 'Fictional golfer',
        state: 'open', revision: crypto.randomUUID(), createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString() }] };
      return Promise.resolve({ operationId, inviteId: input.inviteId, state: 'open' });
    },
    approve: (_event, input, _etag, operationId) => {
      if (input.verificationCode !== 'ABCD-1234') return Promise.reject(new Error('Fictional code mismatch.'));
      playerState = 'approved';
      value = { ...value, invitations: value.invitations.map((invite) =>
        invite.inviteId === input.inviteId ? { ...invite, state: 'approved' } : invite) };
      return Promise.resolve({ operationId, inviteId: input.inviteId, state: 'approved' });
    },
    revoke: (_event, input, _etag, operationId) => {
      playerState = 'revoked';
      value = { ...value, invitations: value.invitations.map((invite) =>
        invite.inviteId === input.inviteId ? { ...invite, state: 'revoked' } : invite) };
      return Promise.resolve({ operationId, inviteId: input.inviteId, state: 'revoked' });
    },
    claim: (eventId, input) => Promise.resolve({ eventId, inviteId: input.inviteId, state: playerState,
      eventName: 'Fictional access event', displayName: 'Fictional golfer 1', verificationCode: 'ABCD-1234' }),
    status: (eventId, inviteId) => Promise.resolve({ eventId, inviteId, state: playerState,
      eventName: 'Fictional access event', displayName: 'Fictional golfer 1', verificationCode: 'ABCD-1234' }),
  };
}
