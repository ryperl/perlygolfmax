import { isEventRevision, isUuid } from '../contracts/events';
import { decodeRoundScores, isGameWriteResult, isHoleScore, isScoreHistoryPage, isScoreWriteResult } from '../contracts/scoring';
import { isRoundGameDefinitions } from '../contracts/games';
import type { RoundGameDefinition } from '../domain/games';
import { maximumGameConfigurationBytes, sameGameDefinitions } from '../domain/games';
import type { GameWriteResult, HoleScore, RoundScores, ScoreHistoryPage, ScoreWriteResult } from '../domain/scoring';
import { preserveScoreExtras, sameHoleScore } from '../domain/scoring';
import { scoreMatchesIntent } from '../domain/game-declarations';
import type { KpSelection } from '../domain/kp';
import { isKpSelection } from '../contracts/kp';
import { isRecord } from '../contracts/events';
import { sameJsonValue } from '../contracts/round-context';
import { createPrivateRequest, readPrivateValue, writePrivateValue } from './private-request';

export const scoringRulesQuery = 'murphy=score-v1&paree=score-v1&stringRules=2&dotsCalls=score-v1&categorySweeps=1&churchyNames=1&sweepRules=2&dotCoexistence=2&gameHandicaps=1&gameCalculations=2&wolfOrders=1&dotsHighLow=2&dotsRules=3';

function decodeRoundResult(value: unknown): unknown {
  return isRecord(value) ? { ...value, round: decodeRoundScores(value.round) } : value;
}

export interface ScoresClient {
  readonly saveKp?: (eventId: string, roundId: string, selection: KpSelection, etag: string | null,
    requestId: string, signal: AbortSignal) => Promise<RoundScores>;
  readonly load: (eventId: string, roundId: string, signal: AbortSignal) => Promise<RoundScores>;
  readonly save: (eventId: string, roundId: string, playerId: string, holeNumber: number, score: HoleScore,
    etag: string | null, requestId: string, signal: AbortSignal, inputRevision?: string | null) => Promise<ScoreWriteResult>;
  readonly history: (eventId: string, roundId: string, playerId: string, signal: AbortSignal, cursor?: string) => Promise<ScoreHistoryPage>;
  readonly saveGames: (eventId: string, roundId: string, games: readonly RoundGameDefinition[], etag: string | null,
    requestId: string, signal: AbortSignal) => Promise<GameWriteResult>;
}

export function createScoresClient(apiUrl: string, getToken: () => Promise<string>, send: typeof fetch = fetch,
  authorization: 'Bearer' | 'Tester' | 'None' = 'Bearer'): ScoresClient {
  const request = createPrivateRequest(apiUrl, getToken, send, 4096, authorization);
  const gameRequest = createPrivateRequest(apiUrl, getToken, send, maximumGameConfigurationBytes, authorization);
  function path(eventId: string, roundId: string) {
    if (!isUuid(eventId) || !isUuid(roundId)) throw new Error('Invalid event or round identifier.');
    return `events/${encodeURIComponent(eventId)}/rounds/${encodeURIComponent(roundId)}`;
  }
  return {
    async saveKp(eventId, roundId, selection, etag, requestId, signal) {
      if (!isKpSelection(selection) || !isUuid(requestId)
        || etag !== null && !isEventRevision(etag)) throw new Error('Invalid KP settings. Nothing was sent.');
      const value = await writePrivateValue(gameRequest, `${path(eventId, roundId)}/kp?format=lean&${scoringRulesQuery}`, signal, {
        method: 'PUT', body: selection, requestId, ...(etag === null ? { createOnly: true } : { etag }),
      }, maximumGameConfigurationBytes);
      const round = isRecord(value) ? decodeRoundScores(value.round) : null;
      if (!isRecord(value) || !round || round.eventId !== eventId || round.roundId !== roundId
        || value.requestId !== requestId || value.expectedEtag !== etag || !sameJsonValue(value.selection, selection)
        || round.kpEnabled !== true || !round.kp || round.permissions?.role !== 'owner') {
        throw new Error('KP outcome uncertain. Your changes are kept. Refresh saved data before retrying.');
      }
      return round;
    },
    async load(eventId, roundId, signal) {
      const value = decodeRoundScores(await readPrivateValue(request, `${path(eventId, roundId)}/scores?format=lean&${scoringRulesQuery}`, signal));
      if (!value || value.permissions === undefined || value.eventId !== eventId || value.roundId !== roundId
        || value.cards.some((card) => card.etag !== null) && (!value.setupLocked || value.lastUpdatedAt === null)) throw new Error('Invalid owner scorecards response. Nothing was loaded.');
      return value;
    },
    async save(eventId, roundId, playerId, holeNumber, score, etag, requestId, signal, inputRevision) {
      const base = path(eventId, roundId);
      if (!isUuid(playerId) || !Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18
        || !isHoleScore(score) || etag !== null && !isEventRevision(etag) || !isUuid(requestId)
        || inputRevision !== undefined && inputRevision !== null && !isUuid(inputRevision)) throw new Error('Invalid hole save request. Nothing was sent.');
      const hasDeclarations = Boolean(score.nassau?.length || score.wolf?.length || score.dots?.length || score.churchy?.version === 3);
      const target = `${base}/players/${encodeURIComponent(playerId)}/holes/${String(holeNumber)}${hasDeclarations ? '/games' : ''}?format=lean&${scoringRulesQuery}`;
      const options = {
        method: 'PUT', body: { score, ...(inputRevision === undefined ? {} : { inputRevision }) }, requestId, ...(etag === null ? { createOnly: true } : { etag }),
      } as const;
      const value = decodeRoundResult(hasDeclarations ? await writePrivateValue(gameRequest, target, signal, options, maximumGameConfigurationBytes)
        : await request(target, signal, options));
      if (!isScoreWriteResult(value) || value.round.permissions === undefined || value.round.eventId !== eventId || value.round.roundId !== roundId
        || value.change.eventId !== eventId || value.change.roundId !== roundId || value.change.playerId !== playerId
        || value.change.holeNumber !== holeNumber || value.change.id !== requestId
        || value.change.expectedEtag !== etag
        || value.change.expectedInputRevision !== (inputRevision ?? undefined)
        || !scoreMatchesIntent(value.change.after, score) || !sameHoleScore(value.change.after, preserveScoreExtras(score, value.change.after))
        || !value.round.setupLocked || value.round.lastUpdatedAt === null
        || !value.round.cards.some((card) => card.playerId === playerId && card.etag !== null)) {
        throw new Error('Invalid save acknowledgement. The outcome is uncertain; keep your changes and refresh saved data before retrying.');
      }
      return value;
    },
    async history(eventId, roundId, playerId, signal, cursor) {
      const base = path(eventId, roundId);
      if (!isUuid(playerId) || cursor !== undefined && (cursor.length === 0 || cursor.length > 2048)) throw new Error('Invalid score history request.');
      const value = await request(`${base}/players/${encodeURIComponent(playerId)}/score-history?${scoringRulesQuery}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, signal);
      if (!isScoreHistoryPage(value) || value.changes.some((change) => change.eventId !== eventId || change.roundId !== roundId || change.playerId !== playerId)) {
        throw new Error('Invalid score history response.');
      }
      return value;
    },
    async saveGames(eventId, roundId, games, etag, requestId, signal) {
      const base = path(eventId, roundId);
      if (!isRoundGameDefinitions(games) || games.length === 0 || !isUuid(requestId)
        || etag !== null && !isEventRevision(etag)) throw new Error('Check the game settings. Nothing was sent.');
      const value = decodeRoundResult(await writePrivateValue(gameRequest, `${base}/games?format=lean&${scoringRulesQuery}`, signal, {
        method: 'PUT', body: { games }, requestId, ...(etag === null ? { createOnly: true } : { etag }),
      }, maximumGameConfigurationBytes));
      if (!isGameWriteResult(value) || value.round.permissions === undefined || value.round.eventId !== eventId || value.round.roundId !== roundId
        || value.change.id !== requestId || value.change.expectedEtag !== etag
        || !sameGameDefinitions(value.change.after, games)) {
        throw new Error('Invalid game save acknowledgement. The outcome is uncertain; keep this draft and refresh to review.');
      }
      return value;
    },
  };
}
