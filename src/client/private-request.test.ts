import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrivateRequest, PrivateRequestError } from './private-request';

afterEach(() => { vi.useRealTimers(); });

describe('private catalog/setup transport', () => {
  it('bounds actual UTF-8 bytes before acquiring a token or sending a write', async () => {
    const send = vi.fn<typeof fetch>();
    const token = vi.fn().mockResolvedValue('fictional');
    const request = createPrivateRequest('https://fictional.example.test/api', token, send);
    await expect(request('catalog/players', new AbortController().signal, {
      method: 'POST', body: { displayName: '界'.repeat(1400) },
    })).rejects.toThrow('4096-byte UTF-8');
    expect(send).not.toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
  });
  it('accepts a bounded write and returns unknown JSON for the caller to validate', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"ok":true}'));
    const request = createPrivateRequest('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    await expect(request('catalog/players', new AbortController().signal, { method: 'POST', body: { displayName: 'Fictional' } })).resolves.toEqual({ ok: true });
    expect(send.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', credentials: 'omit' });
  });
  it('keeps the existing two-argument error constructor and bounds optional retry metadata', () => {
    expect(new PrivateRequestError(403, 'Denied.').retryAfterSeconds).toBeUndefined();
    expect(new PrivateRequestError(429, 'Limited.').retryAfterSeconds).toBe(60);
    expect(new PrivateRequestError(503, 'Unavailable.', 5.2).retryAfterSeconds).toBe(6);
    expect(new PrivateRequestError(429, 'Limited.', 10_000).retryAfterSeconds).toBe(3600);
    for (const invalid of [-1, NaN, Infinity]) {
      expect(new PrivateRequestError(429, 'Limited.', invalid).retryAfterSeconds).toBe(60);
      expect(new PrivateRequestError(503, 'Unavailable.', invalid).retryAfterSeconds).toBeUndefined();
    }
  });
  it.each([
    [undefined, 60], ['60', 60], ['120', 120], ['0', 0], [' 90 ', 90], ['9'.repeat(400), 3600],
    ['-1', 60], ['1.5', 60], ['tomorrow', 60], ['2026-01-01T00:02:00Z', 60],
    ['Thu, 01 Jan 2026 00:02:00 GMT', 120], ['Wed, 31 Dec 2025 23:59:00 GMT', 0],
    ['Wed, 01 Jan 2026 00:02:00 GMT', 60], ['Thu, 32 Jan 2026 00:02:00 GMT', 60],
    ['Thu, 01 Jan 2026 03:00:00 GMT', 3600],
  ] as const)('normalizes bounded Retry-After %s for a 429 response', async (header, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', {
      status: 429, headers: header === undefined ? {} : { 'Retry-After': header },
    }));
    const request = createPrivateRequest('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    await expect(request('events', new AbortController().signal)).rejects.toMatchObject({
      status: 429, retryAfterSeconds: expected,
    });
  });
  it('retains a service-unavailable retry minimum without inventing one for other statuses', async () => {
    const send = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 503, headers: { 'Retry-After': '90' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }));
    const request = createPrivateRequest('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    await expect(request('events', new AbortController().signal)).rejects.toMatchObject({ status: 503, retryAfterSeconds: 90 });
    await expect(request('events', new AbortController().signal)).rejects.toMatchObject({ status: 503, retryAfterSeconds: undefined });
  });
});
