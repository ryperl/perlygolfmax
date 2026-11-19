import { isEventRevision, isUuid } from '../contracts/events';
import { isEventSkinsChange, isEventSkinsConfiguration } from '../contracts/event-skins';
import { sameJsonValue } from '../contracts/round-context';
import type { EventSkinsChange, EventSkinsConfiguration } from '../domain/event-skins';
import { isEventLeaderboardView } from '../contracts/event-leaderboard';
import type { EventLeaderboardView } from '../domain/event-leaderboard';
import { createPrivateRequest, readPrivateValue } from './private-request';
import type { EventSkinsDetails } from '../domain/event-skins-details';
import { isEventSkinsDetails } from '../contracts/event-skins-details';
import { scoringRulesQuery } from './scoring';

export interface EventLeaderboardClient {
  readonly details?: (eventId: string, signal: AbortSignal) => Promise<EventSkinsDetails>;
  readonly configureEventSkins?: (eventId: string, configuration: EventSkinsConfiguration | null,
    etag: string, requestId: string, signal: AbortSignal) => Promise<EventSkinsChange>;
  readonly load: (eventId: string, signal: AbortSignal) => Promise<EventLeaderboardView>;
}

export function createEventLeaderboardClient(apiUrl: string, getToken: () => Promise<string>, send: typeof fetch = fetch): EventLeaderboardClient {
  const request = createPrivateRequest(apiUrl, getToken, send);
  return {
    async details(eventId, signal) {
      if (!isUuid(eventId)) throw new Error('Invalid event identifier.');
      const value = await readPrivateValue(request, `events/${eventId}/leaderboard?view=event-skins-details`, signal);
      if (!isEventSkinsDetails(value) || value.eventId !== eventId) throw new Error('Skins details are unavailable from this API. Refresh to retry.');
      return value;
    },
    async configureEventSkins(eventId, configuration, etag, requestId, signal) {
      if (!isUuid(eventId) || !isUuid(requestId) || !isEventRevision(etag)
        || configuration !== null && !isEventSkinsConfiguration(configuration)) {
        throw new Error('Invalid event skins settings. Nothing was sent.');
      }
      const value = await request(`events/${encodeURIComponent(eventId)}/event-skins`, signal,
        { method: 'PUT', body: { configuration }, etag, requestId });
      if (!isEventSkinsChange(value) || value.eventId !== eventId || value.id !== requestId
        || value.expectedEtag !== etag || !sameJsonValue(value.after, configuration)) {
        throw new Error('Event skins save is not confirmed. Retain the same request and refresh before retrying.');
      }
      return value;
    },
    async load(eventId, signal) {
      if (!isUuid(eventId)) throw new Error('Invalid event identifier.');
      const value = await readPrivateValue(request, `events/${encodeURIComponent(eventId)}/leaderboard?${scoringRulesQuery}`, signal);
      if (!isEventLeaderboardView(value) || value.workspace.event.id !== eventId) {
        throw new Error('Invalid overall leaderboard response. Nothing was loaded.');
      }
      return value;
    },
  };
}
