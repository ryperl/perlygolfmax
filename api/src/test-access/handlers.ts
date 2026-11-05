import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { isCreateTesterLink, isRevokeTesterLink } from '../../../src/contracts/test-access.js';
import { isEventRevision, isRecord, isUuid } from '../../../src/contracts/events.js';
import { isHoleScore } from '../../../src/contracts/scoring.js';
import { ApiError } from '../errors.js';
import { readJson, response } from '../http.js';
import type { VerifyIdentity } from '../identity.js';
import type { RequestLimiter } from '../limits.js';
import { privateReadResponse } from '../private-transport.js';
import type { TableWorkspaceStore } from '../setup/store.js';
import type { TableScoreStore } from '../scoring/store.js';
import type { TableTesterAccessStore } from './store.js';

export type TesterAction = 'list' | 'create' | 'revoke' | 'workspace' | 'scores' | 'score-hole';
export interface TesterApi {
  readonly verify: VerifyIdentity;
  readonly limiter: RequestLimiter;
  readonly testers: TableTesterAccessStore;
  readonly workspace: TableWorkspaceStore;
  readonly scores: TableScoreStore;
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

export function createTesterHandler(resolveApi: () => TesterApi, action: TesterAction) {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const api = resolveApi();
      const guest = action === 'workspace' || action === 'scores' || action === 'score-hole';
      if (guest) {
        // This scheme never flows into the JWT verifier or fabricates an account identity.
        const eventId = request.params.id;
        if (!isUuid(eventId)) throw new ApiError(403, 'TESTER_ACCESS_ENDED');
        const identity = await api.testers.verify(eventId, request.headers.get('authorization'));
        await api.limiter.check(identity, action === 'score-hole' ? 'scores-write' : action === 'workspace' ? 'setup-read' : 'scores-read');
        if (request.method !== (action === 'score-hole' ? 'PUT' : 'GET')) return response(405, { code: 'METHOD_NOT_ALLOWED' });
        if (action === 'workspace') return response(200, privateReadResponse(request, await api.workspace.get(identity, eventId)));
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
      }
      const identity = await api.verify(request.headers.get('authorization'));
      await api.limiter.check(identity, action === 'list' ? 'events-read' : 'events-manage');
      const eventId = uuid(request.params.id);
      if (request.method !== (action === 'list' ? 'GET' : 'POST')) return response(405, { code: 'METHOD_NOT_ALLOWED' });
      if (action === 'list') return response(200, privateReadResponse(request, await api.testers.list(identity, eventId,
        () => api.limiter.check(identity, 'events-read'))));
      const requestId = uuid(request.headers.get('Idempotency-Key'));
      const etag = request.headers.get('If-Match');
      if (!isEventRevision(etag) || etag.includes(',') || request.headers.get('If-None-Match') !== null) throw new ApiError(400, 'EVENT_REVISION_REQUIRED');
      const body = await readJson(request);
      if (action === 'create') {
        if (!isCreateTesterLink(body)) throw new ApiError(400, 'INVALID_TESTER_LINK');
        return response(200, await api.testers.create(identity, eventId, body, etag, requestId));
      }
      if (!isRevokeTesterLink(body)) throw new ApiError(400, 'INVALID_TESTER_REVOCATION');
      return response(200, await api.testers.revoke(identity, eventId, body, etag, requestId));
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 503;
      const code = error instanceof ApiError ? error.code : 'SERVICE_UNAVAILABLE';
      // Only fixed classifications are logged, never headers, bodies, secrets, or raw provider errors.
      if (status >= 500) context.error('Tester API failed', { code, invocationId: context.invocationId });
      else context.warn('Tester API rejected', { code, status, invocationId: context.invocationId });
      return response(status, { code });
    }
  };
}
