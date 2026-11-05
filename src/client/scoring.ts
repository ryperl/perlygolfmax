import { isEventRevision, isUuid } from '../contracts/events';
import { isGameWriteResult, isHoleScore, isRoundScores, isScoreHistoryPage, isScoreWriteResult } from '../contracts/scoring';
import { isRoundGameDefinitions } from '../contracts/games';
import type { RoundGameDefinition } from '../domain/games';
import { maximumGameConfigurationBytes, sameGameDefinitions } from '../domain/games';
import type { GameWriteResult, HoleScore, RoundScores, ScoreHistoryPage, ScoreWriteResult } from '../domain/scoring';
import { sameHoleScore } from '../domain/scoring';
import { createPrivateRequest, readPrivateValue, writePrivateValue } from './private-request';

export interface ScoresClient {
  readonly load: (eventId: string, roundId: string, signal: AbortSignal) => Promise<RoundScores>;
  readonly save: (eventId: string, roundId: string, playerId: string, holeNumber: number, score: HoleScore,
    etag: string | null, requestId: string, signal: AbortSignal) => Promise<ScoreWriteResult>;
  readonly history: (eventId: string, roundId: string, playerId: string, signal: AbortSignal, cursor?: string) => Promise<ScoreHistoryPage>;
  readonly saveGames: (eventId: string, roundId: string, games: readonly RoundGameDefinition[], etag: string | null,
    requestId: string, signal: AbortSignal) => Promise<GameWriteResult>;
}

export function createScoresClient(apiUrl: string, getToken: () => Promise<string>, send: typeof fetch = fetch,
  authorization: 'Bearer' | 'Tester' = 'Bearer'): ScoresClient {
  const request = createPrivateRequest(apiUrl, getToken, send, 4096, authorization);
  const gameRequest = createPrivateRequest(apiUrl, getToken, send, maximumGameConfigurationBytes, authorization);
  function path(eventId: string, roundId: string) {
    if (!isUuid(eventId) || !isUuid(roundId)) throw new Error('Invalid event or round identifier.');
    return `events/${encodeURIComponent(eventId)}/rounds/${encodeURIComponent(roundId)}`;
  }
  return {
    async load(eventId, roundId, signal) {
      const value = await readPrivateValue(request, `${path(eventId, roundId)}/scores`, signal);
      if (!isRoundScores(value) || value.permissions === undefined || value.eventId !== eventId || value.roundId !== roundId
        || value.cards.some((card) => card.etag !== null) && (!value.setupLocked || value.lastUpdatedAt === null)) throw new Error('Invalid owner scorecards response. Nothing was loaded.');
      return value;
    },
    async save(eventId, roundId, playerId, holeNumber, score, etag, requestId, signal) {
      const base = path(eventId, roundId);
      if (!isUuid(playerId) || !Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18
        || !isHoleScore(score) || etag !== null && !isEventRevision(etag) || !isUuid(requestId)) throw new Error('Invalid hole save request. Nothing was sent.');
      const value = await request(`${base}/players/${encodeURIComponent(playerId)}/holes/${String(holeNumber)}`, signal, {
        method: 'PUT', body: { score }, requestId, ...(etag === null ? { createOnly: true } : { etag }),
      });
      if (!isScoreWriteResult(value) || value.round.permissions === undefined || value.round.eventId !== eventId || value.round.roundId !== roundId
        || value.change.eventId !== eventId || value.change.roundId !== roundId || value.change.playerId !== playerId
        || value.change.holeNumber !== holeNumber || value.change.id !== requestId
        || value.change.expectedEtag !== etag || !sameHoleScore(value.change.after, score)
        || !value.round.setupLocked || value.round.lastUpdatedAt === null
        || !value.round.cards.some((card) => card.playerId === playerId && card.etag !== null)) {
        throw new Error('Invalid save acknowledgement. The outcome is uncertain; retain this draft and request ID and refresh to review.');
      }
      return value;
    },
    async history(eventId, roundId, playerId, signal, cursor) {
      const base = path(eventId, roundId);
      if (!isUuid(playerId) || cursor !== undefined && (cursor.length === 0 || cursor.length > 2048)) throw new Error('Invalid score history request.');
      const value = await request(`${base}/players/${encodeURIComponent(playerId)}/score-history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, signal);
      if (!isScoreHistoryPage(value) || value.changes.some((change) => change.eventId !== eventId || change.roundId !== roundId || change.playerId !== playerId)) {
        throw new Error('Invalid score history response.');
      }
      return value;
    },
    async saveGames(eventId, roundId, games, etag, requestId, signal) {
      const base = path(eventId, roundId);
      if (!isRoundGameDefinitions(games) || games.length === 0 || !isUuid(requestId)
        || etag !== null && !isEventRevision(etag)) throw new Error('Check the game settings. Nothing was sent.');
      const value = await writePrivateValue(gameRequest, `${base}/games`, signal, {
        method: 'PUT', body: { games }, requestId, ...(etag === null ? { createOnly: true } : { etag }),
      }, maximumGameConfigurationBytes);
      if (!isGameWriteResult(value) || value.round.permissions === undefined || value.round.eventId !== eventId || value.round.roundId !== roundId
        || value.change.id !== requestId || value.change.expectedEtag !== etag
        || !sameGameDefinitions(value.change.after, games)) {
        throw new Error('Invalid game save acknowledgement. The outcome is uncertain; keep this draft and refresh to review.');
      }
      return value;
    },
  };
}
