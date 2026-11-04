import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import type { AccountIdentity } from '../../../src/domain/events.js';
import { isEventRevision, isEventStatus, isRecord, isUuid, readEventName } from '../../../src/contracts/events.js';
import { ApiError } from '../errors.js';
import type { VerifyIdentity } from '../identity.js';
import type { EventStore } from './store.js';
import type { RequestLimiter } from '../limits.js';
import { failureDiagnostics } from '../diagnostics.js';

export interface EventApi {
  readonly verify: VerifyIdentity;
  readonly store: EventStore;
  readonly canCreate: (identity: AccountIdentity) => boolean;
  readonly limiter: RequestLimiter;
}

function response(status: number, jsonBody: unknown): HttpResponseInit {
  return { status, jsonBody, headers: {
    'Cache-Control': 'no-store', 'Content-Type': 'application/json',
    ...(status === 429 ? { 'Retry-After': '60' } : {}),
    ...(status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}),
  } };
}

async function readJson(request: HttpRequest): Promise<unknown> {
  const maximum = 4096;
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new ApiError(413, 'REQUEST_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'INVALID_JSON');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array)) throw new ApiError(400, 'INVALID_JSON');
      bytes += value.byteLength;
      if (bytes > maximum) {
        await reader.cancel();
        throw new ApiError(413, 'REQUEST_TOO_LARGE');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const result: unknown = JSON.parse(text);
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'INVALID_JSON');
  } finally { reader.releaseLock(); }
}

export function createHandler(resolveApi: () => EventApi, action: 'me' | 'events' | 'event-status') {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const api = resolveApi();
      const identity = await api.verify(request.headers.get('authorization'));
      await api.limiter.check(identity, action === 'me' ? 'identity-read' : action === 'event-status' ? 'events-manage' : request.method === 'POST' ? 'events-create' : 'events-read');
      if (action === 'me') return response(200, { canCreateEvents: api.canCreate(identity) });
      if (action === 'event-status') {
        if (request.method !== 'PATCH') return response(405, { code: 'METHOD_NOT_ALLOWED' });
        const id = request.params.id;
        if (!isUuid(id)) throw new ApiError(400, 'INVALID_EVENT_ID');
        const etag = request.headers.get('If-Match');
        if (!isEventRevision(etag)) throw new ApiError(400, 'EVENT_REVISION_REQUIRED');
        if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError(415, 'JSON_REQUIRED');
        const body = await readJson(request);
        if (!isRecord(body) || !isEventStatus(body.status)) throw new ApiError(400, 'INVALID_EVENT_STATUS');
        return response(200, await api.store.setStatus(identity, id, body.status, etag));
      }
      if (request.method === 'GET') {
        const status = request.query.get('status') ?? 'active';
        if (!isEventStatus(status)) throw new ApiError(400, 'INVALID_EVENT_STATUS');
        const cursor = request.query.get('cursor') ?? undefined;
        if (cursor) {
          if (cursor.length > 2048 || !/^[A-Za-z0-9+/_=-]+$/.test(cursor)) throw new ApiError(400, 'INVALID_PAGE_CURSOR');
          try {
            const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
            if (!isRecord(decoded) || typeof decoded.nextPartitionKey !== 'string'
              || decoded.nextPartitionKey.length > 1024
              || (decoded.nextRowKey !== undefined && (typeof decoded.nextRowKey !== 'string' || decoded.nextRowKey.length > 1024))) {
              throw new Error('Invalid cursor');
            }
          } catch { throw new ApiError(400, 'INVALID_PAGE_CURSOR'); }
        }
        return response(200, await api.store.list(identity, cursor, status));
      }
      if (request.method !== 'POST') return response(405, { code: 'METHOD_NOT_ALLOWED' });
      if (!api.canCreate(identity)) throw new ApiError(403, 'EVENT_CREATION_FORBIDDEN');
      const id = request.headers.get('Idempotency-Key');
      if (!isUuid(id)) throw new ApiError(400, 'INVALID_REQUEST_ID');
      if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError(415, 'JSON_REQUIRED');
      const body = await readJson(request);
      const name = readEventName(body);
      if (!name) throw new ApiError(400, 'INVALID_EVENT_NAME');
      const result = await api.store.create(identity, { id, name, createdAt: new Date().toISOString() });
      return response(200, result);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 503;
      const code = error instanceof ApiError ? error.code : 'SERVICE_UNAVAILABLE';
      if (status >= 500) context.error('Event API request failed', {
        code, invocationId: context.invocationId, ...failureDiagnostics(error),
      });
      else context.warn('Event API request rejected', { code, status, invocationId: context.invocationId });
      return response(status, { code });
    }
  };
}
