import { isEventCapabilities, isEventPage, isEventSummary } from '../contracts/events';
import type { EventCapabilities, EventPage, EventSummary } from '../domain/events';

export class SessionExpiredError extends Error {}

export interface EventsClient {
  readonly capabilities: (signal: AbortSignal) => Promise<EventCapabilities>;
  readonly list: (signal: AbortSignal, cursor?: string) => Promise<EventPage>;
  readonly create: (name: string, requestId: string, signal: AbortSignal) => Promise<EventSummary>;
}

export function createEventsClient(apiUrl: string, getToken: () => Promise<string>, send: typeof fetch = fetch): EventsClient {
  async function request(path: string, signal: AbortSignal, body?: { readonly name: string; readonly requestId: string }): Promise<unknown> {
    signal.throwIfAborted();
    const token = await getToken();
    signal.throwIfAborted();
    const response = await send(`${apiUrl}/${path}`, {
      method: body ? 'POST' : 'GET', signal, cache: 'no-store', credentials: 'omit',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json', 'Idempotency-Key': body.requestId } : {}) },
      ...(body ? { body: JSON.stringify({ name: body.name }) } : {}),
    });
    if (response.status === 401) throw new SessionExpiredError('Your session expired. Sign in again.');
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
    async list(signal, cursor) {
      const result = await request(`events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, signal);
      if (!isEventPage(result)) throw new Error('Invalid event list response.');
      return result;
    },
    async create(name, requestId, signal) {
      const result = await request('events', signal, { name, requestId });
      if (!isEventSummary(result)) throw new Error('Invalid saved event response. Retry with the same request.');
      return result;
    },
  };
}
