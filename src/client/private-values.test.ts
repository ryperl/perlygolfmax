import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { isRecord } from '../contracts/events';
import { maximumPrivateWriteBytes, privateReadPartCharacters } from '../contracts/private-values';
import { createPrivateRequest, readPrivateValue, writePrivateValue } from './private-request';

const signal = () => new AbortController().signal;
const path = 'events/00000000-0000-4000-8000-000000000001/workspace';

function bodyText(body: BodyInit | null | undefined): string {
  if (typeof body !== 'string') throw new Error('Missing fictional JSON body');
  return body;
}

function urlText(url: string | URL | Request): string {
  return typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
}

describe('large private browser values', () => {
  it('continues at the same upload part after the 30-write quota boundary and respects Retry-After', async () => {
    vi.useFakeTimers();
    try {
      const indices: number[] = [];
      let limited = false;
      const send = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
        const body: unknown = JSON.parse(bodyText(init?.body));
        if (isRecord(body) && isRecord(body.privateUpload) && typeof body.privateUpload.index === 'number') {
          const index = body.privateUpload.index;
          indices.push(index);
          if (index === 30 && !limited) {
            limited = true;
            return Promise.resolve(new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }));
          }
          return Promise.resolve(new Response(JSON.stringify({ privateStaged: { id: body.privateUpload.id, index } })));
        }
        return Promise.resolve(new Response('{"fictional":"saved"}'));
      });
      const request = createPrivateRequest('https://fictional.example.test/api', () => Promise.resolve('fictional'), send, 12288);
      const transfer = writePrivateValue(request, path, signal(), { method: 'PUT', body: { fictional: 'F'.repeat(220_000) }, etag: 'v1' }, 12288);
      await vi.waitFor(() => { expect(vi.getTimerCount()).toBe(1); });
      expect(indices).toEqual(Array.from({ length: 31 }, (_, index) => index));
      await vi.advanceTimersByTimeAsync(59_000);
      expect(indices).toHaveLength(31);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await transfer).toEqual({ fictional: 'saved' });
      expect(indices.filter((index) => index === 0)).toHaveLength(1);
      expect(indices.filter((index) => index === 30)).toHaveLength(2);
      expect(indices.at(-1)).toBeGreaterThan(30);
    } finally { vi.useRealTimers(); }
  });

  it('retains the first 60 read pages over a read quota boundary and cancels quota waits without another request', async () => {
    vi.useFakeTimers();
    try {
      const text = JSON.stringify({ fictional: 'F'.repeat(privateReadPartCharacters * 62) });
      const sha256 = createHash('sha256').update(text).digest('hex');
      const parts = Math.ceil(text.length / privateReadPartCharacters);
      const indices: number[] = [];
      let limited = false;
      const send = vi.fn<typeof fetch>().mockImplementation((url) => {
        const index = Number(new URL(urlText(url)).searchParams.get('privatePart') ?? 0);
        indices.push(index);
        if (index === 60 && !limited) {
          limited = true;
          return Promise.resolve(new Response('{}', { status: 429, headers: { 'Retry-After': '1' } }));
        }
        return Promise.resolve(new Response(JSON.stringify({ privateRead: { sha256, index, parts, bytes: text.length,
          content: text.slice(index * privateReadPartCharacters, (index + 1) * privateReadPartCharacters) } })));
      });
      const request = createPrivateRequest('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
      const transfer = readPrivateValue(request, path, signal());
      await vi.waitFor(() => { expect(vi.getTimerCount()).toBe(1); });
      expect(indices.at(-1)).toBe(60);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await transfer).toEqual(JSON.parse(text));
      expect(indices.filter((index) => index === 0)).toHaveLength(1);
      expect(indices.filter((index) => index === 60)).toHaveLength(2);

      const controller = new AbortController();
      const limitedSend = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }));
      const limitedRequest = createPrivateRequest('https://fictional.example.test/api', () => Promise.resolve('fictional'), limitedSend, 12288);
      const cancelled = expect(writePrivateValue(limitedRequest, path, controller.signal,
        { method: 'PUT', body: { fictional: 'F'.repeat(20_000) } }, 12288)).rejects.toThrow();
      await vi.waitFor(() => { expect(vi.getTimerCount()).toBe(1); });
      controller.abort();
      await cancelled;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(limitedSend).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it('sends bounded parts with unchanged preconditions and retries an identical setup operation with the same publication ID', async () => {
    const sent: unknown[] = [];
    const send = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      const body: unknown = JSON.parse(bodyText(init?.body));
      sent.push(body);
      if (isRecord(body) && isRecord(body.privateUpload)) return Promise.resolve(new Response(JSON.stringify({
        privateStaged: { id: body.privateUpload.id, index: body.privateUpload.index },
      })));
      return Promise.resolve(new Response(JSON.stringify({ fictional: 'saved' })));
    });
    const request = createPrivateRequest('https://fictional.example.test/api', () => Promise.resolve('fictional'), send, 12288);
    const body = { fictional: '⛳ Fictional '.repeat(4000) };
    const write = { method: 'PUT' as const, body, etag: 'v1' };
    expect(await writePrivateValue(request, path, signal(), write, 12288)).toEqual({ fictional: 'saved' });
    const first = [...sent];
    expect(first.length).toBeGreaterThan(2);
    expect(send.mock.calls.every((call) => new TextEncoder().encode(bodyText(call[1]?.body)).length <= 12288)).toBe(true);
    expect(send.mock.calls.every((call) => new Headers(call[1]?.headers).get('If-Match') === 'v1')).toBe(true);
    sent.length = 0;
    await writePrivateValue(request, path, signal(), write, 12288);
    expect(sent).toEqual(first);
  });

  it('does not commit incomplete staging, exceed total byte budgets or authenticate aborted operations', async () => {
    const token = vi.fn().mockResolvedValue('fictional');
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 503 }));
    const request = createPrivateRequest('https://fictional.example.test/api', token, send, 12288);
    await expect(writePrivateValue(request, path, signal(), { method: 'PUT', body: { fictional: 'F'.repeat(maximumPrivateWriteBytes) } }, 12288))
      .rejects.toThrow('byte budget');
    expect(token).not.toHaveBeenCalled();
    await expect(writePrivateValue(request, path, signal(), { method: 'PUT', body: { fictional: 'F'.repeat(20_000) } }, 12288)).rejects.toThrow('503');
    expect(send).toHaveBeenCalledOnce();
    expect(bodyText(send.mock.calls[0]?.[1]?.body)).toContain('privateUpload');
    const controller = new AbortController();
    controller.abort();
    await expect(writePrivateValue(request, path, controller.signal, { method: 'PUT', body: {} }, 12288)).rejects.toThrow();
    expect(token).toHaveBeenCalledOnce();
  });

  it('assembles all hash-bound pages exactly, including a split surrogate pair, before exposing complete data', async () => {
    const value = { fictional: '⛳🏌️'.repeat(15_000) };
    const text = JSON.stringify(value);
    const digest = createHash('sha256').update(text).digest('hex');
    const parts = Math.ceil(text.length / privateReadPartCharacters);
    const send = vi.fn<typeof fetch>().mockImplementation((url) => {
      const parsed = new URL(urlText(url));
      const index = Number(parsed.searchParams.get('privatePart') ?? 0);
      if (index > 0) expect(parsed.searchParams.get('privateHash')).toBe(digest);
      return Promise.resolve(new Response(JSON.stringify({ privateRead: { sha256: digest, index, parts,
        bytes: new TextEncoder().encode(text).length,
        content: text.slice(index * privateReadPartCharacters, (index + 1) * privateReadPartCharacters) } })));
    });
    const request = createPrivateRequest('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    expect(await readPrivateValue(request, path, signal())).toEqual(value);
    expect(send).toHaveBeenCalledTimes(parts);
  });

  it.each(['missing', 'hash', 'index', 'bytes', 'content'] as const)('rejects %s read corruption rather than exposing partial data', async (failure) => {
    const text = JSON.stringify({ fictional: 'F'.repeat(40_000) });
    const sha256 = createHash('sha256').update(text).digest('hex');
    const send = vi.fn<typeof fetch>().mockImplementation((url) => {
      const index = Number(new URL(urlText(url)).searchParams.get('privatePart') ?? 0);
      if (index === 1 && failure === 'missing') return Promise.resolve(new Response('{}', { status: 503 }));
      return Promise.resolve(new Response(JSON.stringify({ privateRead: { sha256: index === 1 && failure === 'hash' ? '0'.repeat(64) : sha256,
        index: index === 1 && failure === 'index' ? 0 : index, parts: 2,
        bytes: text.length + (index === 1 && failure === 'bytes' ? 1 : 0),
        content: index === 1 && failure === 'content' ? 'tampered' : text.slice(index * privateReadPartCharacters, (index + 1) * privateReadPartCharacters),
      } })));
    });
    const request = createPrivateRequest('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    await expect(readPrivateValue(request, path, signal())).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
