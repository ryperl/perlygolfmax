import { describe, expect, it, vi } from 'vitest';
import { createSetupClient } from './setup';
import { EventChangedError } from './events';
import { fictionalEvent, fictionalId, fictionalSetup, fictionalWorkspace } from './catalog.test-support';
import type { EventSetupInput } from '../domain/setup';
import { maximumEventSetupBytes } from '../domain/setup';

describe('event workspace client', () => {
  it('requires event and round date changes/clears to be acknowledged, while allowing legacy omission', async () => {
    const scheduled = { ...fictionalWorkspace, event: { ...fictionalWorkspace.event, startDate: '2024-02-29' },
      rounds: fictionalWorkspace.rounds.map((round) => ({ ...round, startDate: '2026-11-06' })) };
    const send = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(scheduled))));
    const client = createSetupClient('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    const signal = new AbortController().signal;
    const input = { ...fictionalSetup, startDate: '2024-02-29', rounds: fictionalSetup.rounds.map((round) => ({ ...round, startDate: '2026-11-06' })) };
    await expect(client.save(fictionalEvent.id, 'v1', input, signal)).resolves.toEqual(scheduled);
    send.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ...scheduled, rounds: fictionalWorkspace.rounds }))));
    await expect(client.save(fictionalEvent.id, 'v1', input, signal)).rejects.toThrow('Invalid saved workspace');
    send.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ...scheduled, event: fictionalWorkspace.event }))));
    await expect(client.save(fictionalEvent.id, 'v1', input, signal)).rejects.toThrow('Invalid saved workspace');
    send.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(scheduled))));
    await expect(client.save(fictionalEvent.id, 'v1', fictionalSetup, signal)).resolves.toEqual(scheduled);
    const cleared = { ...input, startDate: '', rounds: input.rounds.map((round) => ({ ...round, startDate: '' })) };
    await expect(client.save(fictionalEvent.id, 'v1', cleared, signal)).rejects.toThrow('Invalid saved workspace');
    send.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(fictionalWorkspace))));
    await expect(client.save(fictionalEvent.id, 'v1', input, signal)).rejects.toThrow('Invalid saved workspace');
    await expect(client.save(fictionalEvent.id, 'v1', cleared, signal)).resolves.toEqual(fictionalWorkspace);
    send.mockClear();
    await expect(client.save(fictionalEvent.id, 'v1', { ...input, startDate: '2026-02-29' }, signal)).rejects.toThrow('Check setup');
    expect(send).not.toHaveBeenCalled();
  });
  it('requires tee time changes and clearing to be acknowledged by saved setup', async () => {
    const round = fictionalSetup.rounds[0];
    if (!round) throw new Error('Missing fictional round.');
    const scheduled = { ...fictionalWorkspace, rounds: fictionalWorkspace.rounds.map((snapshot) => ({ ...snapshot, teeTime: '08:30' })) };
    const send = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(scheduled))));
    const client = createSetupClient('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    const input = { ...fictionalSetup, rounds: [{ ...round, teeTime: '08:30' }] };
    await expect(client.save(fictionalEvent.id, 'v1', input, new AbortController().signal)).resolves.toEqual(scheduled);
    await expect(client.save(fictionalEvent.id, 'v1', { ...input, rounds: [{ ...round, teeTime: '' }] }, new AbortController().signal)).rejects.toThrow('Invalid saved workspace');
    send.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(fictionalWorkspace))));
    await expect(client.save(fictionalEvent.id, 'v1', input, new AbortController().signal)).rejects.toThrow('Invalid saved workspace');
    await expect(client.save(fictionalEvent.id, 'v1', { ...input, rounds: [{ ...round, teeTime: '' }] }, new AbortController().signal)).resolves.toEqual(fictionalWorkspace);
  });
  it('requires explicit group starts to be acknowledged rather than accepting a server that drops them', async () => {
    const round = fictionalSetup.rounds[0];
    if (!round) throw new Error('Missing fictional round.');
    const input = { ...fictionalSetup, rounds: [{ ...round, groups: round.groups.map((group) => ({ ...group, startingHole: 7 })) }] };
    const saved = { ...fictionalWorkspace, rounds: fictionalWorkspace.rounds.map((snapshot) => ({
      ...snapshot, groups: input.rounds[0]?.groups ?? [],
    })) };
    const send = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(saved))));
    const client = createSetupClient('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    await expect(client.save(fictionalEvent.id, 'v1', input, new AbortController().signal)).resolves.toEqual(saved);
    send.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(fictionalWorkspace))));
    await expect(client.save(fictionalEvent.id, 'v1', input, new AbortController().signal)).rejects.toThrow('Invalid saved workspace response');
    await expect(client.save(fictionalEvent.id, 'v1', { ...input, rounds: [{ ...round,
      groups: round.groups.map((group) => ({ ...group, startingHole: 1 })) }] }, new AbortController().signal)).resolves.toEqual(fictionalWorkspace);
  });
  it('explicitly refreshes a saved round with a stable request ID, exact workspace revision and empty body', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(fictionalWorkspace)));
    const client = createSetupClient('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    const round = fictionalWorkspace.rounds[0];
    if (!round) throw new Error('Missing fictional round.');
    const requestId = fictionalId(250);
    const signal = new AbortController().signal;
    await expect(client.refreshIndices(fictionalEvent.id, round.id, fictionalWorkspace.etag, requestId, signal)).resolves.toEqual(fictionalWorkspace);
    expect(send.mock.calls[0]?.[0]).toBe(`https://fictional.example.test/api/events/${fictionalEvent.id}/workspace/rounds/${round.id}/indices/refresh`);
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST', body: '{}', signal, credentials: 'omit', cache: 'no-store',
      headers: { 'If-Match': fictionalWorkspace.etag, 'Idempotency-Key': requestId },
    });
  });

  it('rejects invalid refresh inputs, mismatched workspaces, missing rounds and stale revisions without confirming capture changes', async () => {
    const send = vi.fn<typeof fetch>();
    const client = createSetupClient('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    const signal = new AbortController().signal;
    const round = fictionalWorkspace.rounds[0];
    if (!round) throw new Error('Missing fictional round.');
    await expect(client.refreshIndices(fictionalEvent.id, round.id, '*', fictionalId(250), signal)).rejects.toThrow('Invalid captured setup');
    expect(send).not.toHaveBeenCalled();
    send.mockResolvedValueOnce(new Response(JSON.stringify({ ...fictionalWorkspace, event: { ...fictionalEvent, id: fictionalId(99) } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...fictionalWorkspace, rounds: [] })))
      .mockResolvedValueOnce(new Response('{}', { status: 409 }));
    await expect(client.refreshIndices(fictionalEvent.id, round.id, 'v1', fictionalId(250), signal)).rejects.toThrow('Invalid refreshed workspace');
    await expect(client.refreshIndices(fictionalEvent.id, round.id, 'v1', fictionalId(250), signal)).rejects.toThrow('Invalid refreshed workspace');
    await expect(client.refreshIndices(fictionalEvent.id, round.id, 'v1', fictionalId(250), signal)).rejects.toBeInstanceOf(EventChangedError);
  });
  it('sends a bounded eight-round draft above4KiB using the dedicated setup budget', async () => {
    const send = vi.fn<typeof fetch>();
    const token = vi.fn().mockResolvedValue('fictional');
    const client = createSetupClient('https://fictional.example.test/api', token, send);
    const round = fictionalSetup.rounds[0];
    if (!round) throw new Error('Missing fictional round.');
    const ids = Array.from({ length: 8 }, (_, i) => fictionalId(i + 1));
    const input: EventSetupInput = {
      ...fictionalSetup, playerIds: ids,
      rounds: Array.from({ length: 8 }, (_, i) => ({
        ...round, id: fictionalId(70 + i), name: 'F'.repeat(100),
        groups: [{ number: 1, playerIds: ids.slice(0, 4) }, { number: 2, playerIds: ids.slice(4) }],
      })),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
    expect(bytes).toBeGreaterThan(4096);
    expect(bytes).toBeLessThanOrEqual(maximumEventSetupBytes);
    const first = fictionalWorkspace.rounds[0];
    if (!first) throw new Error('Missing fictional snapshot.');
    const roster = ids.map((playerId, index) => ({ playerId, displayName: `Fictional Golfer ${String(index + 1)}` }));
    const response = { ...fictionalWorkspace, roster, rounds: input.rounds.map((selected) => ({
      ...first, id: selected.id, name: selected.name, groups: selected.groups,
      players: roster.map((player) => ({ ...player, handicapIndex: null })),
    })) };
    send.mockResolvedValue(new Response(JSON.stringify(response)));
    await expect(client.save(fictionalEvent.id, 'v1', input, new AbortController().signal)).resolves.toEqual(response);
    expect(send.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(input));
    expect(token).toHaveBeenCalledOnce();
  });
  it('requires explicit competition settings to be confirmed and distinguishes disable from legacy omission', async () => {
    const config = { kind: 'stroke-play' as const, basis: 'net' as const, handicapAllowancePercent: 95 };
    const saved = { ...fictionalWorkspace, overallCompetition: config };
    const send = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(saved))));
    const client = createSetupClient('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    const signal = new AbortController().signal;
    await expect(client.save(fictionalEvent.id, 'v1', { ...fictionalSetup, overallCompetition: config }, signal)).resolves.toEqual(saved);
    await expect(client.save(fictionalEvent.id, 'v1', fictionalSetup, signal)).resolves.toEqual(saved);
    await expect(client.save(fictionalEvent.id, 'v1', { ...fictionalSetup, overallCompetition: null }, signal)).rejects.toThrow('saved workspace');
    send.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(fictionalWorkspace))));
    await expect(client.save(fictionalEvent.id, 'v1', { ...fictionalSetup, overallCompetition: config }, signal)).rejects.toThrow('saved workspace');
    await expect(client.save(fictionalEvent.id, 'v1', { ...fictionalSetup, overallCompetition: null }, signal)).resolves.toEqual(fictionalWorkspace);
  });
  it('loads the authorized event projection and conditionally saves explicit setup input', async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(fictionalWorkspace))));
    const client = createSetupClient('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    const signal = new AbortController().signal;
    await expect(client.load(fictionalEvent.id, signal)).resolves.toEqual(fictionalWorkspace);
    await expect(client.save(fictionalEvent.id, fictionalWorkspace.etag, fictionalSetup, signal)).resolves.toEqual(fictionalWorkspace);
    expect(send.mock.calls[1]).toEqual([
      `https://fictional.example.test/api/events/${fictionalEvent.id}/workspace`,
      expect.objectContaining({ method: 'PUT', cache: 'no-store', credentials: 'omit',
        body: JSON.stringify(fictionalSetup) }),
    ]);
    expect(new Headers(send.mock.calls[1]?.[1]?.headers).get('If-Match')).toBe(fictionalWorkspace.etag);
  });
  it('rejects incomplete or duplicate groups before sending and refuses unrelated event responses', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(fictionalWorkspace)));
    const client = createSetupClient('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    const signal = new AbortController().signal;
    await expect(client.save(fictionalEvent.id, 'v1', { ...fictionalSetup, rounds: [] }, signal)).rejects.toThrow('Check setup');
    const round = fictionalSetup.rounds[0];
    if (!round) throw new Error('Missing fictional round.');
    await expect(client.save(fictionalEvent.id, 'v1', { ...fictionalSetup, rounds: [{
      ...round, groups: [{ number: 1, playerIds: [fictionalId(1), fictionalId(1), fictionalId(2), fictionalId(3)] }],
    }] }, signal)).rejects.toThrow('Check setup');
    expect(send).not.toHaveBeenCalled();
    await expect(client.load(fictionalId(999), signal)).rejects.toThrow('Invalid event workspace');
  });
  it('requires refresh after stale revision and cancels before token acquisition when already aborted', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 409 }));
    const token = vi.fn().mockResolvedValue('fictional');
    const client = createSetupClient('https://fictional.example.test/api', token, send);
    await expect(client.save(fictionalEvent.id, 'old', fictionalSetup, new AbortController().signal)).rejects.toBeInstanceOf(EventChangedError);
    const controller = new AbortController(); controller.abort();
    await expect(client.load(fictionalEvent.id, controller.signal)).rejects.toThrow();
    expect(token).toHaveBeenCalledTimes(1);
  });
});
