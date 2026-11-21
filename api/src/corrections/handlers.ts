import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { isUuid } from '../../../src/contracts/events.js';
import { isRoundCorrectionWriteRequest } from '../../../src/contracts/round-corrections.js';
import { ApiError } from '../errors.js';
import { failureDiagnostics } from '../diagnostics.js';
import { readJson, response } from '../http.js';
import type { VerifyIdentity } from '../identity.js';
import type { RequestLimiter } from '../limits.js';
import { privateReadResponse } from '../private-transport.js';
import type { TableWorkspaceStore } from '../setup/store.js';
import { supportsGameCalculations } from '../scoring/murphy-transport.js';
import { GameCalculationsClientUpdateRequired } from '../../../src/contracts/game-calculations.js';

export interface CorrectionsApi {
  readonly verify: VerifyIdentity;
  readonly limiter: RequestLimiter;
  readonly workspace: TableWorkspaceStore;
}

function uuid(value: unknown): string {
  if (!isUuid(value)) throw new ApiError(400, 'INVALID_REQUEST_ID');
  return value;
}

export function createCorrectionsHandler(resolveApi: () => CorrectionsApi, action: 'model' | 'write') {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const gameCalculations = supportsGameCalculations(request);
      const api = resolveApi();
      const identity = await api.verify(request.headers.get('authorization'));
      await api.limiter.check(identity, action === 'write' ? 'setup-write' : 'setup-read');
      const eventId = uuid(request.params.id);
      const roundId = uuid(request.params.roundId);
      if (request.method !== (action === 'write' ? 'PUT' : 'GET')) return response(405, { code: 'METHOD_NOT_ALLOWED' });
      if (action === 'model') {
        return response(200, privateReadResponse(request, await api.workspace.correctionModel(identity, eventId, roundId)));
      }
      const requestId = uuid(request.headers.get('Idempotency-Key'));
      const body = await readJson(request, 12 * 1024);
      if (!isRoundCorrectionWriteRequest(body)) throw new ApiError(400, 'INVALID_ROUND_CORRECTION');
      const value = await api.workspace.correctRound(identity, eventId, roundId, requestId, body, gameCalculations);
      return response(200, privateReadResponse(request, value));
    } catch (error) {
      const status = error instanceof ApiError || error instanceof GameCalculationsClientUpdateRequired ? error.status : 503;
      const code = error instanceof ApiError || error instanceof GameCalculationsClientUpdateRequired ? error.code : 'SERVICE_UNAVAILABLE';
      if (status >= 500) context.error('Corrections API request failed', { code, action, status, invocationId: context.invocationId, ...failureDiagnostics(error) });
      else context.warn('Corrections API request rejected', { code, action, status, invocationId: context.invocationId });
      return response(status, { code });
    }
  };
}
