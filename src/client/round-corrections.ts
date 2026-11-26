import { isEventRevision, isUuid } from '../contracts/events';
import {
  isRoundCorrectionReadModel, isRoundCorrectionWriteRequest, isRoundCorrectionWriteResult,
} from '../contracts/round-corrections';
import type { RoundCorrectionReadModel, RoundCorrectionWriteRequest, RoundCorrectionWriteResult } from '../domain/round-corrections';
import { createPrivateRequest, readPrivateValue, writePrivateValue } from './private-request';
import { maximumGameConfigurationBytes } from '../domain/games';

export interface RoundCorrectionsClient {
  readonly load: (eventId: string, roundId: string, signal: AbortSignal) => Promise<RoundCorrectionReadModel>;
  readonly save: (eventId: string, roundId: string, request: RoundCorrectionWriteRequest,
    requestId: string, signal: AbortSignal) => Promise<RoundCorrectionWriteResult>;
}

export function createRoundCorrectionsClient(apiUrl: string, getToken: () => Promise<string>, send: typeof fetch = fetch): RoundCorrectionsClient {
  const request = createPrivateRequest(apiUrl, getToken, send, maximumGameConfigurationBytes);
  function path(eventId: string, roundId: string) {
    if (!isUuid(eventId) || !isUuid(roundId)) throw new Error('Invalid correction target identifiers.');
    return `events/${encodeURIComponent(eventId)}/rounds/${encodeURIComponent(roundId)}/corrections?gameCalculations=2&wolfOrders=1&dotsHighLow=2&dotsRules=3&nines=2`;
  }
  return {
    async load(eventId, roundId, signal) {
      const value = await readPrivateValue(request, path(eventId, roundId), signal);
      if (!isRoundCorrectionReadModel(value) || value.eventId !== eventId || value.roundId !== roundId) {
        throw new Error('Invalid correction model response. Nothing was loaded.');
      }
      return value;
    },
    async save(eventId, roundId, body, requestId, signal) {
      if (!isRoundCorrectionWriteRequest(body) || !isUuid(requestId)
        || !isEventRevision(body.expected.eventEtag) || !isEventRevision(body.expected.roundEtag)
        || body.expected.gamesEtag !== undefined && body.expected.gamesEtag !== null && !isEventRevision(body.expected.gamesEtag)
        || body.expected.inputRevision !== undefined && body.expected.inputRevision !== null && !isUuid(body.expected.inputRevision)) {
        throw new Error('Invalid correction request. Nothing was sent.');
      }
      const value = await writePrivateValue(request, path(eventId, roundId), signal, {
        method: 'PUT', body, requestId,
      }, maximumGameConfigurationBytes);
      if (!isRoundCorrectionWriteResult(value) || value.model.eventId !== eventId || value.model.roundId !== roundId) {
        throw new Error('Invalid correction acknowledgement. Outcome is uncertain; refresh before retrying.');
      }
      return value;
    },
  };
}
