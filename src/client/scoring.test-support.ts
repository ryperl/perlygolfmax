import { vi } from 'vitest';
import type { HoleScore, RoundScores, ScoreChange, ScoreWriteResult } from '../domain/scoring';
import type { ScoresClient } from './scoring';
import { fictionalEvent, fictionalId, fictionalPlayers, fictionalProfile } from './catalog.test-support';

export const fictionalRoundScores: RoundScores = {
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
  return {
    change,
    round: {
      ...round, setupLocked: true, lastUpdatedAt: change.recordedAt,
      cards: round.cards.map((card) => card.playerId === change.playerId ? {
        ...card, etag: 'card-v2', updatedAt: change.recordedAt,
        holes: card.holes.map((hole) => hole.number === change.holeNumber ? { ...hole, score: change.after } : hole),
      } : card),
    },
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
  };
}
