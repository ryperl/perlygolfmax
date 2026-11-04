import { vi } from 'vitest';
import type { ScoresClient } from '../../client/scoring';
import { EventChangedError } from '../../client/events';
import { fictionalChange, fictionalRoundScores, scoreResult } from '../../client/scoring.test-support';
import type { HoleScore, RoundScores, ScoreChange } from '../../domain/scoring';
import { sameHoleScore } from '../../domain/scoring';
import { cardFor, savedHole } from './entry-state';

export function memoryScores(initial: RoundScores = fictionalRoundScores) {
  let stored = initial;
  let revision = 0;
  const receipts = new Map<string, ScoreChange>();
  const client: ScoresClient = {
    load: vi.fn().mockImplementation(() => Promise.resolve(stored)),
    save: vi.fn().mockImplementation((_eventId: string, _roundId: string, playerId: string, holeNumber: number,
      score: HoleScore, etag: string | null, id: string) => {
      const replay = receipts.get(id);
      if (replay) {
        return sameHoleScore(replay.after, score) && replay.expectedEtag === etag
          ? Promise.resolve({ round: stored, change: replay }) : Promise.reject(new EventChangedError('Request identity changed.'));
      }
      const card = cardFor(stored, playerId);
      if (card.etag !== etag) return Promise.reject(new EventChangedError('Card changed. Refresh and review.'));
      const result = scoreResult({
        ...fictionalChange, eventId: stored.eventId, roundId: stored.roundId,
        playerId, holeNumber, after: score, expectedEtag: etag, id, before: savedHole(card, holeNumber),
      }, stored);
      revision++;
      stored = { ...result.round, cards: result.round.cards.map((item) => item.playerId === playerId
        ? { ...item, etag: `fictional-card-${String(revision)}` } : item) };
      receipts.set(id, result.change);
      return Promise.resolve({ round: stored, change: result.change });
    }),
    history: vi.fn().mockResolvedValue({ changes: [fictionalChange] }),
  };
  return { client, read: () => stored, replace: (value: RoundScores) => { stored = value; } };
}

export function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve(value: T) { if (!resolve) throw new Error('Uninitialized fictional promise'); resolve(value); } };
}
