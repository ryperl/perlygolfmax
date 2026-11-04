import { describe, expect, it, vi } from 'vitest';
import { createScoresClient } from './scoring';
import { fictionalChange, fictionalRoundScores, gameResult, scoreResult, withGameResults } from './scoring.test-support';
import { fictionalId } from './catalog.test-support';
import { EventChangedError, SessionExpiredError } from './events';
import { maximumExactHoleStrokes } from '../domain/scoring';
import type { RoundGameDefinition } from '../domain/games';
import { stablefordPoints } from '../domain/stableford';

const { eventId, roundId } = fictionalRoundScores;
const { playerId, id, after: score } = fictionalChange;
function fixture(value: unknown = fictionalRoundScores, status = 200) {
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(value), { status }));
  const token = vi.fn().mockResolvedValue('fictional-token');
  return { send, token, client: createScoresClient('https://fictional.example.test/api', token, send), signal: new AbortController().signal };
}
describe('owner scoring transport', () => {
  const game: RoundGameDefinition = {
    id: fictionalId(700), name: 'Fictional Stableford', preset: 'standard', basis: 'gross',
    handicapAllowancePercent: 95, points: stablefordPoints('standard'),
  };
  it.each([null, 'games-v1'])('saves game settings with exact base %s, request identity and no cookies', async (etag) => {
    const base = etag === null ? fictionalRoundScores : withGameResults(fictionalRoundScores, [game], etag);
    const result = gameResult([game], etag, id, base, 'games-v2');
    const { client, send, signal } = fixture(result);
    expect(await client.saveGames(eventId, roundId, [game], etag, id, signal)).toEqual(result);
    const init = send.mock.calls[0]?.[1];
    expect(send.mock.calls[0]?.[0]).toBe(`https://fictional.example.test/api/events/${eventId}/rounds/${roundId}/games`);
    expect(init).toMatchObject({ method: 'PUT', cache: 'no-store', credentials: 'omit', body: JSON.stringify({ games: [game] }) });
    const headers = new Headers(init?.headers);
    expect(headers.get('Idempotency-Key')).toBe(id);
    expect(headers.get('If-Match')).toBe(etag);
    expect(headers.get('If-None-Match')).toBe(etag === null ? '*' : null);
  });
  it('accepts a definitive game acknowledgement separately from a later configuration projection', async () => {
    const first = gameResult([game], null, id);
    const changed = { ...game, name: 'Fictional later game name' };
    const response = { ...first, round: withGameResults(first.round, [changed], 'games-v2') };
    const { client, signal } = fixture(response);
    expect(await client.saveGames(eventId, roundId, [game], null, id, signal)).toEqual(response);
  });
  it('rejects mismatched game acknowledgements and incorrect derived points even when totals are self-consistent', async () => {
    const first = gameResult([game], null, id, scoreResult().round);
    for (const change of [{ id: fictionalId(999) }, { expectedEtag: 'other' }, { after: [{ ...game, name: 'Wrong game' }] }]) {
      const { client, signal } = fixture({ ...first, change: { ...first.change, ...change } });
      await expect(client.saveGames(eventId, roundId, [game], null, id, signal)).rejects.toThrow('acknowledgement');
    }
    const view = first.round.games;
    if (!view) throw new Error('Missing fictional game result.');
    const invalid = { ...first.round, games: { ...view, results: view.results.map((result) => ({
      ...result, players: result.players.map((player) => player.playerId !== playerId ? player : {
        ...player, frontPoints: 3, totalPoints: 3,
        holes: player.holes.map((hole) => hole.number === 1 ? { ...hole, points: 3 } : hole),
      }),
    })) } };
    const { client, signal } = fixture(invalid);
    await expect(client.load(eventId, roundId, signal)).rejects.toThrow('response');
  });
  it('validates game input and service body limits before authenticating or sending', async () => {
    const { client, token, send, signal } = fixture();
    for (const games of [[], [game, game], [{ ...game, handicapAllowancePercent: 0 }]]) {
      await expect(client.saveGames(eventId, roundId, games, null, id, signal)).rejects.toThrow('settings');
    }
    const oversized = Array.from({ length: 16 }, (_, index) => ({ ...game, id: fictionalId(700 + index), name: 'F'.repeat(100) }));
    await expect(client.saveGames(eventId, roundId, oversized, null, id, signal)).rejects.toThrow('4096');
    expect(token).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it('loads authenticated, uncached owner scorecards without cookies', async () => {
    const { client, send, token, signal } = fixture();
    expect(await client.load(eventId, roundId, signal)).toEqual(fictionalRoundScores);
    expect(token).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(`https://fictional.example.test/api/events/${eventId}/rounds/${roundId}/scores`, expect.objectContaining({
      signal, cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer fictional-token' },
    }));
  });
  it.each([null, 'card-v1'])('conditionally saves using base %s and a definitive audit acknowledgement', async (etag) => {
    const result = scoreResult({ ...fictionalChange, expectedEtag: etag });
    const { client, send, signal } = fixture(result);
    await client.save(eventId, roundId, playerId, 1, score, etag, id, signal);
    const init = send.mock.calls[0]?.[1];
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe(JSON.stringify({ score }));
    if (typeof init?.body !== 'string') throw new Error('Expected serialized score body.');
    expect(new TextEncoder().encode(init.body).length).toBeLessThanOrEqual(4096);
    const headers = new Headers(init.headers);
    expect(headers.get('Idempotency-Key')).toBe(id);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('If-Match')).toBe(etag);
    expect(headers.get('If-None-Match')).toBe(etag === null ? '*' : null);
  });
  it('accepts a replay acknowledgement even if a later edit changed the current projection', async () => {
    const result = scoreResult();
    const later = { ...result, round: scoreResult({ ...fictionalChange, after: { kind: 'picked-up' } }).round };
    const { client, signal } = fixture(later);
    expect(await client.save(eventId, roundId, playerId, 1, score, null, id, signal)).toEqual(later);
  });
  it.each([
    { id: fictionalId(402) }, { eventId: fictionalId(99) }, { roundId: fictionalId(99) },
    { playerId: fictionalId(2) }, { holeNumber: 2 }, { after: { kind: 'picked-up' } }, { expectedEtag: 'other-v1' },
  ])('rejects mismatched audit acknowledgements %j, not just plausible projections', async (changed) => {
    const result = scoreResult();
    const { client, signal } = fixture({ ...result, change: { ...result.change, ...changed } });
    await expect(client.save(eventId, roundId, playerId, 1, score, null, id, signal)).rejects.toThrow('acknowledgement');
  });
  it.each([
    { ...fictionalRoundScores, eventId: fictionalId(99) },
    { ...fictionalRoundScores, cards: fictionalRoundScores.cards.map((card) => ({ ...card, updatedAt: fictionalChange.recordedAt })) },
    { ...fictionalRoundScores, cards: fictionalRoundScores.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole, score })) })) },
    { ...scoreResult().round, setupLocked: false },
    { ...scoreResult().round, lastUpdatedAt: null },
    { ...scoreResult().round, cards: scoreResult().round.cards.map((card) => ({ ...card, updatedAt: null })) },
  ])('fails closed on invalid round/card invariants', async (round) => {
    const { client, signal } = fixture(round);
    await expect(client.load(eventId, roundId, signal)).rejects.toThrow('response');
  });
  it('rejects a write result containing only a virtual target card', async () => {
    const { client, signal } = fixture({ change: fictionalChange, round: { ...fictionalRoundScores, setupLocked: true, lastUpdatedAt: fictionalChange.recordedAt } });
    await expect(client.save(eventId, roundId, playerId, 1, score, null, id, signal)).rejects.toThrow('acknowledgement');
  });
  it('validates identifiers, safe numbers and request revisions before authentication or I/O', async () => {
    const { client, token, send, signal } = fixture();
    await expect(client.load('bad', roundId, signal)).rejects.toThrow('identifier');
    for (const strokes of [0, -1, 1.5, NaN, Infinity, maximumExactHoleStrokes + 1]) {
      await expect(client.save(eventId, roundId, playerId, 1, { kind: 'strokes', strokes }, null, id, signal)).rejects.toThrow('Invalid');
    }
    await expect(client.save(eventId, roundId, 'bad', 1, score, null, id, signal)).rejects.toThrow('Invalid');
    await expect(client.save(eventId, roundId, playerId, 0, score, null, id, signal)).rejects.toThrow('Invalid');
    await expect(client.save(eventId, roundId, playerId, 1, score, '', id, signal)).rejects.toThrow('Invalid');
    await expect(client.save(eventId, roundId, playerId, 1, score, null, 'bad', signal)).rejects.toThrow('Invalid');
    expect(token).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it('encodes a paged history cursor and checks every change scope', async () => {
    const { client, signal, send } = fixture({ changes: [fictionalChange], continuationToken: 'next' });
    await client.history(eventId, roundId, playerId, signal, 'cursor/+=');
    expect(send.mock.calls[0]?.[0]).toContain('/score-history?cursor=cursor%2F%2B%3D');
    const other = fixture({ changes: [{ ...fictionalChange, playerId: fictionalId(2) }] });
    await expect(other.client.history(eventId, roundId, playerId, other.signal)).rejects.toThrow('history response');
    await expect(client.history(eventId, roundId, playerId, signal, 'x'.repeat(2049))).rejects.toThrow('request');
  });
  it.each([
    [401, SessionExpiredError, /Sign in again/], [409, EventChangedError, /Refresh/],
    [403, Error, /permission/], [429, Error, /Too many requests/], [503, Error, /503/],
  ] as const)('surfaces status %s without fixture fallback', async (status, errorClass, message) => {
    const { client, signal } = fixture({}, status);
    const result = client.load(eventId, roundId, signal);
    await expect(result).rejects.toBeInstanceOf(errorClass);
    await expect(result).rejects.toThrow(message);
  });
  it('aborts before auth and after token acquisition, and never accepts a late aborted response', async () => {
    const { client, token, send } = fixture();
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(client.load(eventId, roundId, cancelled.signal)).rejects.toThrow();
    expect(token).not.toHaveBeenCalled();
    const duringToken = new AbortController();
    token.mockImplementationOnce(() => { duringToken.abort(); return Promise.resolve('fictional'); });
    await expect(client.load(eventId, roundId, duringToken.signal)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    const duringFetch = new AbortController();
    send.mockImplementationOnce(() => { duringFetch.abort(); return Promise.resolve(new Response(JSON.stringify(fictionalRoundScores))); });
    await expect(client.load(eventId, roundId, duringFetch.signal)).rejects.toThrow();
  });
});
