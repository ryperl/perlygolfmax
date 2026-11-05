import { isEventRevision, isUuid } from '../contracts/events';
import { isPursePlan, isPurseTieResolution } from '../contracts/purse';
import { isEventPurseView, isPurseWriteResult } from '../contracts/purse-settings';
import type { PursePlan, PurseTieResolution } from '../domain/purse';
import { samePursePlan, samePurseTieResolutions } from '../domain/purse';
import type { EventPurseView, PurseWriteResult } from '../domain/purse-settings';
import { maximumPurseRequestBytes } from '../domain/purse-settings';
import { createPrivateRequest, readPrivateValue, writePrivateValue } from './private-request';

export interface PurseClient {
  readonly load: (eventId: string, signal: AbortSignal) => Promise<EventPurseView>;
  readonly save: (eventId: string, plan: PursePlan, resolutions: readonly PurseTieResolution[],
    etag: string | null, requestId: string, signal: AbortSignal) => Promise<PurseWriteResult>;
}

export function createPurseClient(apiUrl: string, getToken: () => Promise<string>, send: typeof fetch = fetch): PurseClient {
  const request = createPrivateRequest(apiUrl, getToken, send, maximumPurseRequestBytes);
  const path = (eventId: string) => {
    if (!isUuid(eventId)) throw new Error('Invalid event identifier.');
    return `events/${encodeURIComponent(eventId)}/purse`;
  };
  return {
    async load(eventId, signal) {
      const value = await readPrivateValue(request, path(eventId), signal);
      if (!isEventPurseView(value) || value.workspace.event.id !== eventId) throw new Error('Invalid purse response. Nothing was loaded.');
      return value;
    },
    async save(eventId, plan, resolutions, etag, requestId, signal) {
      const target = path(eventId);
      if (!isPursePlan(plan) || plan.eventId !== eventId || !resolutions.every(isPurseTieResolution)
        || etag !== null && !isEventRevision(etag) || !isUuid(requestId)) throw new Error('Check the prize plan. Nothing was sent.');
      const value = await writePrivateValue(request, target, signal, {
        method: 'PUT', body: { plan, resolutions }, requestId, ...(etag === null ? { createOnly: true } : { etag }),
      }, maximumPurseRequestBytes);
      if (!isPurseWriteResult(value) || value.current.workspace.event.id !== eventId || value.change.id !== requestId
        || value.change.expectedEtag !== etag || !samePursePlan(value.change.after.plan, plan)
        || !samePurseTieResolutions(value.change.after.resolutions, resolutions)) {
        throw new Error('Invalid purse save acknowledgement. The outcome is uncertain; keep this draft and request ID and refresh to review.');
      }
      return value;
    },
  };
}
