import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { isEventRevision, isRecord, isUuid } from '../../../src/contracts/events.js';
import { isHoleScore } from '../../../src/contracts/scoring.js';
import { isRoundGameDefinitions } from '../../../src/contracts/games.js';
import { maximumGameConfigurationBytes } from '../../../src/domain/games.js';
import { failureDiagnostics } from '../diagnostics.js';
import { ApiError } from '../errors.js';
import { readCursor, readJson, response } from '../http.js';
import type { VerifyIdentity } from '../identity.js';
import type { RequestLimiter } from '../limits.js';
import type { TableScoreStore } from './store.js';
import { privateReadResponse } from '../private-transport.js';
import { isKpSelection } from '../../../src/contracts/kp.js';
import { isEventSkinsConfiguration } from '../../../src/contracts/event-skins.js';
import { calculateEventSkinsDetails } from '../../../src/domain/event-skins.js';
import type { HoleScore } from '../../../src/domain/scoring.js';
import { leanRoundScores, leanScoreWriteResult } from '../../../src/contracts/lean-round-scores.js';
import { murphyTransport, supportsMurphyTargets, supportsPareeTargets, supportsStringRules, supportsDotsCalls, supportsCategorySweeps, supportsChurchyNames, supportsSweepRules, supportsGameHandicaps } from './murphy-transport.js';
import { SweepRulesClientUpdateRequired } from '../../../src/contracts/sweep-rules.js';
import { ChurchyNamesClientUpdateRequired } from '../../../src/contracts/churchy-names.js';
import { CategorySweepsClientUpdateRequired } from '../../../src/contracts/category-sweeps.js';
import { StringRulesClientUpdateRequired } from '../../../src/contracts/string-rules.js';
import { DotsCallsClientUpdateRequired } from '../../../src/domain/murphy-transport.js';
import { DotsCoexistenceClientUpdateRequired } from '../../../src/contracts/dot-coexistence.js';
import { supportsDotCoexistence } from './murphy-transport.js';
import { GameHandicapClientUpdateRequired } from '../../../src/contracts/game-handicaps.js';
import { GameCalculationsClientUpdateRequired } from '../../../src/contracts/game-calculations.js';
import { PullyMurphyClientUpdateRequired } from '../../../src/contracts/pully-murphy.js';
import { supportsGameCalculations } from './murphy-transport.js';
import { supportsWolfOrders, supportsDotsHighLow } from './murphy-transport.js';
import { WolfOrdersClientUpdateRequired, requireWolfOrdersInValue } from '../../../src/contracts/wolf-orders.js';
import { DotsHighLowClientUpdateRequired, requireDotsHighLowInValue } from '../../../src/contracts/dots-high-low-rules.js';

export interface ScoringApi {
  readonly verify: VerifyIdentity;
  readonly limiter: RequestLimiter;
  readonly scores: TableScoreStore;
}

export type ScoringAction = 'scores' | 'score-hole' | 'score-game-hole' | 'score-history' | 'round-games' | 'round-kp' | 'event-leaderboard' | 'event-skins-config';

function uuid(value: unknown): string {
  if (!isUuid(value)) throw new ApiError(400, 'INVALID_REQUEST_ID');
  return value;
}

function precondition(request: HttpRequest, code = 'SCORE_REVISION_REQUIRED'): string | null {
  const match = request.headers.get('If-Match');
  const none = request.headers.get('If-None-Match');
  if (match !== null && none === null && isEventRevision(match) && !match.includes(',')) return match;
  if (match === null && none === '*') return null;
  throw new ApiError(400, code);
}

export function parseScoreWriteBody(body: unknown): { readonly score: HoleScore; readonly inputRevision?: string | null } {
  if (!isRecord(body) || !Object.keys(body).every((key) => ['score', 'inputRevision'].includes(key))
    || !isHoleScore(body.score)
    || body.inputRevision !== undefined && body.inputRevision !== null && !isUuid(body.inputRevision)) {
    throw new ApiError(400, 'INVALID_HOLE_SCORE');
  }
  return { score: body.score, ...(body.inputRevision === undefined ? {} : { inputRevision: body.inputRevision }) };
}

export function createScoringHandler(resolveApi: () => ScoringApi, action: ScoringAction) {
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
      const dotCoexistence = supportsDotCoexistence(request);
      const wolfOrders = supportsWolfOrders(request);
      const dotsHighLow = supportsDotsHighLow(request);
      const send = (value: unknown) => response(200, murphyTransport(value, negotiated, pareeTargets, stringRules, dotsCalls, categorySweeps, churchyNames, sweepRules, dotCoexistence, gameHandicaps, gameCalculations, wolfOrders, dotsHighLow));
      const read = (value: unknown) => privateReadResponse(request, murphyTransport(value, negotiated, pareeTargets, stringRules, dotsCalls, categorySweeps, churchyNames, sweepRules, dotCoexistence, gameHandicaps, gameCalculations, wolfOrders, dotsHighLow));
      const api = resolveApi();
      const identity = await api.verify(request.headers.get('authorization'));
      const write = action === 'score-hole' || action === 'score-game-hole' || action === 'round-games' || action === 'round-kp' || action === 'event-skins-config';
      await api.limiter.check(identity, write ? 'scores-write' : 'scores-read');
      if (request.method !== (write ? 'PUT' : 'GET')) return response(405, { code: 'METHOD_NOT_ALLOWED' });
      const eventId = uuid(request.params.id);
      if (action === 'event-skins-config') {
        const requestId = uuid(request.headers.get('Idempotency-Key'));
        const etag = precondition(request, 'EVENT_REVISION_REQUIRED');
        if (etag === null) throw new ApiError(400, 'EVENT_REVISION_REQUIRED');
        const body = await readJson(request);
        if (!isRecord(body) || Object.keys(body).length !== 1
          || body.configuration !== null && !isEventSkinsConfiguration(body.configuration)) {
          throw new ApiError(400, 'INVALID_EVENT_SKINS_SETUP');
        }
        return response(200, await api.scores.saveEventSkins(identity, eventId, body.configuration, etag, requestId));
      }
      if (action === 'event-leaderboard') {
        const value = await api.scores.leaderboard(identity, eventId,
          (units) => api.limiter.check(identity, 'scores-read', units));
        requireWolfOrdersInValue(value, wolfOrders);
        requireDotsHighLowInValue(value, dotsHighLow);
        if (request.query.get('view') === 'event-skins-details') {
          return response(200, read(calculateEventSkinsDetails(value.workspace, value.roundScores)));
        }
        return response(200, read(value));
      }
      const roundId = uuid(request.params.roundId);
      const lean = request.query.get('format') === 'lean';
      if (action === 'scores') {
        const round = await api.scores.get(identity, eventId, roundId);
        requireWolfOrdersInValue(round, wolfOrders);
        requireDotsHighLowInValue(round, dotsHighLow);
        return response(200, lean ? privateReadResponse(request, leanRoundScores(round, negotiated, pareeTargets, stringRules, dotsCalls, categorySweeps, churchyNames, sweepRules, dotCoexistence, gameHandicaps, gameCalculations, wolfOrders, dotsHighLow)) : read(round));
      }
      if (action === 'round-kp') {
        const requestId = uuid(request.headers.get('Idempotency-Key'));
        const expectedEtag = precondition(request, 'KP_REVISION_REQUIRED');
        let body = await readJson(request, maximumGameConfigurationBytes);
        if (isRecord(body) && (Object.hasOwn(body, 'privateUpload') || Object.hasOwn(body, 'privateCommit'))) {
          const received = await api.scores.receiveKp(identity, eventId, roundId, body, expectedEtag, requestId, stringRules, dotsCalls, categorySweeps, churchyNames, sweepRules, gameHandicaps, gameCalculations, wolfOrders, dotsHighLow);
          if (received.kind === 'part') return response(200, { privateStaged: { id: received.id, index: received.index } });
          body = received.value;
        }
        if (!isKpSelection(body)) throw new ApiError(400, 'INVALID_KP_SETUP');
        const result = await api.scores.saveKp(identity, eventId, roundId, body, expectedEtag, requestId, stringRules, dotsCalls, categorySweeps, churchyNames, sweepRules, gameHandicaps, gameCalculations, wolfOrders, dotsHighLow);
        return lean ? response(200, { ...result, round: leanRoundScores(result.round, negotiated, pareeTargets, stringRules, dotsCalls, categorySweeps, churchyNames, sweepRules, dotCoexistence, gameHandicaps, gameCalculations, wolfOrders, dotsHighLow) }) : send(result);
      }
      if (action === 'round-games') {
        const requestId = uuid(request.headers.get('Idempotency-Key'));
        const expectedEtag = precondition(request, 'GAME_REVISION_REQUIRED');
        let body = await readJson(request, maximumGameConfigurationBytes);
        if (isRecord(body) && (Object.hasOwn(body, 'privateUpload') || Object.hasOwn(body, 'privateCommit'))) {
          const received = await api.scores.receiveGames(identity, eventId, roundId, body, expectedEtag, requestId, stringRules, dotsCalls, categorySweeps, churchyNames, sweepRules, gameHandicaps, gameCalculations, wolfOrders, dotsHighLow);
          if (received.kind === 'part') return response(200, { privateStaged: { id: received.id, index: received.index } });
          body = received.value;
        }
        if (!isRecord(body) || Object.keys(body).length !== 1 || !isRoundGameDefinitions(body.games) || body.games.length === 0) {
          throw new ApiError(400, 'INVALID_GAME_SETUP');
        }
        const result = await api.scores.saveGames(identity, eventId, roundId, body.games, expectedEtag, requestId, stringRules, dotsCalls, categorySweeps, churchyNames, sweepRules, gameHandicaps, gameCalculations, wolfOrders, dotsHighLow);
        return lean ? response(200, { ...result, round: leanRoundScores(result.round, negotiated, pareeTargets, stringRules, dotsCalls, categorySweeps, churchyNames, sweepRules, dotCoexistence, gameHandicaps, gameCalculations, wolfOrders, dotsHighLow) }) : send(result);
      }
      const playerId = uuid(request.params.playerId);
      if (action === 'score-history') return send(await api.scores.history(identity, eventId, roundId, playerId, readCursor(request)));
      const requestId = uuid(request.headers.get('Idempotency-Key'));
      const expectedEtag = precondition(request);
      const rawHole = request.params.holeNumber;
      if (typeof rawHole !== 'string' || !/^(?:[1-9]|1[0-8])$/.test(rawHole)) throw new ApiError(400, 'INVALID_HOLE_NUMBER');
      let body = await readJson(request, action === 'score-game-hole' ? maximumGameConfigurationBytes : undefined);
      if (action === 'score-game-hole') {
        const received = await api.scores.receiveGameScore(identity, eventId, roundId, playerId, Number(rawHole), body, expectedEtag, requestId, stringRules, dotsCalls, categorySweeps, churchyNames, sweepRules, dotCoexistence, gameHandicaps, gameCalculations, wolfOrders, dotsHighLow);
        if (received.kind === 'part') return response(200, { privateStaged: { id: received.id, index: received.index } });
        body = received.value;
      }
      const parsed = parseScoreWriteBody(body);
      if (action === 'score-game-hole' && !parsed.score.nassau?.length && !parsed.score.wolf?.length
        && !parsed.score.dots?.length && parsed.score.churchy?.version !== 3) throw new ApiError(400, 'INVALID_GAME_SCORE');
      const result = await api.scores.write(identity, eventId, roundId, playerId, Number(rawHole),
        parsed.score, expectedEtag, requestId, parsed.inputRevision, stringRules, dotsCalls, categorySweeps, churchyNames, sweepRules, dotCoexistence, gameHandicaps, gameCalculations, wolfOrders, dotsHighLow);
      return lean ? response(200, leanScoreWriteResult(result, negotiated, pareeTargets, stringRules, dotsCalls, categorySweeps, churchyNames, sweepRules, dotCoexistence, gameHandicaps, gameCalculations, wolfOrders, dotsHighLow)) : send(result);
    } catch (error) {
      if (error instanceof GameCalculationsClientUpdateRequired || error instanceof PullyMurphyClientUpdateRequired || error instanceof WolfOrdersClientUpdateRequired || error instanceof DotsHighLowClientUpdateRequired) {
        context.warn('Scoring API request rejected', { code: error.code, status: error.status, invocationId: context.invocationId });
        return response(error.status, { code: error.code });
      }
      const status = error instanceof ApiError || error instanceof StringRulesClientUpdateRequired || error instanceof DotsCallsClientUpdateRequired || error instanceof CategorySweepsClientUpdateRequired || error instanceof ChurchyNamesClientUpdateRequired || error instanceof SweepRulesClientUpdateRequired || error instanceof DotsCoexistenceClientUpdateRequired || error instanceof GameHandicapClientUpdateRequired ? error.status : 503;
      const code = error instanceof ApiError || error instanceof StringRulesClientUpdateRequired || error instanceof DotsCallsClientUpdateRequired || error instanceof CategorySweepsClientUpdateRequired || error instanceof ChurchyNamesClientUpdateRequired || error instanceof SweepRulesClientUpdateRequired || error instanceof DotsCoexistenceClientUpdateRequired || error instanceof GameHandicapClientUpdateRequired ? error.code : 'SERVICE_UNAVAILABLE';
      if (status >= 500) context.error('Scoring API request failed', { code, action, status, invocationId: context.invocationId, ...failureDiagnostics(error) });
      else context.warn('Scoring API request rejected', { code, action, status, invocationId: context.invocationId });
      return response(status, { code });
    }
  };
}
