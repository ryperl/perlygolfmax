import type { EventStatus } from './events.js';

export interface AdministrableEvent {
  readonly id: string;
  readonly name: string;
  readonly status: EventStatus;
  readonly etag: string;
}

export interface QuickRoundAdministrationPage {
  readonly events: readonly AdministrableEvent[];
  readonly continuationToken?: string;
}

export interface EventRestoreResult {
  readonly eventId: string;
  readonly requestId: string;
  readonly status: 'active';
}

export interface EventDeletionResult {
  readonly eventId: string;
  readonly requestId: string;
  readonly state: 'deleting' | 'deleted';
}

export interface EventDeletionPage {
  readonly deletions: readonly EventDeletionResult[];
  readonly continuationToken?: string;
}
