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
import { murphyTransport, supportsMurphyTargets, supportsPareeTargets, supportsStringRules, supportsDotsCalls, supportsCategorySweeps, supportsChurchyNames, supportsSweepRules } from '../scoring/murphy-transport.js';
import { SweepRulesClientUpdateRequired } from '../../../src/contracts/sweep-rules.js';
import { ChurchyNamesClientUpdateRequired } from '../../../src/contracts/churchy-names.js';
import { CategorySweepsClientUpdateRequired } from '../../../src/contracts/category-sweeps.js';
import { StringRulesClientUpdateRequired } from '../../../src/contracts/string-rules.js';
import { DotsCallsClientUpdateRequired } from '../../../src/domain/murphy-transport.js';
import { GameHandicapClientUpdateRequired } from '../../../src/contracts/game-handicaps.js';
import { supportsGameHandicaps, supportsDotCoexistence } from '../scoring/murphy-transport.js';
import { DotsCoexistenceClientUpdateRequired } from '../../../src/contracts/dot-coexistence.js';
import { GameCalculationsClientUpdateRequired } from '../../../src/contracts/game-calculations.js';
import { WolfOrdersClientUpdateRequired } from '../../../src/contracts/wolf-orders.js';
import { supportsWolfOrders, supportsDotsHighLow, supportsDotsRulesV3 } from '../scoring/murphy-transport.js';
import { DotsRulesV3ClientUpdateRequired } from '../../../src/contracts/dots-rules-v3.js';
import { DotsHighLowClientUpdateRequired } from '../../../src/contracts/dots-high-low-rules.js';
import { PullyMurphyClientUpdateRequired } from '../../../src/contracts/pully-murphy.js';
import { supportsGameCalculations } from '../scoring/murphy-transport.js';

export interface PurseApi {
  readonly verify: VerifyIdentity;
  readonly limiter: RequestLimiter;
  readonly purse: TablePurseStore;
}

export function createPurseHandler(resolveApi: () => PurseApi) {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const negotiated = supportsMurphyTargets(request);
    const pareeTargets = supportsPareeTargets(request);
    try {
      const stringRules = supportsStringRules(request);
      const dotsCalls = supportsDotsCalls(request);
      const categorySweeps = supportsCategorySweeps(request);
      const churchyNames = supportsChurchyNames(request);
      const sweepRules = supportsSweepRules(request);
      const gameHandicaps = supportsGameHandicaps(request);
      const gameCalculations = supportsGameCalculations(request);
      const wolfOrders = supportsWolfOrders(request);
      const dotsHighLow = supportsDotsHighLow(request);
      const dotsRulesV3 = supportsDotsRulesV3(request);
      const dotCoexistence = supportsDotCoexistence(request);
      const api = resolveApi();
      const identity = await api.verify(request.headers.get('authorization'));
      await api.limiter.check(identity, request.method === 'PUT' ? 'scores-write' : 'scores-read');
      if (request.method !== 'GET' && request.method !== 'PUT') return response(405, { code: 'METHOD_NOT_ALLOWED' });
      const eventId = request.params.id;
      if (!isUuid(eventId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
      const chargeRead = (units: number) => api.limiter.check(identity, 'scores-read', units);
      if (request.method === 'GET') return response(200, privateReadResponse(request, murphyTransport(await api.purse.get(identity, eventId, chargeRead), negotiated, pareeTargets, stringRules, dotsCalls, categorySweeps, churchyNames, sweepRules, dotCoexistence, gameHandicaps, gameCalculations, wolfOrders, dotsHighLow, dotsRulesV3)));
      const match = request.headers.get('If-Match');
      const none = request.headers.get('If-None-Match');
      const expected = match !== null && none === null && isEventRevision(match) && !match.includes(',') ? match
        : match === null && none === '*' ? null : undefined;
      const requestId = request.headers.get('Idempotency-Key');
      if (expected === undefined) throw new ApiError(400, 'PURSE_REVISION_REQUIRED');
      if (!isUuid(requestId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
      const received = await api.purse.receive(identity, eventId, expected, requestId, await readJson(request, maximumPurseRequestBytes), stringRules, dotsCalls, chargeRead, categorySweeps, churchyNames, sweepRules, gameHandicaps, gameCalculations, wolfOrders, dotsHighLow, dotsRulesV3);
      if (received.kind === 'part') return response(200, { privateStaged: { id: received.id, index: received.index } });
      const body = received.value;
      if (!isRecord(body) || Object.keys(body).length !== 2 || !isPursePlan(body.plan)
        || !Array.isArray(body.resolutions) || !body.resolutions.every(isPurseTieResolution)) throw new ApiError(400, 'INVALID_PURSE_SETUP');
      const result = await api.purse.save(identity, eventId, body.plan, body.resolutions, expected, requestId, chargeRead, received.publication, stringRules, dotsCalls, categorySweeps, churchyNames, sweepRules, gameHandicaps, gameCalculations, wolfOrders, dotsHighLow, dotsRulesV3);
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maximumPrivateValueBytes) throw new ApiError(413, 'PRIVATE_VALUE_TOO_LARGE');
      return response(200, murphyTransport(result, negotiated, pareeTargets, stringRules, dotsCalls, categorySweeps, churchyNames, sweepRules, dotCoexistence, gameHandicaps, gameCalculations, wolfOrders, dotsHighLow, dotsRulesV3));
    } catch (error) {
      if (error instanceof GameCalculationsClientUpdateRequired || error instanceof PullyMurphyClientUpdateRequired || error instanceof WolfOrdersClientUpdateRequired || error instanceof DotsHighLowClientUpdateRequired || error instanceof DotsRulesV3ClientUpdateRequired) {
        context.warn('Purse API request rejected', { code: error.code, status: error.status, invocationId: context.invocationId });
        return response(error.status, { code: error.code });
      }
      const status = error instanceof ApiError || error instanceof StringRulesClientUpdateRequired || error instanceof DotsCallsClientUpdateRequired || error instanceof CategorySweepsClientUpdateRequired || error instanceof ChurchyNamesClientUpdateRequired || error instanceof SweepRulesClientUpdateRequired || error instanceof GameHandicapClientUpdateRequired || error instanceof DotsCoexistenceClientUpdateRequired ? error.status : 503;
      const code = error instanceof ApiError || error instanceof StringRulesClientUpdateRequired || error instanceof DotsCallsClientUpdateRequired || error instanceof CategorySweepsClientUpdateRequired || error instanceof ChurchyNamesClientUpdateRequired || error instanceof SweepRulesClientUpdateRequired || error instanceof GameHandicapClientUpdateRequired || error instanceof DotsCoexistenceClientUpdateRequired ? error.code : 'SERVICE_UNAVAILABLE';
      if (status >= 500) context.error('Purse API request failed', { code, action: "purse", status, invocationId: context.invocationId, ...failureDiagnostics(error) });
      else context.warn('Purse API request rejected', { code, status, invocationId: context.invocationId });
      return response(status, { code });
    }
  };
}
