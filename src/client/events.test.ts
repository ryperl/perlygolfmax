import { describe, expect, it, vi } from 'vitest';
import { createEventsClient, EventChangedError, SessionExpiredError } from './events';
import type { EventSummary } from '../domain/events';

const event: EventSummary = {
  id: '00000000-0000-4000-8000-000000000001', name: 'Fictional Open', createdAt: '2026-01-01',
  role: 'owner', status: 'active', etag: 'event-v1',
};

describe('event API client', () => {
  it('uses explicit bearer tokens, omits cookies and preserves mutation request identity', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: '00000000-0000-4000-8000-000000000001', name: 'Fictional Open', createdAt: '2026-01-01', role: 'owner', status: 'active', etag: 'fictional-v1',
    })));
    const client = createEventsClient('https://fictional.example.test/api', () => Promise.resolve('fictional-token'), send);
    await client.create('Fictional Open', 'fictional-request', new AbortController().signal);
    const [url, options] = send.mock.calls[0] ?? [];
    expect(url).toBe('https://fictional.example.test/api/events');
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', body: JSON.stringify({ name: 'Fictional Open' }) });
    const headers = new Headers(options?.headers);
    expect(headers.get('Authorization')).toBe('Bearer fictional-token');
    expect(headers.get('Idempotency-Key')).toBe('fictional-request');
  });
  it('never substitutes fictional data or an empty success for failures', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}'));
    const client = createEventsClient('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    const signal = new AbortController().signal;
    await expect(client.list(signal)).rejects.toBeInstanceOf(SessionExpiredError);
    await expect(client.list(signal)).rejects.toThrow('503');
    await expect(client.list(signal)).rejects.toThrow('Invalid event list response');
  });
  it('cancels work before sending an API request if token acquisition outlives the page', async () => {
    const controller = new AbortController();
    const send = vi.fn<typeof fetch>();
    const client = createEventsClient('https://fictional.example.test/api', () => {
      controller.abort();
      return Promise.resolve('fictional');
    }, send);
    await expect(client.list(controller.signal)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends conditional owner mutations and requests archived discovery explicitly', async () => {
    const send = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...event, status: 'archived', etag: 'event-v2' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [] })));
    const client = createEventsClient('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    const signal = new AbortController().signal;
    await expect(client.setStatus(event, 'archived', signal)).resolves.toMatchObject({ status: 'archived' });
    expect(send.mock.calls[0]).toEqual([
      `https://fictional.example.test/api/events/${event.id}/status`,
      expect.objectContaining({
        method: 'PATCH', credentials: 'omit', cache: 'no-store',
        body: '{"status":"archived"}',
        headers: { Authorization: 'Bearer fictional', 'Content-Type': 'application/json', 'If-Match': 'event-v1' },
      }),
    ]);
    await client.list(signal, 'fictional-cursor', 'archived');
    expect(send.mock.calls[1]?.[0]).toBe('https://fictional.example.test/api/events?status=archived&cursor=fictional-cursor');
  });

  it('requires refresh for a conflict and rejects malformed update responses', async () => {
    const send = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(event)));
    const client = createEventsClient('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    const signal = new AbortController().signal;
    await expect(client.setStatus(event, 'archived', signal)).rejects.toBeInstanceOf(EventChangedError);
    await expect(client.setStatus(event, 'archived', signal)).rejects.toThrow('Invalid event update response');
    await expect(client.setStatus({ ...event, etag: '*' }, 'archived', signal)).rejects.toThrow('Invalid event update');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('rejects mixed lifecycle lists and nonowner archived summaries', async () => {
    const send = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [{ ...event, status: 'archived' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [{ ...event, role: 'member', status: 'archived' }] })));
    const client = createEventsClient('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    const signal = new AbortController().signal;
    await expect(client.list(signal)).rejects.toThrow('Invalid event list response');
    await expect(client.list(signal, undefined, 'archived')).rejects.toThrow('Invalid event list response');
  });
});
