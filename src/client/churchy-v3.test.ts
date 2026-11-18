import { describe, expect, it, vi } from 'vitest';
import { churchyV3Fixture } from '../domain/churchy-v3.test-support.js';
import { fictionalChange } from './scoring.test-support.js';
import { createScoresClient } from './scoring.js';
import { leanScoreWriteResult } from '../contracts/lean-round-scores.js';
import { strokeGameId } from '../domain/stroke-games.test-support.js';

describe('Churchie v3 declaration client transport', () => {
  it('uses the dedicated 12 KiB game route and validates coherent acknowledgements and retry identity', async () => {
    const f = churchyV3Fixture(9, 7);
    const churchy = { ...f.declaration(7, f.ids), players: [{ playerId: f.ids[0] ?? '', counts: { other: 2 },
      calls: Array.from({ length: 60 }, (_, index) => ({ id: strokeGameId(950 + index), kind: 'murphy' as const, result: 'pending' as const })) }] };
    const score = { kind: 'strokes' as const, strokes: 4, churchy };
    const round = f.round(f.cards.map((card, index) => index ? card : { ...card,
      holes: card.holes.map((hole) => hole.number === 7 ? { ...hole, score } : hole) }));
    const result = { round, change: { ...fictionalChange, eventId: round.eventId, roundId: round.roundId,
      playerId: f.ids[0] ?? '', holeNumber: 7, after: score } };
    const send = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(leanScoreWriteResult(result)))));
    const client = createScoresClient('https://fictional.example.test/api', () => Promise.resolve('fictional-token'), send, 'None');
    const signal = new AbortController().signal;
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await client.save(round.eventId, round.roundId, result.change.playerId, 7,
        score, result.change.expectedEtag, result.change.id, signal)).toEqual(result);
    }
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    expect(send.mock.calls[0]?.[0]).toContain('/holes/7/games?format=lean');
    const body = send.mock.calls[0]?.[1]?.body;
    expect(typeof body === 'string' ? body.length : 0).toBeGreaterThan(4096);
  });

  it('accepts server-authored late recovery without rewriting requested rank, rejects changed raw or derived data', async () => {
    const f = churchyV3Fixture(9);
    const request = { kind: 'strokes' as const, strokes: 4, churchy: f.declaration(1, f.ids) };
    const score = { ...request, churchy: { ...request.churchy, rotation: { playerIds: f.ids, recordedLate: true as const } } };
    const round = f.round(f.cards.map((card, index) => index ? card : { ...card,
      holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score } : hole) }));
    const result = { round, change: { ...fictionalChange, eventId: round.eventId, roundId: round.roundId,
      playerId: f.ids[0] ?? '', after: score } };
    const send = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(leanScoreWriteResult(result)))));
    const client = createScoresClient('https://fictional.example.test/api', () => Promise.resolve('fictional-token'), send);
    const signal = new AbortController().signal;
    expect(await client.save(round.eventId, round.roundId, result.change.playerId, 1, request,
      result.change.expectedEtag, result.change.id, signal)).toEqual(result);
    const wire = leanScoreWriteResult(result);
    const games = wire.round.round.games;
    const bad = { ...wire, round: { ...wire.round, round: { ...wire.round.round,
      games: games && { ...games, results: games.results.map((entry) => ({ ...entry,
        churchy: entry.churchy && { ...entry.churchy, holes: entry.churchy.holes.map((hole) => ({ ...hole, stake: 3 })) },
      })) },
    } } };
    send.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(bad))));
    await expect(client.save(round.eventId, round.roundId, result.change.playerId, 1, request,
      result.change.expectedEtag, result.change.id, signal)).rejects.toThrow('uncertain');
  });
});
