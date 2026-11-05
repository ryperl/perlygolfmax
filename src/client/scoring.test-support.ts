import { vi } from 'vitest';
import type { GameWriteResult, HoleScore, RoundScores, ScoreChange, ScoreWriteResult } from '../domain/scoring';
import type { RoundGameDefinition } from '../domain/games';
import { calculateGameResults } from '../domain/stableford';
import type { ScoresClient } from './scoring';
import { fictionalEvent, fictionalId, fictionalPlayers, fictionalProfile, fictionalWorkspace } from './catalog.test-support';

export const fictionalRoundScores: RoundScores = {
  permissions: { role: 'owner', writePlayerIds: fictionalPlayers.map((player) => player.id), canManageGames: true },
  eventId: fictionalEvent.id, eventName: fictionalEvent.name, eventStatus: 'active',
  roundId: fictionalId(70), roundName: 'Fictional opening round',
  courseName: 'Fictional Meadows', teeName: fictionalProfile.name, teeCategory: fictionalProfile.category,
  layout: fictionalProfile.holes, groups: [{ number: 1, playerIds: fictionalPlayers.map((player) => player.id) }],
  cards: fictionalPlayers.map((player) => ({
    playerId: player.id, displayName: player.displayName, etag: null, updatedAt: null,
    holes: fictionalProfile.holes.map((hole) => ({ number: hole.number, score: { kind: 'unplayed' } })),
  })),
  setupLocked: false, lastUpdatedAt: null,
};
export const fictionalChange: ScoreChange = {
  id: fictionalId(401), eventId: fictionalRoundScores.eventId, roundId: fictionalRoundScores.roundId,
  playerId: fictionalId(1), holeNumber: 1, before: { kind: 'unplayed' }, after: { kind: 'strokes', strokes: 4 },
  expectedEtag: null, recordedAt: '2026-01-02T00:00:00Z',
  recordedBy: { tenantId: fictionalId(201), objectId: fictionalId(202) },
};
export function scoreResult(change: ScoreChange = fictionalChange, round: RoundScores = fictionalRoundScores): ScoreWriteResult {
  const updated: RoundScores = {
      ...round, setupLocked: true, lastUpdatedAt: change.recordedAt,
      cards: round.cards.map((card) => card.playerId === change.playerId ? {
        ...card, etag: 'card-v2', updatedAt: change.recordedAt,
        holes: card.holes.map((hole) => hole.number === change.holeNumber ? { ...hole, score: change.after } : hole),
      } : card),
  };
  return { change, round: updated.games ? withGameResults(updated, updated.games.configuration.games, updated.games.configuration.etag ?? 'games-v1') : updated };
}
export function withGameResults(round: RoundScores, games: readonly RoundGameDefinition[], etag: string): RoundScores {
  const first = fictionalWorkspace.rounds[0];
  if (!first) throw new Error('Missing fictional round snapshot.');
  const snapshot = {
    ...first, id: round.roundId,
    teeProfile: { ...first.teeProfile, holes: round.layout, holeCount: round.layout.length },
    players: round.cards.map((card) => ({
      playerId: card.playerId, displayName: card.displayName,
      handicapIndex: first.players.find((player) => player.playerId === card.playerId)?.handicapIndex ?? null,
    })),
  };
  return { ...round, games: {
    configuration: { eventId: round.eventId, roundId: round.roundId, etag, games },
    results: calculateGameResults(games, snapshot, round.cards),
  } };
}
export function gameResult(games: readonly RoundGameDefinition[], expectedEtag: string | null, requestId: string,
  round: RoundScores = fictionalRoundScores, etag = 'games-v1'): GameWriteResult {
  return {
    round: withGameResults(round, games, etag),
    change: { id: requestId, eventId: round.eventId, roundId: round.roundId, expectedEtag,
      before: round.games?.configuration.games ?? [], after: games,
      recordedAt: fictionalChange.recordedAt, recordedBy: fictionalChange.recordedBy },
  };
}
export function fakeScores(): ScoresClient {
  let saved = fictionalRoundScores;
  return {
    load: vi.fn().mockImplementation(() => Promise.resolve(saved)),
    save: vi.fn().mockImplementation((_eventId: string, _roundId: string, playerId: string, holeNumber: number,
      score: HoleScore, etag: string | null, id: string) => {
      const result = scoreResult({
        ...fictionalChange, playerId, holeNumber, after: score, expectedEtag: etag, id,
        before: saved.cards.find((card) => card.playerId === playerId)?.holes.find((hole) => hole.number === holeNumber)?.score ?? { kind: 'unplayed' },
      }, saved);
      saved = result.round;
      return Promise.resolve(result);
    }),
    history: vi.fn().mockResolvedValue({ changes: [fictionalChange] }),
    saveGames: vi.fn().mockImplementation((_eventId: string, _roundId: string, games: readonly RoundGameDefinition[], etag: string | null, requestId: string) => {
      const result = gameResult(games, etag, requestId, saved);
      saved = result.round;
      return Promise.resolve(result);
    }),
  };
}
