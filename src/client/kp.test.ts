import { describe, expect, it, vi } from 'vitest';
import { createScoresClient } from './scoring';
import { fictionalChange, fictionalRoundScores, scoreResult } from './scoring.test-support';
import { fictionalId } from './catalog.test-support';
import { kpContext } from '../domain/kp';
import { isRecord } from '../contracts/events';
import { maximumGameConfigurationBytes } from '../domain/games';
import { leanRoundScores } from '../contracts/lean-round-scores';

describe('typed KP organizer transport', () => {
  it('accepts KP preserved on legacy raw writes but refuses a changed explicit-clear acknowledgement', async () => {
    const kp = { kind: 'measured', inches: 0, onGreen: true, measurementId: fictionalId(989) } as const;
    const result = scoreResult({ ...fictionalChange, after: { kind: 'strokes', strokes: 4, kp } });
    const send = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(result))));
    const client = createScoresClient('https://fictional.example.test/api', () => Promise.resolve('fictional-token'), send);
    const signal = new AbortController().signal;
    expect(await client.save(result.round.eventId, result.round.roundId, fictionalChange.playerId, 1,
      { kind: 'strokes', strokes: 4 }, null, fictionalChange.id, signal)).toEqual(result);
    await expect(client.save(result.round.eventId, result.round.roundId, fictionalChange.playerId, 1,
      { kind: 'strokes', strokes: 4, kp: null }, null, fictionalChange.id, signal)).rejects.toThrow('uncertain');
  });
  it('uses existing bounded staging for larger proof sets while keeping one logical KP operation identity', async () => {
    const selection = { version: 1 as const, context: 'F'.repeat(maximumGameConfigurationBytes + 1), status: 'open' as const, decisions: [] };
    const requestId = fictionalId(990);
    const round = { ...fictionalRoundScores, kpEnabled: true, kp: { ...selection, etag: 'kp-current' } };
    const send = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      if (typeof init?.body !== 'string') throw new Error('Missing fictional staged body');
      const body: unknown = JSON.parse(init.body);
      if (isRecord(body) && isRecord(body.privateUpload)) return Promise.resolve(new Response(JSON.stringify({
        privateStaged: { id: body.privateUpload.id, index: body.privateUpload.index },
      })));
      return Promise.resolve(new Response(JSON.stringify({ round: leanRoundScores(round), selection, requestId, expectedEtag: null })));
    });
    const client = createScoresClient('https://fictional.example.test/api', () => Promise.resolve('fictional-token'), send);
    if (!client.saveKp) throw new Error('Missing KP client');
    expect(await client.saveKp(round.eventId, round.roundId, selection, null, requestId, new AbortController().signal)).toEqual(round);
    expect(send.mock.calls.length).toBeGreaterThan(2);
    for (const [url, init] of send.mock.calls) {
      expect(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).toContain('/kp?format=lean');
      expect(typeof init?.body === 'string' && new TextEncoder().encode(init.body).length <= maximumGameConfigurationBytes).toBe(true);
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(requestId);
    }
  });
  it('requires an exact operation receipt rather than treating a current projection as acknowledgement', async () => {
    const selection = { version: 1 as const, context: kpContext(fictionalRoundScores.layout, fictionalRoundScores.cards.map((card) => card.playerId)),
      status: 'open' as const, decisions: [] };
    const requestId = fictionalId(991);
    const round = { ...fictionalRoundScores, kpEnabled: true, kp: { ...selection, etag: 'kp-current' } };
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ round, selection, expectedEtag: null, requestId })));
    const client = createScoresClient('https://fictional.example.test/api', () => Promise.resolve('fictional-token'), send);
    if (!client.saveKp) throw new Error('Missing KP client');
    const signal = new AbortController().signal;
    expect(await client.saveKp(round.eventId, round.roundId, selection, null, requestId, signal)).toEqual(round);
    const init = send.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('If-None-Match')).toBe('*');
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(requestId);
    expect(init).toMatchObject({ method: 'PUT', cache: 'no-store', credentials: 'omit', body: JSON.stringify(selection) });
    send.mockResolvedValueOnce(new Response(JSON.stringify({ round, selection, expectedEtag: null, requestId: fictionalId(992) })));
    await expect(client.saveKp(round.eventId, round.roundId, selection, null, requestId, signal)).rejects.toThrow('uncertain');
  });
});
