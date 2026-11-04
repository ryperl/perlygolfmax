import { isEventRevision, isUuid } from '../contracts/events';
import { isEventSetupInput, isEventWorkspace } from '../contracts/setup';
import type { EventSetupInput, EventWorkspace } from '../domain/setup';
import { createPrivateRequest } from './private-request';

export interface SetupClient {
  readonly load: (eventId: string, signal: AbortSignal) => Promise<EventWorkspace>;
  readonly save: (eventId: string, etag: string, input: EventSetupInput, signal: AbortSignal) => Promise<EventWorkspace>;
}

export function createSetupClient(apiUrl: string, getToken: () => Promise<string>, send: typeof fetch = fetch): SetupClient {
  const request = createPrivateRequest(apiUrl, getToken, send);
  return {
    async load(eventId, signal) {
      if (!isUuid(eventId)) throw new Error('Invalid event identifier.');
      const value = await request(`events/${encodeURIComponent(eventId)}/workspace`, signal);
      if (!isEventWorkspace(value) || value.event.id !== eventId) throw new Error('Invalid event workspace response.');
      return value;
    },
    async save(eventId, etag, input, signal) {
      if (!isUuid(eventId) || !isEventRevision(etag) || !isEventSetupInput(input)) throw new Error('Check setup: select 4–8 saved players, 1–8 rounds, an explicit course version and tee, and assign every player once to groups 1–4 (maximum 4 per group).');
      const value = await request(`events/${encodeURIComponent(eventId)}/workspace`, signal, { method: 'PUT', body: input, etag });
      if (!isEventWorkspace(value) || value.event.id !== eventId) throw new Error('Invalid saved workspace response. Refresh before retrying.');
      return value;
    },
  };
}
