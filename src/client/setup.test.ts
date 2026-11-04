import { describe, expect, it, vi } from 'vitest';
import { createSetupClient } from './setup';
import { EventChangedError } from './events';
import { fictionalEvent, fictionalId, fictionalSetup, fictionalWorkspace } from './catalog.test-support';
import type { EventSetupInput } from '../domain/setup';

describe('event workspace client', () => {
  it('reports an oversized multi-round draft explicitly without sending or broadening the request limit', async () => {
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
    await expect(client.save(fictionalEvent.id, 'v1', input, new AbortController().signal)).rejects.toThrow('4096-byte UTF-8 service limit');
    expect(send).not.toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
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
