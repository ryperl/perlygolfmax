import { isEventRevision, isUuid } from '../contracts/events';
import { isEventSetupInput, isEventWorkspace } from '../contracts/setup';
import type { EventSetupInput, EventWorkspace } from '../domain/setup';
import { maximumEventSetupBytes, sameOverallCompetition } from '../domain/setup';
import { createPrivateRequest, readPrivateValue, writePrivateValue } from './private-request';
import { sameTeeSelections } from '../domain/tees';
import { groupStartingHole } from '../domain/round-navigation';

export interface SetupClient {
  readonly load: (eventId: string, signal: AbortSignal) => Promise<EventWorkspace>;
  readonly save: (eventId: string, etag: string, input: EventSetupInput, signal: AbortSignal) => Promise<EventWorkspace>;
  readonly refreshIndices: (eventId: string, roundId: string, etag: string, requestId: string, signal: AbortSignal) => Promise<EventWorkspace>;
}

export function createSetupClient(apiUrl: string, getToken: () => Promise<string>, send: typeof fetch = fetch): SetupClient {
  const request = createPrivateRequest(apiUrl, getToken, send);
  const setupRequest = createPrivateRequest(apiUrl, getToken, send, maximumEventSetupBytes);
  return {
    async load(eventId, signal) {
      if (!isUuid(eventId)) throw new Error('Invalid event identifier.');
      const value = await readPrivateValue(request, `events/${encodeURIComponent(eventId)}/workspace`, signal);
      if (!isEventWorkspace(value) || value.event.id !== eventId) throw new Error('Invalid event workspace response.');
      return value;
    },
    async save(eventId, etag, input, signal) {
      if (!isUuid(eventId) || !isEventRevision(etag) || !isEventSetupInput(input)) throw new Error('Check setup: select at least 1 saved player, 1–8 rounds, an explicit course version and tee, and assign every player once to numbered groups (maximum 4 per group) with valid starting holes.');
      const value = await writePrivateValue(setupRequest, `events/${encodeURIComponent(eventId)}/workspace`, signal, { method: 'PUT', body: input, etag }, maximumEventSetupBytes);
      if (!isEventWorkspace(value) || value.event.id !== eventId
        || input.startDate !== undefined && input.startDate !== (value.event.startDate ?? '')
        || input.overallCompetition !== undefined && !sameOverallCompetition(input.overallCompetition, value.overallCompetition)
        || input.allowPerGolferTees !== undefined && input.allowPerGolferTees !== (value.allowPerGolferTees ?? false)
        || input.rounds.some((requested) => {
          const saved = value.rounds.find((round) => round.id === requested.id);
          return !saved || requested.teeTime !== undefined && requested.teeTime !== (saved.teeTime ?? '')
            || requested.startDate !== undefined && requested.startDate !== (saved.startDate ?? '')
            || requested.groups.some((group) => group.startingHole !== undefined
            && !saved.groups.some((other) => other.number === group.number
              && groupStartingHole(other, saved.teeProfile.holes) === group.startingHole))
            || requested.playerTeeSelections !== undefined && !sameTeeSelections(requested.playerTeeSelections,
              saved.playerTees?.map((entry) => ({ playerId: entry.playerId, teeProfileId: entry.profile.id })), saved.teeProfile.id);
        })) {
        throw new Error('Invalid saved workspace response. Refresh before retrying.');
      }
      return value;
    },
    async refreshIndices(eventId, roundId, etag, requestId, signal) {
      if (!isUuid(eventId) || !isUuid(roundId) || !isEventRevision(etag) || !isUuid(requestId)) throw new Error('Invalid captured setup-input refresh request.');
      const value = await request(`events/${encodeURIComponent(eventId)}/workspace/rounds/${encodeURIComponent(roundId)}/indices/refresh`, signal, {
        method: 'POST', body: {}, etag, requestId,
      });
      if (!isEventWorkspace(value) || value.event.id !== eventId || !value.rounds.some((round) => round.id === roundId)) {
        throw new Error('Invalid refreshed workspace response. Refresh the workspace before reviewing captured inputs.');
      }
      return value;
    },
  };
}
