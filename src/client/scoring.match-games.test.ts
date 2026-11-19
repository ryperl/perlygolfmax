import { describe, expect, it, vi } from 'vitest';
import { createScoresClient } from './scoring';
import { isRecord } from '../contracts/events';
import { isScoreWriteResult } from '../contracts/scoring';
import { maximumGameConfigurationBytes } from '../domain/games';
import type { HoleScore, ScoreWriteResult } from '../domain/scoring';
import { matchGamesFixture } from '../domain/match-games.test-support';
import { strokeGameId } from '../domain/stroke-games.test-support';
import { nassauMatchId } from '../domain/nassau';
import { fictionalChange } from './scoring.test-support';
import { leanScoreWriteResult } from '../contracts/lean-round-scores';

describe('bounded game declaration score transport', () => {
  it('stages large commands on the dedicated scoring route with stable identity, then validates the complete acknowledgement', async () => {
    const f = matchGamesFixture();
    const games = Array.from({ length: 3 }, (_, index) => ({ ...f.nassau, id: strokeGameId(3000 + index) }));
    const score: HoleScore = { kind: 'strokes', strokes: 4, nassau: games.map((game, index) => ({
      number: 3, gameId: game.id, gameEtag: 'fictional-game-revision', outcomes: [],
      presses: [{ id: strokeGameId(3100 + index), matchId: nassauMatchId(game.id, 0, 1),
        parentBetId: `${nassauMatchId(game.id, 0, 1)}:front`, declaredAfterHole: 2, startHole: 3,
        pressingSide: 'b' as const, proof: `nassau-v1:${'a'.repeat(5000)}` }],
    })) };
    const playerId = f.ids[0];
    if (!playerId) throw new Error('Missing fictional player');
    const cards = f.cards.map((card) => card.playerId === playerId
      ? { ...card, etag: 'fictional-card-v2', holes: card.holes.map((hole) => hole.number === 3 ? { number: 3, score } : hole) } : card);
    const round = f.round(cards, games);
    const change = { ...fictionalChange, id: strokeGameId(3200), eventId: round.eventId, roundId: round.roundId,
      playerId, holeNumber: 3, before: { kind: 'strokes' as const, strokes: 4 }, after: score, expectedEtag: 'fictional-card-v1' };
    const result: ScoreWriteResult = { round, change };
    expect(isScoreWriteResult(result)).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify({ score })).length).toBeGreaterThan(maximumGameConfigurationBytes);
    let response: ScoreWriteResult = result;
    const send = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('Missing fictional declaration body');
      const body: unknown = JSON.parse(init.body);
      return Promise.resolve(new Response(JSON.stringify(isRecord(body) && isRecord(body.privateUpload)
        ? { privateStaged: { id: body.privateUpload.id, index: body.privateUpload.index } } : leanScoreWriteResult(response))));
    });
    const client = createScoresClient('https://fictional.example.test/api/public', () => Promise.resolve(''), send, 'None');
    const signal = new AbortController().signal;
    expect(await client.save(round.eventId, round.roundId, playerId, 3, score, change.expectedEtag, change.id, signal)).toEqual(result);
    expect(send.mock.calls.length).toBeGreaterThan(2);
    for (const [url, init] of send.mock.calls) {
      expect(url).toBe(`https://fictional.example.test/api/public/events/${round.eventId}/rounds/${round.roundId}/players/${playerId}/holes/3/games?format=lean&murphy=score-v1&paree=score-v1&stringRules=2&dotsCalls=score-v1`);
      expect(init?.credentials).toBe('omit');
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(change.id);
      expect(new Headers(init?.headers).get('If-Match')).toBe(change.expectedEtag);
      expect(typeof init?.body === 'string' && new TextEncoder().encode(init.body).length).toBeLessThanOrEqual(maximumGameConfigurationBytes);
    }
    response = { ...result, change: { ...change, after: { kind: 'strokes', strokes: 4 } } };
    await expect(client.save(round.eventId, round.roundId, playerId, 3, score, change.expectedEtag, change.id, signal)).rejects.toThrow('acknowledgement');
  });
});
