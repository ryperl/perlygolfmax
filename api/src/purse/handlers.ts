import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { isEventRevision, isRecord, isUuid } from '../../../src/contracts/events.js';
import { isPursePlan, isPurseTieResolution } from '../../../src/contracts/purse.js';
import { maximumPurseRequestBytes } from '../../../src/domain/purse-settings.js';
import { maximumPrivateValueBytes } from '../../../src/contracts/private-values.js';
import { ApiError } from '../errors.js';
import { failureDiagnostics } from '../diagnostics.js';
import { readJson, response } from '../http.js';
import type { VerifyIdentity } from '../identity.js';
import type { RequestLimiter } from '../limits.js';
import { privateReadResponse } from '../private-transport.js';
import type { TablePurseStore } from './store.js';

export interface PurseApi {
  readonly verify: VerifyIdentity;
  readonly limiter: RequestLimiter;
  readonly purse: TablePurseStore;
}

export function createPurseHandler(resolveApi: () => PurseApi) {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const api = resolveApi();
      const identity = await api.verify(request.headers.get('authorization'));
      await api.limiter.check(identity, request.method === 'PUT' ? 'scores-write' : 'scores-read');
      if (request.method !== 'GET' && request.method !== 'PUT') return response(405, { code: 'METHOD_NOT_ALLOWED' });
      const eventId = request.params.id;
      if (!isUuid(eventId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
      const chargeRead = () => api.limiter.check(identity, 'scores-read');
      if (request.method === 'GET') return response(200, privateReadResponse(request, await api.purse.get(identity, eventId, chargeRead)));
      const match = request.headers.get('If-Match');
      const none = request.headers.get('If-None-Match');
      const expected = match !== null && none === null && isEventRevision(match) && !match.includes(',') ? match
        : match === null && none === '*' ? null : undefined;
      const requestId = request.headers.get('Idempotency-Key');
      if (expected === undefined) throw new ApiError(400, 'PURSE_REVISION_REQUIRED');
      if (!isUuid(requestId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
      const received = await api.purse.receive(identity, eventId, expected, requestId, await readJson(request, maximumPurseRequestBytes));
      if (received.kind === 'part') return response(200, { privateStaged: { id: received.id, index: received.index } });
      const body = received.value;
      if (!isRecord(body) || Object.keys(body).length !== 2 || !isPursePlan(body.plan)
        || !Array.isArray(body.resolutions) || !body.resolutions.every(isPurseTieResolution)) throw new ApiError(400, 'INVALID_PURSE_SETUP');
      const result = await api.purse.save(identity, eventId, body.plan, body.resolutions, expected, requestId, chargeRead, received.publication);
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maximumPrivateValueBytes) throw new ApiError(413, 'PRIVATE_VALUE_TOO_LARGE');
      return response(200, result);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 503;
      const code = error instanceof ApiError ? error.code : 'SERVICE_UNAVAILABLE';
      if (status >= 500) context.error('Purse API request failed', { code, invocationId: context.invocationId, ...failureDiagnostics(error) });
      else context.warn('Purse API request rejected', { code, status, invocationId: context.invocationId });
      return response(status, { code });
    }
  };
}
