import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import {
  isApproveInvitation, isClaimInvitation, isCreateInvitation, isManageInvitation,
} from '../../../src/contracts/admission.js';
import { isEventRevision, isUuid } from '../../../src/contracts/events.js';
import { ApiError } from '../errors.js';
import { readJson, response } from '../http.js';
import type { VerifyIdentity } from '../identity.js';
import type { RequestLimiter } from '../limits.js';
import { privateReadResponse } from '../private-transport.js';
import type { AdmissionStore } from './store.js';

export type AdmissionAction = 'list' | 'invite' | 'claim' | 'approve' | 'revoke' | 'status';
export interface AdmissionApi {
  readonly verify: VerifyIdentity;
  readonly store: AdmissionStore;
  readonly limiter: RequestLimiter;
}

export function createAdmissionHandler(resolveApi: () => AdmissionApi, action: AdmissionAction) {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const api = resolveApi();
      const identity = await api.verify(request.headers.get('authorization'));
      await api.limiter.check(identity, action === 'list' || action === 'status' ? 'events-read' : 'events-manage');
      const eventId = request.params.id;
      if (!isUuid(eventId)) throw new ApiError(400, 'INVALID_EVENT_ID');
      if (action === 'list' || action === 'status') {
        if (request.method !== 'GET') return response(405, { code: 'METHOD_NOT_ALLOWED' });
        if (action === 'list') return response(200, privateReadResponse(request, await api.store.list(identity, eventId)));
        const inviteId = request.query.get('inviteId');
        if (!isUuid(inviteId)) throw new ApiError(400, 'INVALID_INVITATION_ID');
        return response(200, await api.store.status(identity, eventId, inviteId));
      }
      if (request.method !== 'POST') return response(405, { code: 'METHOD_NOT_ALLOWED' });
      const requestId = request.headers.get('Idempotency-Key');
      if (!isUuid(requestId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
      const input = await readJson(request);
      if (action === 'claim') {
        if (!isClaimInvitation(input)) throw new ApiError(400, 'INVALID_INVITATION_CLAIM');
        return response(200, await api.store.claim(identity, eventId, input, requestId));
      }
      const etag = request.headers.get('If-Match');
      if (!isEventRevision(etag)) throw new ApiError(400, 'EVENT_REVISION_REQUIRED');
      if (action === 'invite') {
        if (!isCreateInvitation(input)) throw new ApiError(400, 'INVALID_INVITATION');
        return response(200, await api.store.invite(identity, eventId, input, etag, requestId));
      }
      if (action === 'approve') {
        if (!isApproveInvitation(input)) throw new ApiError(400, 'INVALID_APPROVAL');
        return response(200, await api.store.approve(identity, eventId, input, etag, requestId));
      }
      if (!isManageInvitation(input)) throw new ApiError(400, 'INVALID_REVOCATION');
      return response(200, await api.store.revoke(identity, eventId, input, etag, requestId));
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 503;
      const code = error instanceof ApiError ? error.code : 'SERVICE_UNAVAILABLE';
      // Neither request bodies, raw errors, nor invitation secrets belong in diagnostics.
      if (status >= 500) context.error('Admission API failed', { code, invocationId: context.invocationId });
      else context.warn('Admission API rejected', { code, status, invocationId: context.invocationId });
      return response(status, { code });
    }
  };
}
