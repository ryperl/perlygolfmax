import {
  isEventDeletionPage, isEventDeletionResult, isEventRestoreResult, isQuickRoundAdministrationPage,
} from '../contracts/event-administration';
import { isEventRevision, isEventStatus, isUuid } from '../contracts/events';
import type {
  AdministrableEvent, EventDeletionPage, EventDeletionResult, EventRestoreResult, QuickRoundAdministrationPage,
} from '../domain/event-administration';
import type { EventStatus } from '../domain/events';
import { EventChangedError, SessionExpiredError } from './events';

/** The API's per-minute request limit was reached. Waiting a minute and retrying is safe. */
export class RateLimitedError extends Error {}

export interface EventAdministrationClient {
  readonly listQuick: (signal: AbortSignal, cursor?: string, status?: EventStatus) => Promise<QuickRoundAdministrationPage>;
  readonly restore: (event: AdministrableEvent, requestId: string, signal: AbortSignal) => Promise<EventRestoreResult>;
  readonly deleteArchived: (event: AdministrableEvent, confirmation: string, requestId: string, signal: AbortSignal) => Promise<EventDeletionResult>;
  readonly listDeletions: (signal: AbortSignal, cursor?: string) => Promise<EventDeletionPage>;
  readonly continueDeletion: (eventId: string, requestId: string, signal: AbortSignal) => Promise<EventDeletionResult>;
}

export function createEventAdministrationClient(apiUrl: string, getToken: () => Promise<string>,
  send: typeof fetch = fetch): EventAdministrationClient {
  async function request(path: string, signal: AbortSignal, input?: {
    readonly requestId: string; readonly expected?: string; readonly confirmation?: string;
  }): Promise<unknown> {
    signal.throwIfAborted();
    const token = await getToken();
    signal.throwIfAborted();
    const response = await send(`${apiUrl}/organizer/${path}`, {
      signal, cache: 'no-store', credentials: 'omit', method: input ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(input ? { 'Content-Type': 'application/json',
        'Idempotency-Key': input.requestId, ...(input.expected ? { 'If-Match': input.expected } : {}) } : {}) },
      ...(input ? { body: JSON.stringify(input.confirmation === undefined ? {} : { confirmation: input.confirmation }) } : {}),
    });
    if (response.status === 401) throw new SessionExpiredError('Your session expired. Sign in again.');
    if (response.status === 409) throw new EventChangedError('The event changed or another operation is pending. Refresh the list before starting a new action; retry a pending deletion unchanged.');
    if (response.status === 429) throw new RateLimitedError('Too many requests. Wait a minute, then retry the same operation.');
    if (!response.ok) throw new Error(response.status === 403 ? 'Only the organizer can manage these events.'
      : 'Event administration could not be confirmed. Retry the same operation.');
    const value: unknown = await response.json();
    return value;
  }
  function validate(eventId: string, requestId: string, expected?: string): void {
    if (!isUuid(eventId) || !isUuid(requestId) || expected !== undefined && !isEventRevision(expected)) {
      throw new Error('Invalid event administration request.');
    }
  }
  async function deletion(path: string, eventId: string, requestId: string, signal: AbortSignal,
    expected?: string, confirmation?: string): Promise<EventDeletionResult> {
    validate(eventId, requestId, expected);
    const value = await request(path, signal, { requestId, ...(expected ? { expected } : {}),
      ...(confirmation === undefined ? {} : { confirmation }) });
    if (!isEventDeletionResult(value) || value.eventId !== eventId || value.requestId !== requestId) {
      throw new Error('Invalid deletion acknowledgement. Retry the same operation.');
    }
    return value;
  }
  return {
    async listQuick(signal, cursor, status = 'active') {
      if (!isEventStatus(status)) throw new Error('Invalid event status.');
      const query = new URLSearchParams({ status, ...(cursor ? { cursor } : {}) });
      const value = await request(`quick-rounds?${query.toString()}`, signal);
      if (!isQuickRoundAdministrationPage(value) || value.events.some((event) => event.status !== status)) {
        throw new Error('Invalid Quick round directory response.');
      }
      return value;
    },
    async restore(event, requestId, signal) {
      validate(event.id, requestId, event.etag);
      if (event.status !== 'archived') throw new Error('Only archived Quick rounds can be restored.');
      const value = await request(`events/${encodeURIComponent(event.id)}/restore`, signal, { requestId, expected: event.etag });
      if (!isEventRestoreResult(value) || value.eventId !== event.id || value.requestId !== requestId) {
        throw new Error('Invalid restore acknowledgement. Retry the same operation.');
      }
      return value;
    },
    async deleteArchived(event, confirmation, requestId, signal) {
      if (event.status !== 'archived' || confirmation !== event.name) throw new Error('Type the exact archived event name to confirm deletion.');
      return deletion(`events/${encodeURIComponent(event.id)}/delete?progress=1`, event.id, requestId, signal, event.etag, confirmation);
    },
    async listDeletions(signal, cursor) {
      const value = await request(`deletions${cursor ? `?${new URLSearchParams({ cursor }).toString()}` : ''}`, signal);
      if (!isEventDeletionPage(value)) throw new Error('Invalid pending deletion response.');
      return value;
    },
    async continueDeletion(eventId, requestId, signal) {
      return deletion(`events/${encodeURIComponent(eventId)}/delete/continue?progress=1`, eventId, requestId, signal);
    },
  };
}
