import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { isEventRevision, isRecord, isUuid } from '../../../src/contracts/events.js';
import { maximumEventSetupBytes } from '../../../src/domain/setup.js';
import { ApiError } from '../errors.js';
import { failureDiagnostics } from '../diagnostics.js';
import { readCursor, readJson, response } from '../http.js';
import { privateReadResponse } from '../private-transport.js';
import type { RequestLimiter } from '../limits.js';
import type { TableQuickRoundStore } from './store.js';

export type QuickRoundAction = 'courses' | 'players' | 'create-player' | 'version' | 'create' | 'workspace' | 'archive';
export interface QuickRoundApi {
  readonly limiter: RequestLimiter;
  readonly quickRounds?: TableQuickRoundStore;
}

export function createQuickRoundHandler(resolve: () => QuickRoundApi, action: QuickRoundAction) {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const { limiter, quickRounds: store } = resolve();
      if (!store) throw new ApiError(503, 'SERVICE_NOT_CONFIGURED');
      if (action === 'create-player') {
        if (request.method !== 'POST') return response(405, { code: 'METHOD_NOT_ALLOWED' });
        await limiter.check({ kind: 'public-browse' }, 'catalog-write');
        const requestId = request.headers.get('Idempotency-Key');
        if (!isUuid(requestId) || request.headers.get('If-Match') !== null
          || request.headers.get('If-None-Match') !== null) throw new ApiError(400, 'INVALID_REQUEST_ID');
        return response(200, await store.createPlayer(requestId, await readJson(request)));
      }
      const writing = action === 'create' || action === 'archive' || action === 'workspace' && request.method === 'PUT';
      if (request.method !== (writing ? 'PUT' : 'GET')) return response(405, { code: 'METHOD_NOT_ALLOWED' });
      await limiter.check({ kind: 'public-browse' }, action === 'archive' ? 'events-manage'
        : writing ? action === 'create' ? 'events-create' : 'setup-write' : 'setup-read');
      if (action === 'courses') return response(200, await store.courses(readCursor(request)));
      if (action === 'players') return response(200, await store.players(readCursor(request)));
      if (action === 'version') return response(200, privateReadResponse(request,
        await store.version(request.params.courseId ?? '', request.params.versionId ?? '')));
      const id = request.params.id;
      if (!isUuid(id)) throw new ApiError(400, 'INVALID_REQUEST_ID');
      await limiter.check({ kind: 'public-score', eventId: id }, action === 'archive' ? 'events-manage' : writing ? 'setup-write' : 'setup-read');
      if (!writing) return response(200, privateReadResponse(request, await store.load(id)));
      const requestId = request.headers.get('Idempotency-Key');
      if (!isUuid(requestId) || action === 'create' && requestId !== id) throw new ApiError(400, 'INVALID_REQUEST_ID');
      const match = request.headers.get('If-Match');
      const none = request.headers.get('If-None-Match');
      if (action === 'create' ? match !== null || none !== '*' : !isEventRevision(match) || match.includes(',') || none !== null) {
        throw new ApiError(400, 'EVENT_REVISION_REQUIRED');
      }
      if (action === 'archive') {
        const body = await readJson(request);
        if (!isRecord(body) || Object.keys(body).length) throw new ApiError(400, 'INVALID_ARCHIVE_REQUEST');
        return response(200, await store.archive(id, match ?? '', requestId));
      }
      const body = await store.receive(id, match, requestId, await readJson(request, maximumEventSetupBytes));
      if (body.kind === 'part') return response(200, { privateStaged: { id: body.id, index: body.index } });
      const value = action === 'create' ? await store.create(id, body.value) : await store.save(id, match ?? '', requestId, body.value);
      return response(200, { eventId: value.event.id, requestId, workspaceEtag: value.etag });
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 503;
      const code = error instanceof ApiError ? error.code : 'SERVICE_UNAVAILABLE';
      if (status >= 500) context.error('Quick round API failed', { code, action, status, invocationId: context.invocationId, ...failureDiagnostics(error) });
      else context.warn('Quick round API rejected', { code, action, status, invocationId: context.invocationId });
      return response(status, { code });
    }
  };
}
