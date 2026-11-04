import { isEventCapabilities, isEventPage, isEventRevision, isEventStatus, isEventSummary, isUuid } from '../contracts/events';
import type { EventCapabilities, EventPage, EventStatus, EventSummary } from '../domain/events';

export class SessionExpiredError extends Error {}
export class EventChangedError extends Error {}

export interface EventsClient {
  readonly capabilities: (signal: AbortSignal) => Promise<EventCapabilities>;
  readonly list: (signal: AbortSignal, cursor?: string, status?: EventStatus) => Promise<EventPage>;
  readonly create: (name: string, requestId: string, signal: AbortSignal) => Promise<EventSummary>;
  readonly setStatus: (event: EventSummary, status: EventStatus, signal: AbortSignal) => Promise<EventSummary>;
}

export function createEventsClient(apiUrl: string, getToken: () => Promise<string>, send: typeof fetch = fetch): EventsClient {
  async function request(path: string, signal: AbortSignal, init?: {
    readonly method: 'POST' | 'PATCH';
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  }): Promise<unknown> {
    signal.throwIfAborted();
    const token = await getToken();
    signal.throwIfAborted();
    const response = await send(`${apiUrl}/${path}`, {
      ...init, signal, cache: 'no-store', credentials: 'omit',
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) throw new SessionExpiredError('Your session expired. Sign in again.');
    if (response.status === 409 && init?.method === 'PATCH') throw new EventChangedError('The event changed. Refresh events before trying again.');
    if (!response.ok) throw new Error(response.status === 429
      ? 'Too many requests. Wait a minute before trying again.'
      : `Event service request failed (${String(response.status)}). Nothing was confirmed saved.`);
    const value: unknown = await response.json();
    return value;
  }
  return {
    async capabilities(signal) {
      const result = await request('me', signal);
      if (!isEventCapabilities(result)) throw new Error('Invalid event permissions response.');
      return result;
    },
    async list(signal, cursor, status = 'active') {
      const query = new URLSearchParams({ status });
      if (cursor) query.set('cursor', cursor);
      const result = await request(`events?${query.toString()}`, signal);
      if (!isEventPage(result) || result.events.some((event) =>
        event.status !== status || status === 'archived' && event.role !== 'owner')) {
        throw new Error('Invalid event list response.');
      }
      return result;
    },
    async create(name, requestId, signal) {
      const result = await request('events', signal, {
        method: 'POST', body: JSON.stringify({ name }),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
      });
      if (!isEventSummary(result)) throw new Error('Invalid saved event response. Retry with the same request.');
      return result;
    },
    async setStatus(event, status, signal) {
      if (!isUuid(event.id) || !isEventRevision(event.etag) || !isEventStatus(status)) throw new Error('Invalid event update.');
      const result = await request(`events/${encodeURIComponent(event.id)}/status`, signal, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': event.etag },
        body: JSON.stringify({ status }),
      });
      if (!isEventSummary(result) || result.id !== event.id || result.status !== status) throw new Error('Invalid event update response. Refresh events.');
      return result;
    },
  };
}
