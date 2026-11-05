import type { AccountIdentity, EventStatus } from './events.js';

export interface EventTesterIdentity {
  readonly kind: 'tester-link';
  readonly eventId: string;
  readonly linkId: string;
}

export type ScoreActor = AccountIdentity | EventTesterIdentity;

export interface TesterLink {
  readonly linkId: string;
  readonly state: 'active' | 'revoked';
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly renewedAt?: string;
  readonly revision: string;
}

export interface TesterAccessManagement {
  readonly eventId: string;
  readonly eventStatus: EventStatus;
  readonly etag: string;
  readonly scope: 'all-groups-in-event';
  readonly links: readonly TesterLink[];
}

export interface CreateTesterLink {
  readonly linkId: string;
  readonly tokenHash: string;
}

export interface RevokeTesterLink {
  readonly linkId: string;
  readonly revision: string;
}

export interface RenewTesterLink {
  readonly linkId: string;
  readonly revision: string;
}

export interface TesterAccessResult {
  readonly operationId: string;
  readonly linkId: string;
  readonly state: 'active' | 'revoked';
}

export interface TesterCredential {
  readonly eventId: string;
  readonly linkId: string;
  readonly token: string;
}

export const testerLinkLifetimeMs = 7 * 24 * 60 * 60 * 1000;
