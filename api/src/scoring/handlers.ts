import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { isEventRevision, isRecord, isUuid } from '../../../src/contracts/events.js';
import { isHoleScore } from '../../../src/contracts/scoring.js';
import { isRoundGameDefinitions } from '../../../src/contracts/games.js';
import { maximumGameConfigurationBytes } from '../../../src/domain/games.js';
import { failureDiagnostics } from '../diagnostics.js';
import { ApiError } from '../errors.js';
import { readCursor, readJson, response } from '../http.js';
import type { VerifyIdentity } from '../identity.js';
import type { RequestLimiter } from '../limits.js';
import type { TableScoreStore } from './store.js';
import { privateReadResponse } from '../private-transport.js';
import { isKpSelection } from '../../../src/contracts/kp.js';
import { isEventSkinsConfiguration } from '../../../src/contracts/event-skins.js';
import { calculateEventSkinsDetails } from '../../../src/domain/event-skins.js';
import type { HoleScore } from '../../../src/domain/scoring.js';

export interface ScoringApi {
  readonly verify: VerifyIdentity;
  readonly limiter: RequestLimiter;
  readonly scores: TableScoreStore;
}

export type ScoringAction = 'scores' | 'score-hole' | 'score-game-hole' | 'score-history' | 'round-games' | 'round-kp' | 'event-leaderboard' | 'event-skins-config';

function uuid(value: unknown): string {
  if (!isUuid(value)) throw new ApiError(400, 'INVALID_REQUEST_ID');
  return value;
}

function precondition(request: HttpRequest, code = 'SCORE_REVISION_REQUIRED'): string | null {
  const match = request.headers.get('If-Match');
  const none = request.headers.get('If-None-Match');
  if (match !== null && none === null && isEventRevision(match) && !match.includes(',')) return match;
  if (match === null && none === '*') return null;
  throw new ApiError(400, code);
}

export function parseScoreWriteBody(body: unknown): { readonly score: HoleScore; readonly inputRevision?: string | null } {
  if (!isRecord(body) || !Object.keys(body).every((key) => ['score', 'inputRevision'].includes(key))
    || !isHoleScore(body.score)
    || body.inputRevision !== undefined && body.inputRevision !== null && !isUuid(body.inputRevision)) {
    throw new ApiError(400, 'INVALID_HOLE_SCORE');
  }
  return { score: body.score, ...(body.inputRevision === undefined ? {} : { inputRevision: body.inputRevision }) };
}

export function createScoringHandler(resolveApi: () => ScoringApi, action: ScoringAction) {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const api = resolveApi();
      const identity = await api.verify(request.headers.get('authorization'));
      const write = action === 'score-hole' || action === 'score-game-hole' || action === 'round-games' || action === 'round-kp' || action === 'event-skins-config';
      await api.limiter.check(identity, write ? 'scores-write' : 'scores-read');
      if (request.method !== (write ? 'PUT' : 'GET')) return response(405, { code: 'METHOD_NOT_ALLOWED' });
      const eventId = uuid(request.params.id);
      if (action === 'event-skins-config') {
        const requestId = uuid(request.headers.get('Idempotency-Key'));
        const etag = precondition(request, 'EVENT_REVISION_REQUIRED');
        if (etag === null) throw new ApiError(400, 'EVENT_REVISION_REQUIRED');
        const body = await readJson(request);
        if (!isRecord(body) || Object.keys(body).length !== 1
          || body.configuration !== null && !isEventSkinsConfiguration(body.configuration)) {
          throw new ApiError(400, 'INVALID_EVENT_SKINS_SETUP');
        }
        return response(200, await api.scores.saveEventSkins(identity, eventId, body.configuration, etag, requestId));
      }
      if (action === 'event-leaderboard') {
        const value = await api.scores.leaderboard(identity, eventId,
          (units) => api.limiter.check(identity, 'scores-read', units));
        if (request.query.get('view') === 'event-skins-details') {
          return response(200, privateReadResponse(request, calculateEventSkinsDetails(value.workspace, value.roundScores)));
        }
        return response(200, privateReadResponse(request, value));
      }
      const roundId = uuid(request.params.roundId);
      if (action === 'scores') return response(200, privateReadResponse(request, await api.scores.get(identity, eventId, roundId)));
      if (action === 'round-kp') {
        const requestId = uuid(request.headers.get('Idempotency-Key'));
        const expectedEtag = precondition(request, 'KP_REVISION_REQUIRED');
        let body = await readJson(request, maximumGameConfigurationBytes);
        if (isRecord(body) && (Object.hasOwn(body, 'privateUpload') || Object.hasOwn(body, 'privateCommit'))) {
          const received = await api.scores.receiveKp(identity, eventId, roundId, body, expectedEtag, requestId);
          if (received.kind === 'part') return response(200, { privateStaged: { id: received.id, index: received.index } });
          body = received.value;
        }
        if (!isKpSelection(body)) throw new ApiError(400, 'INVALID_KP_SETUP');
        return response(200, await api.scores.saveKp(identity, eventId, roundId, body, expectedEtag, requestId));
      }
      if (action === 'round-games') {
        const requestId = uuid(request.headers.get('Idempotency-Key'));
        const expectedEtag = precondition(request, 'GAME_REVISION_REQUIRED');
        let body = await readJson(request, maximumGameConfigurationBytes);
        if (isRecord(body) && (Object.hasOwn(body, 'privateUpload') || Object.hasOwn(body, 'privateCommit'))) {
          const received = await api.scores.receiveGames(identity, eventId, roundId, body, expectedEtag, requestId);
          if (received.kind === 'part') return response(200, { privateStaged: { id: received.id, index: received.index } });
          body = received.value;
        }
        if (!isRecord(body) || Object.keys(body).length !== 1 || !isRoundGameDefinitions(body.games) || body.games.length === 0) {
          throw new ApiError(400, 'INVALID_GAME_SETUP');
        }
        return response(200, await api.scores.saveGames(identity, eventId, roundId, body.games, expectedEtag, requestId));
      }
      const playerId = uuid(request.params.playerId);
      if (action === 'score-history') return response(200, await api.scores.history(identity, eventId, roundId, playerId, readCursor(request)));
      const requestId = uuid(request.headers.get('Idempotency-Key'));
      const expectedEtag = precondition(request);
      const rawHole = request.params.holeNumber;
      if (typeof rawHole !== 'string' || !/^(?:[1-9]|1[0-8])$/.test(rawHole)) throw new ApiError(400, 'INVALID_HOLE_NUMBER');
      let body = await readJson(request, action === 'score-game-hole' ? maximumGameConfigurationBytes : undefined);
      if (action === 'score-game-hole') {
        const received = await api.scores.receiveGameScore(identity, eventId, roundId, playerId, Number(rawHole), body, expectedEtag, requestId);
        if (received.kind === 'part') return response(200, { privateStaged: { id: received.id, index: received.index } });
        body = received.value;
      }
      const parsed = parseScoreWriteBody(body);
      if (action === 'score-game-hole' && !parsed.score.nassau?.length && !parsed.score.wolf?.length
        && !parsed.score.dots?.length) throw new ApiError(400, 'INVALID_GAME_SCORE');
      return response(200, await api.scores.write(identity, eventId, roundId, playerId, Number(rawHole),
        parsed.score, expectedEtag, requestId, parsed.inputRevision));
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 503;
      const code = error instanceof ApiError ? error.code : 'SERVICE_UNAVAILABLE';
      if (status >= 500) context.error('Scoring API request failed', { code, invocationId: context.invocationId, ...failureDiagnostics(error) });
      else context.warn('Scoring API request rejected', { code, status, invocationId: context.invocationId });
      return response(status, { code });
    }
  };
}
