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

/** Links: invitation and sign-in links. Records: the event's own rows. */
export type EventDeletionStage = 'links' | 'records' | 'finished';

export interface EventDeletionProgress {
  readonly stage: EventDeletionStage;
  /** Event records deleted so far. Links are not counted. */
  readonly removed: number;
}

export interface EventDeletionResult {
  readonly eventId: string;
  readonly requestId: string;
  readonly state: 'deleting' | 'deleted';
  /** Only returned when the client asks for it, so older clients see the original shape. */
  readonly progress?: EventDeletionProgress;
}

export interface EventDeletionPage {
  readonly deletions: readonly EventDeletionResult[];
  readonly continuationToken?: string;
}
