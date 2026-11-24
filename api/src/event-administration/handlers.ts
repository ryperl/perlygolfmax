import { app } from '@azure/functions';
import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { isEventRevision, isEventStatus, isRecord, isUuid } from '../../../src/contracts/events.js';
import type { VerifyIdentity } from '../identity.js';
import type { RequestLimiter } from '../limits.js';
import { ApiError } from '../errors.js';
import { failureDiagnostics } from '../diagnostics.js';
import { readJson, response } from '../http.js';
import type { TableEventAdministration } from './store.js';
import type { EventDeletionResult } from '../../../src/domain/event-administration.js';

/**
 * Progress is opt-in (`?progress=1`). Older frontends reject unknown fields, and the API
 * deploys before the frontend, so they must keep receiving the original response shape.
 */
function deletionResponse(result: EventDeletionResult, includeProgress: boolean): EventDeletionResult {
  if (includeProgress) return result;
  const { eventId, requestId, state } = result;
  return { eventId, requestId, state };
}

export interface EventAdministrationApi {
  readonly verify: VerifyIdentity;
  readonly limiter: RequestLimiter;
  readonly administration: TableEventAdministration;
}

export type EventAdministrationAction = 'quick-rounds' | 'restore' | 'delete' | 'deletions' | 'continue';

export function createEventAdministrationHandler(resolve: () => EventAdministrationApi, action: EventAdministrationAction) {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const { verify, limiter, administration } = resolve();
      const identity = await verify(request.headers.get('authorization'));
      const reading = action === 'quick-rounds' || action === 'deletions';
      if (request.method !== (reading ? 'GET' : 'POST')) return response(405, { code: 'METHOD_NOT_ALLOWED' });
      await limiter.check(identity, reading ? 'events-read' : 'events-manage');
      await limiter.check({ kind: 'public-browse' }, reading ? 'events-read' : 'events-manage');
      if (action === 'quick-rounds') {
        const status = request.query.get('status') ?? 'active';
        if (!isEventStatus(status)) throw new ApiError(400, 'INVALID_EVENT_STATUS');
        return response(200, await administration.listQuick(identity, status, request.query.get('cursor') ?? undefined));
      }
      if (action === 'deletions') {
        return response(200, await administration.listDeletions(identity, request.query.get('cursor') ?? undefined));
      }
      const eventId = request.params.id;
      const requestId = request.headers.get('Idempotency-Key');
      if (!isUuid(eventId) || !isUuid(requestId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
      await limiter.check({ kind: 'public-score', eventId }, 'events-manage');
      const body = await readJson(request);
      if (!isRecord(body) || Object.keys(body).some((key) => key !== 'confirmation')) throw new ApiError(400, 'INVALID_ADMINISTRATION_REQUEST');
      const includeProgress = request.query.get('progress') === '1';
      if (action === 'continue') {
        if (Object.keys(body).length) throw new ApiError(400, 'INVALID_ADMINISTRATION_REQUEST');
        const result = await administration.continueDeletion(identity, eventId, requestId);
        return response(200, deletionResponse(result, includeProgress));
      }
      const expected = request.headers.get('If-Match');
      if (!isEventRevision(expected) || expected.includes(',')) throw new ApiError(400, 'EVENT_REVISION_REQUIRED');
      if (action === 'restore') {
        if (Object.keys(body).length) throw new ApiError(400, 'INVALID_ADMINISTRATION_REQUEST');
        return response(200, await administration.restore(identity, eventId, expected, requestId));
      }
      if (typeof body.confirmation !== 'string' || body.confirmation.length > 100) throw new ApiError(400, 'EVENT_NAME_CONFIRMATION_REQUIRED');
      const result = await administration.deleteArchived(identity, eventId, expected, body.confirmation, requestId);
      return response(200, deletionResponse(result, includeProgress));
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 503;
      const code = error instanceof ApiError ? error.code : 'SERVICE_UNAVAILABLE';
      if (status >= 500) context.error('Event administration failed', { code, action, status, invocationId: context.invocationId, ...failureDiagnostics(error) });
      else context.warn('Event administration rejected', { code, action, status, invocationId: context.invocationId });
      return response(status, { code });
    }
  };
}

export function registerEventAdministration(resolve: () => EventAdministrationApi): void {
  const routes: readonly { readonly action: EventAdministrationAction; readonly route: string; readonly method: 'GET' | 'POST' }[] = [
    { action: 'quick-rounds', route: 'organizer/quick-rounds', method: 'GET' },
    { action: 'restore', route: 'organizer/events/{id}/restore', method: 'POST' },
    { action: 'delete', route: 'organizer/events/{id}/delete', method: 'POST' },
    { action: 'deletions', route: 'organizer/deletions', method: 'GET' },
    { action: 'continue', route: 'organizer/events/{id}/delete/continue', method: 'POST' },
  ];
  for (const route of routes) app.http(`event-administration-${route.action}`, {
    route: route.route, methods: [route.method], authLevel: 'anonymous',
    handler: createEventAdministrationHandler(resolve, route.action),
  });
}
