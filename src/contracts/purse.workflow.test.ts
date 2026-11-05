// @vitest-environment node
import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import type { PursePlan } from '../domain/purse.js';
import { maximumPurseRequestBytes } from '../domain/purse-settings.js';
import { createPurseClient } from '../client/purse.js';
import { createPurseHandler } from '../../api/src/purse/handlers.js';
import { TablePurseStore } from '../../api/src/purse/store.js';
import { scoringFixture } from '../../api/test/scoring-fixtures.js';
import { identifier } from '../../api/test/catalog-fixtures.js';
import { creator, event, member } from '../../api/test/fixtures.js';
import { ApiError } from '../../api/src/errors.js';
import { isEventPurseView, isPurseWriteResult } from './purse-settings.js';

async function fixture() {
  const f = await scoringFixture();
  const api = {
    verify: vi.fn().mockResolvedValue(creator), limiter: { check: vi.fn().mockResolvedValue(undefined) },
    purse: new TablePurseStore(f.table, f.workspace, f.scores),
  };
  const handler = createPurseHandler(() => api);
  const context = new InvocationContext({ invocationId: 'fictional-purse-workflow', logHandler: () => undefined });
  let loseWrite = false;
  const send = vi.fn<typeof fetch>().mockImplementation(async (target, options) => {
    const url = typeof target === 'string' ? target : target instanceof URL ? target.href : target.url;
    const parsed = new URL(url);
    const id = parsed.pathname.split('/')[3] ?? '';
    const result = await handler(new HttpRequest({
      url, method: options?.method ?? 'GET', params: { id },
      headers: Object.fromEntries(new Headers(options?.headers).entries()),
      ...(typeof options?.body === 'string' ? { body: { string: options.body } } : {}),
    }), context);
    if (loseWrite && options?.method === 'PUT' && typeof options.body === 'string' && !options.body.includes('"privateUpload"')) {
      loseWrite = false;
      throw new Error('Fictional committed response was lost.');
    }
    return new Response(JSON.stringify(result.jsonBody), { status: result.status ?? 200 });
  });
  const client = createPurseClient('https://fictional.example.test/api', () => Promise.resolve('fictional-token'), send);
  const signal = new AbortController().signal;
  return { ...f, api, handler, context, send, client, signal, loseNext: () => { loseWrite = true; } };
}

describe('purse browser/HTTP/storage contract', () => {
  it('saves, reloads and retries a large exact prize plan through bounded parts and paged reads', async () => {
    const f = await fixture();
    const plan: PursePlan = {
      eventId: event.id, currency: 'USD', funding: { kind: 'fixed', budgetMinor: 2000000 },
      pools: Array.from({ length: 160 }, (_, index) => ({
        id: identifier(2000 + index), name: `Fictional award ${String(index + 1)} ${'A'.repeat(65)}`,
        source: { kind: 'manual' }, awardUnit: 'pot', amountMinor: 9001, recipientIds: f.input.playerIds.slice(0, 3),
      })),
    };
    expect(Buffer.byteLength(JSON.stringify({ plan, resolutions: [] }), 'utf8')).toBeGreaterThan(maximumPurseRequestBytes);
    expect(Buffer.byteLength(JSON.stringify({ plan, resolutions: [] }), 'utf16le')).toBeGreaterThan(64 * 1024);
    const empty = await f.client.load(event.id, f.signal);
    expect(empty.configuration.plan).toBeNull();
    f.loseNext();
    await expect(f.client.save(event.id, plan, [], null, identifier(800), f.signal)).rejects.toThrow('lost');
    const result = await f.client.save(event.id, plan, [], null, identifier(800), f.signal);
    expect(isPurseWriteResult(result)).toBe(true);
    expect(result.change.after.plan).toEqual(plan);
    expect(result.current.view?.calculation.allocatedMinor).toBe(1440000);
    expect(result.current.view?.calculation.unallocatedMinor).toBe(160);
    expect(f.submit).toHaveBeenCalledOnce();
    const stored = f.rows.get(`${event.id}|purse`);
    const audit = f.rows.get(`${event.id}|purse-change:${identifier(800)}`);
    expect(JSON.parse(String(stored?.content))).toMatchObject({ privateValue: 1 });
    expect(JSON.parse(String(audit?.content))).toMatchObject({ privateValue: 1 });
    const loaded = await f.client.load(event.id, f.signal);
    expect(isEventPurseView(loaded)).toBe(true);
    expect(loaded).toEqual(result.current);
    expect(f.send.mock.calls.some(([target]) => (typeof target === 'string'
      ? target : target instanceof URL ? target.href : target.url).includes('privatePart='))).toBe(true);
    for (const [, options] of f.send.mock.calls) {
      if (typeof options?.body === 'string') expect(Buffer.byteLength(options.body, 'utf8')).toBeLessThanOrEqual(maximumPurseRequestBytes);
      expect(options?.credentials).toBe('omit');
    }
  });
  it('denies members and expired sessions, and rejects malformed/oversized writes before publication', async () => {
    const f = await fixture();
    const call = (method: string, body?: string, headers: Record<string, string> = {}) => f.handler(new HttpRequest({
      url: 'https://fictional.example.test/api/fixture', method, params: { id: event.id },
      headers: { authorization: 'fictional', 'Content-Type': 'application/json',
        'If-None-Match': '*', 'Idempotency-Key': identifier(800), ...headers },
      ...(body === undefined ? {} : { body: { string: body } }),
    }), f.context);
    expect(await call('POST')).toMatchObject({ status: 405 });
    expect(await call('PUT', '{}')).toMatchObject({ status: 400 });
    expect(await call('PUT', 'x'.repeat(maximumPurseRequestBytes + 1))).toMatchObject({ status: 413 });
    f.api.verify.mockResolvedValue(member);
    await expect(f.client.load(event.id, f.signal)).rejects.toMatchObject({ status: 404 });
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'member' });
    await expect(f.client.load(event.id, f.signal)).rejects.toMatchObject({ status: 403 });
    f.api.verify.mockRejectedValueOnce(new ApiError(401, 'INVALID_TOKEN'));
    expect(await call('GET')).toMatchObject({ status: 401, headers: { 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer' } });
    expect(f.submit).not.toHaveBeenCalled();
  });
});
