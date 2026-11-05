import { isUuid } from '../contracts/events';
import { isEventLeaderboardView } from '../contracts/event-leaderboard';
import type { EventLeaderboardView } from '../domain/event-leaderboard';
import { createPrivateRequest } from './private-request';

export interface EventLeaderboardClient {
  readonly load: (eventId: string, signal: AbortSignal) => Promise<EventLeaderboardView>;
}

export function createEventLeaderboardClient(apiUrl: string, getToken: () => Promise<string>, send: typeof fetch = fetch): EventLeaderboardClient {
  const request = createPrivateRequest(apiUrl, getToken, send);
  return {
    async load(eventId, signal) {
      if (!isUuid(eventId)) throw new Error('Invalid event identifier.');
      const value = await request(`events/${encodeURIComponent(eventId)}/leaderboard`, signal);
      if (!isEventLeaderboardView(value) || value.workspace.event.id !== eventId) {
        throw new Error('Invalid overall leaderboard response. Nothing was loaded.');
      }
      return value;
    },
  };
}
