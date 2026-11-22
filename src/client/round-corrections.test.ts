import { describe, expect, it, vi } from 'vitest';
import { createRoundCorrectionsClient } from './round-corrections';
import { fictionalId } from './catalog.test-support';
import { maximumGameConfigurationBytes } from '../domain/games';
import type { RoundCorrectionReadModel } from '../domain/round-corrections';

const eventId = fictionalId(1);
const roundId = fictionalId(2);

function correctionModel(): RoundCorrectionReadModel {
  return {
    eventId,
    roundId,
    eventEtag: 'event-v1',
    roundEtag: 'round-v1',
    gamesEtag: 'games-v1',
    allowPerGolferTees: false,
    teeProfileId: 101,
    compatibleTees: [{
      id: 101,
      name: 'Fictional Blue',
      category: 'Fictional category',
      holeCount: 18,
      totalYardage: 6300,
      totalMeters: 5760,
      totalPar: 72,
      strokeAllocation: true,
      shorter: false,
      eligibleSides: 'All',
      ratings: [
        { type: 'Total', course: 72, slope: 120, bogey: 95 },
        { type: 'Front', course: 36, slope: 120, bogey: 47.5 },
        { type: 'Back', course: 36, slope: 120, bogey: 47.5 },
      ],
      holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, sourceId: i + 1, length: 350, par: 4, allocation: i + 1 })),
    }],
    players: [{ playerId: fictionalId(10), displayName: 'Fictional Player', handicapIndex: null }],
    playerTeeSelections: [],
    groups: [{ number: 1, playerIds: [fictionalId(10)] }],
    gameTeams: [{ gameId: fictionalId(20), teams: [{ id: fictionalId(21), name: 'Fictional Team', playerIds: [fictionalId(10)] }] }],
    warnings: [{ code: 'purse-review-required', message: 'Review payouts.' }],
  };
}

function fixture(value: unknown, status = 200) {
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(value), { status }));
  const token = vi.fn().mockResolvedValue('fictional-token');
  const signal = new AbortController().signal;
  return { send, token, signal, client: createRoundCorrectionsClient('https://fictional.example.test/api', token, send) };
}

describe('round corrections client transport', () => {
  it('loads and saves correction payloads with strict response validation', async () => {
    const model = correctionModel();
    const saved = { applied: true, receiptId: fictionalId(99), model: { ...model, inputRevision: fictionalId(88) } };
    const send = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(model), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(saved), { status: 200 }));
    const token = vi.fn().mockResolvedValue('fictional-token');
    const client = createRoundCorrectionsClient('https://fictional.example.test/api', token, send);
    const signal = new AbortController().signal;

    expect(await client.load(eventId, roundId, signal)).toEqual(model);
    const request = {
      expected: { eventEtag: model.eventEtag, roundEtag: model.roundEtag, gamesEtag: model.gamesEtag ?? null, inputRevision: null },
      reason: 'Fictional correction.',
      correction: {
        teeProfileId: model.teeProfileId,
        groups: model.groups,
        players: model.players.map((entry) => ({ playerId: entry.playerId, handicapIndexValue: entry.handicapIndex?.value ?? null })),
        gameTeams: model.gameTeams,
      },
    };
    expect(await client.save(eventId, roundId, request, fictionalId(88), signal)).toEqual(saved);

    expect(send.mock.calls[0]?.[0]).toBe(`https://fictional.example.test/api/events/${eventId}/rounds/${roundId}/corrections?gameCalculations=2&wolfOrders=1&dotsHighLow=1`);
    expect(send.mock.calls[1]?.[0]).toBe(`https://fictional.example.test/api/events/${eventId}/rounds/${roundId}/corrections?gameCalculations=2&wolfOrders=1&dotsHighLow=1`);
    const init = send.mock.calls[1]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get('Idempotency-Key')).toBe(fictionalId(88));
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe(JSON.stringify(request));
  });

  it('rejects invalid identifiers, request shapes, and uncertain acknowledgements', async () => {
    const model = correctionModel();
    const f = fixture(model);

    await expect(f.client.load('bad-id', roundId, f.signal)).rejects.toThrow('Invalid correction target identifiers');
    await expect(f.client.save(eventId, roundId, {
      expected: { eventEtag: model.eventEtag, roundEtag: model.roundEtag, inputRevision: null },
      reason: '',
      correction: { teeProfileId: model.teeProfileId, groups: [], players: [] },
    }, fictionalId(88), f.signal)).rejects.toThrow('Invalid correction request');

    const mismatch = fixture({ applied: true, receiptId: fictionalId(99), model: { ...model, roundId: fictionalId(200) } });
    await expect(mismatch.client.save(eventId, roundId, {
      expected: { eventEtag: model.eventEtag, roundEtag: model.roundEtag, inputRevision: null },
      reason: 'Fictional correction.',
      correction: {
        teeProfileId: model.teeProfileId,
        groups: model.groups,
        players: model.players.map((entry) => ({ playerId: entry.playerId, handicapIndexValue: entry.handicapIndex?.value ?? null })),
      },
    }, fictionalId(88), mismatch.signal)).rejects.toThrow('Invalid correction acknowledgement');
  });

  it('uses staged private transport for large valid correction payloads', async () => {
    const model = correctionModel();
    const largePlayers = Array.from({ length: 80 }, (_, index) => ({
      playerId: fictionalId(1000 + index),
      handicapIndexValue: index % 2 ? '12.3' : null,
    }));
    const largeGroups = Array.from({ length: 20 }, (_, groupIndex) => ({
      number: groupIndex + 1,
      playerIds: largePlayers.slice(groupIndex * 4, groupIndex * 4 + 4).map((entry) => entry.playerId),
    }));
    const largeTeams = Array.from({ length: 10 }, (_, gameIndex) => ({
      gameId: fictionalId(2000 + gameIndex),
      teams: [
        { id: fictionalId(3000 + gameIndex * 2), name: `Team A ${String(gameIndex)}`, playerIds: largeGroups[0]?.playerIds ?? [] },
        { id: fictionalId(3001 + gameIndex * 2), name: `Team B ${String(gameIndex)}`, playerIds: largeGroups[1]?.playerIds ?? [] },
      ],
    }));
    const request = {
      expected: { eventEtag: model.eventEtag, roundEtag: model.roundEtag, gamesEtag: model.gamesEtag ?? null, inputRevision: null },
      reason: 'Fictional large correction payload.',
      correction: {
        teeProfileId: model.teeProfileId,
        groups: largeGroups,
        players: largePlayers,
        gameTeams: largeTeams,
      },
    };
    expect(new TextEncoder().encode(JSON.stringify(request)).byteLength).toBeGreaterThan(maximumGameConfigurationBytes);
    const result = { applied: true, receiptId: fictionalId(99), model: { ...model, inputRevision: fictionalId(98) } };
    const send = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('Missing fictional correction body');
      const body: unknown = JSON.parse(init.body);
      if (typeof body === 'object' && body !== null && 'privateUpload' in body) {
        const upload = body as { privateUpload: { id: string; index: number } };
        return Promise.resolve(new Response(JSON.stringify({ privateStaged: { id: upload.privateUpload.id, index: upload.privateUpload.index } }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(result), { status: 200 }));
    });
    const client = createRoundCorrectionsClient('https://fictional.example.test/api', () => Promise.resolve('fictional-token'), send);
    const signal = new AbortController().signal;
    expect(await client.save(eventId, roundId, request, fictionalId(88), signal)).toEqual(result);
    expect(send.mock.calls.length).toBeGreaterThan(2);
    expect(send.mock.calls.every((call) => typeof call[1]?.body === 'string'
      && new TextEncoder().encode(call[1].body).length <= maximumGameConfigurationBytes)).toBe(true);
  });
});
