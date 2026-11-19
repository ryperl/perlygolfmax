import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import type { PublicScoreIdentity } from '../../../src/domain/public-access.js';
import { isEventRevision, isRecord, isUuid } from '../../../src/contracts/events.js';
import { parseScoreWriteBody } from '../scoring/handlers.js';
import { ApiError } from '../errors.js';
import { readJson, response } from '../http.js';
import type { RequestLimiter } from '../limits.js';
import { privateReadResponse } from '../private-transport.js';
import type { TableWorkspaceStore } from '../setup/store.js';
import type { TableScoreStore } from '../scoring/store.js';
import type { TablePurseStore } from '../purse/store.js';
import type { TablePublicEventStore } from './store.js';
import { publicPurseSummary } from '../../../src/domain/public-purse.js';
import { publicLeaderboardSummary } from '../../../src/domain/public-leaderboard.js';
import { playerWinningsBreakdown } from '../../../src/domain/winnings-breakdown.js';
import { compactSkinsDetails, compactSkinsSummary } from '../../../src/contracts/compact-event-skins.js';
import type { TableQuickRoundStore } from '../quick-round/store.js';
import { maximumGameConfigurationBytes } from '../../../src/domain/games.js';
import { isRoundGameDefinitions } from '../../../src/contracts/games.js';
import { leanRoundScores, leanScoreWriteResult } from '../../../src/contracts/lean-round-scores.js';
import { murphyTransport, supportsMurphyTargets, supportsPareeTargets, supportsStringRules, supportsDotsCalls } from '../scoring/murphy-transport.js';
import { StringRulesClientUpdateRequired } from '../../../src/contracts/string-rules.js';
import { DotsCallsClientUpdateRequired } from '../../../src/domain/murphy-transport.js';

export type PublicAction = 'events' | 'workspace' | 'scores' | 'score-hole' | 'score-game-hole' | 'event-leaderboard' | 'purse' | 'games';
export interface PublicApi {
  readonly quickRounds?: TableQuickRoundStore;
  readonly publicEvents: TablePublicEventStore;
  readonly limiter: RequestLimiter;
  readonly workspace: TableWorkspaceStore;
  readonly scores: TableScoreStore;
  readonly purse: TablePurseStore;
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

function continuationToken(request: HttpRequest): string | undefined {
  const token = request.query.get('continuationToken');
  if (token === null) return undefined;
  if (!token || token.length > 2048 || !/^[A-Za-z0-9+/_=-]+$/.test(token)) throw new ApiError(400, 'INVALID_PAGE_CURSOR');
  try {
    const decoded: unknown = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    if (!isRecord(decoded) || typeof decoded.nextPartitionKey !== 'string' || decoded.nextPartitionKey.length > 1024
      || decoded.nextRowKey !== undefined && (typeof decoded.nextRowKey !== 'string' || decoded.nextRowKey.length > 1024)) {
      throw new Error('Invalid cursor');
    }
  } catch { throw new ApiError(400, 'INVALID_PAGE_CURSOR'); }
  return token;
}

export function createPublicHandler(resolveApi: () => PublicApi, action: PublicAction) {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const negotiated = supportsMurphyTargets(request);
    const pareeTargets = supportsPareeTargets(request);
    try {
      const stringRules = supportsStringRules(request);
      const dotsCalls = supportsDotsCalls(request);
      const send = (value: unknown) => response(200, murphyTransport(value, negotiated, pareeTargets, stringRules, dotsCalls));
      const read = (value: unknown) => privateReadResponse(request, murphyTransport(value, negotiated, pareeTargets, stringRules, dotsCalls));
      const api = resolveApi();
      if (request.method !== (action === 'score-hole' || action === 'score-game-hole' || action === 'games' ? 'PUT' : 'GET')) return response(405, { code: 'METHOD_NOT_ALLOWED' });
      if (action === 'events') {
        const identity = { kind: 'public-browse' as const };
        await api.limiter.check(identity, 'events-read');
        return response(200, await api.publicEvents.list(identity, continuationToken(request)));
      }
      if (!isUuid(request.params.id)) throw new ApiError(404, 'PUBLIC_EVENT_NOT_AVAILABLE');
      const eventId = request.params.id;
      const identity: PublicScoreIdentity = { kind: 'public-score', eventId };
      if (action === 'games') await api.limiter.check({ kind: 'public-browse' }, 'setup-write');
      await api.limiter.check(identity, action === 'score-hole' || action === 'score-game-hole' || action === 'games' ? 'scores-write' : action === 'workspace' ? 'setup-read' : 'scores-read');
      if (action === 'workspace') return response(200, privateReadResponse(request, await api.workspace.get(identity, eventId)));
      const chargeRead = (units: number) => api.limiter.check(identity, 'scores-read', units);
      if (action === 'event-leaderboard') {
        const view = request.query.get('view');
        const compact = request.query.get('format') === 'compact';
        if (view === 'event-skins-details') {
          const details = await api.scores.skinsDetails(identity, eventId, chargeRead);
          return response(200, privateReadResponse(request, compact ? compactSkinsDetails(details) : details));
        }
        const value = await api.scores.leaderboard(identity, eventId, chargeRead);
        const summary = view === 'overall' || view === 'event-skins' ? publicLeaderboardSummary(value, view) : value;
        return response(200, read(compact && 'kind' in summary && summary.kind === 'event-skins' ? compactSkinsSummary(summary) : summary));
      }
      if (action === 'purse') {
        const selectedPlayer = request.query.get('view') === 'player' ? uuid(request.query.get('playerId')) : null;
        const value = await api.purse.get(identity, eventId, chargeRead);
        if (selectedPlayer) {
          const detail = playerWinningsBreakdown(value, selectedPlayer);
          if (!detail) throw new ApiError(404, 'PLAYER_NOT_FOUND');
          return response(200, privateReadResponse(request, detail));
        }
        return response(200, read(request.query.get('view') === 'summary' ? publicPurseSummary(value) : value));
      }
      const roundId = uuid(request.params.roundId);
      const lean = request.query.get('format') === 'lean';
      if (action === 'scores') {
        const round = await api.scores.get(identity, eventId, roundId);
        return response(200, lean ? privateReadResponse(request, leanRoundScores(round, negotiated, pareeTargets, stringRules, dotsCalls)) : read(round));
      }
      if (action === 'games') {
        const requestId = uuid(request.headers.get('Idempotency-Key'));
        const etag = scoreRevision(request);
        const body = await readJson(request, maximumGameConfigurationBytes);
        const received = await api.scores.receiveGames(identity, eventId, roundId, body, etag, requestId, stringRules, dotsCalls);
        if (received.kind === 'part') return response(200, { privateStaged: { id: received.id, index: received.index } });
        if (!isRecord(received.value) || Object.keys(received.value).length !== 1
          || !isRoundGameDefinitions(received.value.games)) throw new ApiError(400, 'INVALID_GAME_SETUP');
        const result = await api.scores.saveGames(identity, eventId, roundId, received.value.games, etag, requestId, stringRules, dotsCalls);
        return lean ? response(200, { ...result, round: leanRoundScores(result.round, negotiated, pareeTargets, stringRules, dotsCalls) }) : send(result);
      }
      const playerId = uuid(request.params.playerId);
      const requestId = uuid(request.headers.get('Idempotency-Key'));
      const etag = scoreRevision(request);
      const hole = request.params.holeNumber;
      if (typeof hole !== 'string' || !/^(?:[1-9]|1[0-8])$/.test(hole)) throw new ApiError(400, 'INVALID_HOLE_NUMBER');
      let raw = await readJson(request, action === 'score-game-hole' ? maximumGameConfigurationBytes : undefined);
      if (action === 'score-game-hole') {
        const received = await api.scores.receiveGameScore(identity, eventId, roundId, playerId, Number(hole), raw, etag, requestId, stringRules, dotsCalls);
        if (received.kind === 'part') return response(200, { privateStaged: { id: received.id, index: received.index } });
        raw = received.value;
      }
      const body = parseScoreWriteBody(raw);
      if (action === 'score-game-hole' && !body.score.nassau?.length && !body.score.wolf?.length
        && !body.score.dots?.length && body.score.churchy?.version !== 3) throw new ApiError(400, 'INVALID_GAME_SCORE');
      const result = await api.scores.write(identity, eventId, roundId, playerId, Number(hole), body.score, etag, requestId, body.inputRevision, stringRules, dotsCalls);
      return lean ? response(200, leanScoreWriteResult(result, negotiated, pareeTargets, stringRules, dotsCalls)) : send(result);
    } catch (error) {
      const status = error instanceof ApiError || error instanceof StringRulesClientUpdateRequired || error instanceof DotsCallsClientUpdateRequired ? error.status : 503;
      const code = error instanceof ApiError || error instanceof StringRulesClientUpdateRequired || error instanceof DotsCallsClientUpdateRequired ? error.code : 'SERVICE_UNAVAILABLE';
      if (status >= 500) context.error('Public API failed', { code, invocationId: context.invocationId });
      else context.warn('Public API rejected', { code, status, invocationId: context.invocationId });
      return response(status, { code });
    }
  };
}
