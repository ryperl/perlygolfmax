import type { EventsClient } from './events';
import type { SetupClient } from './setup';
import type { ScoresClient } from './scoring';
import { createScoresClient } from './scoring';
import type { EventLeaderboardClient } from './event-leaderboard';
import type { PurseClient } from './purse';
import { createPrivateRequest, PrivateRequestError, readPrivateValue } from './private-request';
import { isEventPage, isUuid } from '../contracts/events';
import { isEventWorkspace } from '../contracts/setup';
import { isEventLeaderboardView } from '../contracts/event-leaderboard';
import { isEventPurseView } from '../contracts/purse-settings';
import { isPublicScoreIdentity } from '../contracts/public-access';

export interface PublicServices {
  readonly events: Pick<EventsClient, 'list'>;
  readonly setup: SetupClient;
  readonly scores: ScoresClient;
  readonly leaderboard: EventLeaderboardClient;
  readonly purse: PurseClient;
}

export function createPublicServices(apiUrl: string, send: typeof fetch = fetch): PublicServices {
  const noToken = () => Promise.reject(new Error('Public scoring must not acquire an account token.'));
  const root = `${apiUrl}/public`;
  const request = createPrivateRequest(root, noToken, send, 4096, 'None');
  const rawScores = createScoresClient(root, noToken, send, 'None');
  const denied = () => Promise.reject(new PrivateRequestError(403, 'Organizer sign-in is required for management and audit history.'));
  function path(eventId: string): string {
    if (!isUuid(eventId)) throw new Error('Invalid event identifier.');
    return `events/${eventId}`;
  }
  const setup: SetupClient = {
    async load(eventId, signal) {
      const value = await readPrivateValue(request, `${path(eventId)}/workspace`, signal);
      if (!isEventWorkspace(value) || value.event.id !== eventId || value.event.role !== 'viewer'
        || value.publicAccess !== true || value.canViewScores !== true || value.viewerPlayerId !== undefined) {
        throw new Error('Invalid public event workspace. Nothing was loaded.');
      }
      return value;
    },
    save: denied, refreshIndices: denied,
  };
  const scores: ScoresClient = {
    async load(eventId, roundId, signal) {
      const value = await rawScores.load(eventId, roundId, signal);
      if (value.permissions?.role !== 'public') throw new Error('Invalid public score permissions. Nothing was loaded.');
      return value;
    },
    async save(eventId, roundId, playerId, holeNumber, score, etag, requestId, signal) {
      const value = await rawScores.save(eventId, roundId, playerId, holeNumber, score, etag, requestId, signal);
      if (value.round.permissions?.role !== 'public' || !isPublicScoreIdentity(value.change.recordedBy)
        || value.change.recordedBy.eventId !== eventId) {
        throw new Error('Invalid public save acknowledgement. The outcome is uncertain; retain this draft and request ID and refresh to review.');
      }
      return value;
    },
    history: denied, saveGames: denied,
  };
  return {
    setup, scores,
    events: {
      async list(signal, cursor, status = 'active') {
        if (status !== 'active' || cursor !== undefined && (!cursor || cursor.length > 2048)) throw new Error('Only active events are publicly available.');
        const query = new URLSearchParams();
        if (cursor) query.set('continuationToken', cursor);
        const value = await request(`events${query.size ? `?${query.toString()}` : ''}`, signal);
        if (!isEventPage(value) || value.events.some((event) => event.status !== 'active' || event.role !== 'viewer')) {
          throw new Error('Invalid public event list. Nothing was loaded.');
        }
        return value;
      },
    },
    leaderboard: {
      async load(eventId, signal) {
        const value = await readPrivateValue(request, `${path(eventId)}/leaderboard`, signal);
        if (!isEventLeaderboardView(value) || value.workspace.event.id !== eventId
          || value.workspace.publicAccess !== true || value.workspace.event.role !== 'viewer') throw new Error('Invalid public leaderboard.');
        return value;
      },
    },
    purse: {
      async load(eventId, signal) {
        const value = await readPrivateValue(request, `${path(eventId)}/purse`, signal);
        if (!isEventPurseView(value) || value.workspace.event.id !== eventId
          || value.workspace.publicAccess !== true || value.workspace.event.role !== 'viewer') throw new Error('Invalid public winnings response.');
        return value;
      },
      save: denied,
    },
  };
}
