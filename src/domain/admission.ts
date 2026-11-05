export type AdmissionState = 'open' | 'pending' | 'approved' | 'replaced' | 'revoked';

export interface PlayerInvitation {
  readonly inviteId: string;
  readonly playerId: string;
  readonly displayName: string;
  readonly state: AdmissionState;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revision: string;
  readonly verificationCode?: string;
}

export interface AdmissionManagement {
  readonly eventId: string;
  readonly eventStatus: EventStatus;
  readonly etag: string;
  readonly roster: readonly { readonly playerId: string; readonly displayName: string }[];
  readonly invitations: readonly PlayerInvitation[];
  readonly viewingPolicy: 'all-active-events';
}

export interface CreateInvitation {
  readonly inviteId: string;
  readonly playerId: string;
  readonly tokenHash: string;
  readonly replaceInviteId?: string;
}

export interface ClaimInvitation {
  readonly inviteId: string;
  readonly token: string;
}

export interface ManageInvitation {
  readonly inviteId: string;
  readonly revision: string;
}

export interface ApproveInvitation extends ManageInvitation {
  readonly verificationCode: string;
}

export interface AdmissionResult {
  readonly operationId: string;
  readonly inviteId: string;
  readonly state: AdmissionState;
}

export interface PlayerAdmissionStatus {
  readonly eventId: string;
  readonly inviteId: string;
  readonly state: 'pending' | 'approved' | 'revoked' | 'replaced';
  readonly eventName: string;
  readonly displayName: string;
  readonly verificationCode: string;
}

export interface InvitationLink {
  readonly eventId: string;
  readonly inviteId: string;
  readonly token: string;
}
import type { EventStatus } from './events.js';
