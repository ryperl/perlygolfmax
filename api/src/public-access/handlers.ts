import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import type { PublicScoreIdentity } from '../../../src/domain/public-access.js';
import { isEventRevision, isRecord, isUuid } from '../../../src/contracts/events.js';
import { isHoleScore } from '../../../src/contracts/scoring.js';
import { ApiError } from '../errors.js';
import { readJson, response } from '../http.js';
import type { RequestLimiter } from '../limits.js';
import { privateReadResponse } from '../private-transport.js';
import type { TableWorkspaceStore } from '../setup/store.js';
import type { TableScoreStore } from '../scoring/store.js';
import type { TablePurseStore } from '../purse/store.js';
import type { TablePublicEventStore } from './store.js';

export type PublicAction = 'events' | 'workspace' | 'scores' | 'score-hole' | 'event-leaderboard' | 'purse';
export interface PublicApi {
  readonly publicEvents: TablePublicEventStore;
  readonly limiter: RequestLimiter;
  readonly workspace: TableWorkspaceStore;
  readonly scores: TableScoreStore;
  readonly purse: TablePurseStore;
}

function uuid(value: unknown): string {
  if (!isUuid(value)) throw new ApiError(400, 'INVALID_REQUEST_ID');
  return value;
}

function scoreRevision(request: HttpRequest): string | null {
  const match = request.headers.get('If-Match');
  const none = request.headers.get('If-None-Match');
  if (none === null && isEventRevision(match) && !match.includes(',')) return match;
  if (match === null && none === '*') return null;
  throw new ApiError(400, 'SCORE_REVISION_REQUIRED');
}

function continuationToken(request: HttpRequest): string | undefined {
  const token = request.query.get('continuationToken');
  if (token === null) return undefined;
  if (!token || token.length > 2048 || !/^[A-Za-z0-9+/_=-]+$/.test(token)) throw new ApiError(400, 'INVALID_PAGE_CURSOR');
  try {
    const decoded: unknown = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    if (!isRecord(decoded) || typeof decoded.nextPartitionKey !== 'string' || decoded.nextPartitionKey.length > 1024
      || decoded.nextRowKey !== undefined && (typeof decoded.nextRowKey !== 'string' || decoded.nextRowKey.length > 1024)) {
      throw new Error('Invalid cursor');
    }
  } catch { throw new ApiError(400, 'INVALID_PAGE_CURSOR'); }
  return token;
}

export function createPublicHandler(resolveApi: () => PublicApi, action: PublicAction) {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const api = resolveApi();
      if (request.method !== (action === 'score-hole' ? 'PUT' : 'GET')) return response(405, { code: 'METHOD_NOT_ALLOWED' });
      if (action === 'events') {
        const identity = { kind: 'public-browse' as const };
        await api.limiter.check(identity, 'events-read');
        return response(200, await api.publicEvents.list(identity, continuationToken(request)));
      }
      if (!isUuid(request.params.id)) throw new ApiError(404, 'PUBLIC_EVENT_NOT_AVAILABLE');
      const eventId = request.params.id;
      const identity: PublicScoreIdentity = { kind: 'public-score', eventId };
      await api.limiter.check(identity, action === 'score-hole' ? 'scores-write' : action === 'workspace' ? 'setup-read' : 'scores-read');
      if (action === 'workspace') return response(200, privateReadResponse(request, await api.workspace.get(identity, eventId)));
      const chargeRead = () => api.limiter.check(identity, 'scores-read');
      if (action === 'event-leaderboard') {
        return response(200, privateReadResponse(request, await api.scores.leaderboard(identity, eventId, chargeRead)));
      }
      if (action === 'purse') return response(200, privateReadResponse(request, await api.purse.get(identity, eventId, chargeRead)));
      const roundId = uuid(request.params.roundId);
      if (action === 'scores') return response(200, privateReadResponse(request, await api.scores.get(identity, eventId, roundId)));
      const playerId = uuid(request.params.playerId);
      const requestId = uuid(request.headers.get('Idempotency-Key'));
      const etag = scoreRevision(request);
      const hole = request.params.holeNumber;
      if (typeof hole !== 'string' || !/^(?:[1-9]|1[0-8])$/.test(hole)) throw new ApiError(400, 'INVALID_HOLE_NUMBER');
      const body = await readJson(request);
      if (!isRecord(body) || Object.keys(body).length !== 1 || !isHoleScore(body.score)) throw new ApiError(400, 'INVALID_HOLE_SCORE');
      return response(200, await api.scores.write(identity, eventId, roundId, playerId, Number(hole), body.score, etag, requestId));
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 503;
      const code = error instanceof ApiError ? error.code : 'SERVICE_UNAVAILABLE';
      if (status >= 500) context.error('Public API failed', { code, invocationId: context.invocationId });
      else context.warn('Public API rejected', { code, status, invocationId: context.invocationId });
      return response(status, { code });
    }
  };
}
