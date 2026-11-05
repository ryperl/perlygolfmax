import { vi } from 'vitest';
import type { AdmissionsClient } from '../../client/admission';
import type { AdmissionManagement, PlayerAdmissionStatus, PlayerInvitation } from '../../domain/admission';

export function admissionId(number: number): string {
  return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
}
export function management(invitations: readonly PlayerInvitation[] = [], count = 45): AdmissionManagement {
  return { eventId: admissionId(100), eventStatus: 'active', etag: '"fictional-event-v1"', viewingPolicy: 'all-active-events',
    roster: Array.from({ length: count }, (_, index) => ({ playerId: admissionId(index + 1), displayName: `Fictional golfer ${String(index + 1)}` })),
    invitations };
}
export function invitation(state: PlayerInvitation['state'] = 'open'): PlayerInvitation {
  return { inviteId: admissionId(200), playerId: admissionId(1), displayName: 'Fictional golfer 1', state,
    createdAt: '2026-01-01T00:00:00Z', expiresAt: '2026-01-02T00:00:00Z', revision: admissionId(300),
    ...(state === 'pending' ? { verificationCode: 'ABCD-1234' } : {}) };
}
export function status(state: PlayerAdmissionStatus['state'] = 'pending'): PlayerAdmissionStatus {
  return { eventId: admissionId(100), inviteId: admissionId(200), state,
    eventName: 'Fictional invitation event', displayName: 'Fictional golfer 1', verificationCode: 'ABCD-1234' };
}
export function admissionsClient(value = management()): AdmissionsClient {
  return {
    list: vi.fn<AdmissionsClient['list']>().mockResolvedValue(value),
    invite: vi.fn<AdmissionsClient['invite']>().mockImplementation((_event, input, _etag, operationId) =>
      Promise.resolve({ operationId, inviteId: input.inviteId, state: 'open' })),
    approve: vi.fn<AdmissionsClient['approve']>().mockImplementation((_event, input, _etag, operationId) =>
      Promise.resolve({ operationId, inviteId: input.inviteId, state: 'approved' })),
    revoke: vi.fn<AdmissionsClient['revoke']>().mockImplementation((_event, input, _etag, operationId) =>
      Promise.resolve({ operationId, inviteId: input.inviteId, state: 'revoked' })),
    claim: vi.fn<AdmissionsClient['claim']>().mockResolvedValue(status()),
    status: vi.fn<AdmissionsClient['status']>().mockResolvedValue(status()),
  };
}
export function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Uninitialized fictional deferred value.'); };
  let reject: (error: Error) => void = () => { throw new Error('Uninitialized fictional deferred value.'); };
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
