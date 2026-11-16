import { TableClient } from '@azure/data-tables';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { creator, event } from '../test/fixtures.js';
import { identifier } from '../test/catalog-fixtures.js';
import { TableRequestLimiter } from './limits.js';

describe('shared identity request limits', () => {
  it('reserves whole aggregate costs atomically across instances and rejects invalid costs before touching storage', async () => {
    const table = new TableClient('https://fictional.table.core.windows.net', 'Events');
    let count = 597;
    const get = vi.spyOn(table, 'getEntity').mockImplementation(() => Promise.resolve({ etag: String(count), window: 0, count }));
    const update = vi.spyOn(table, 'updateEntity').mockImplementation((entity, _mode, options) => {
      if (options?.etag !== String(count)) return Promise.reject(Object.assign(new Error('Fictional cost race'), { statusCode: 412 }));
      if (!('count' in entity) || typeof entity.count !== 'number') throw new Error('Missing fictional cost');
      count = entity.count;
      return Promise.resolve({ etag: String(count) });
    });
    const first = new TableRequestLimiter(table, () => 1);
    const second = new TableRequestLimiter(table, () => 1);
    const results = await Promise.allSettled([first.check(creator, 'scores-read', 3), second.check(creator, 'scores-read', 3)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(count).toBe(600);
    expect(update).toHaveBeenCalledTimes(2);
    get.mockClear();
    for (const units of [0, -1, .5, NaN, Infinity, 601]) {
      await expect(first.check(creator, 'scores-read', units)).rejects.toMatchObject({ status: 503, code: 'INVALID_REQUEST_QUOTA_COST' });
    }
    expect(get).not.toHaveBeenCalled();
  });

  it.each([4, 25, 75])('handles twelve aggregate readers with %i ms storage RPCs, charging all 72 units exactly once', { timeout: 15_000 }, async (rpcMs) => {
    const table = new TableClient('https://fictional.table.core.windows.net', 'Events');
    let count = 0;
    vi.spyOn(table, 'getEntity').mockImplementation(async () => {
      const snapshot = { etag: String(count), window: 0, count };
      await delay(rpcMs);
      return snapshot;
    });
    vi.spyOn(table, 'updateEntity').mockImplementation(async (entity, _mode, options) => {
      await delay(rpcMs);
      if (options?.etag !== String(count)) throw Object.assign(new Error('Fictional network-overlap conflict'), { statusCode: 412 });
      if (!('count' in entity) || typeof entity.count !== 'number') throw new Error('Missing fictional aggregate cost');
      count = entity.count;
      return { etag: String(count) };
    });
    const actor = { kind: 'public-score' as const, eventId: event.id };
    const first = new TableRequestLimiter(table, () => 1);
    const second = new TableRequestLimiter(table, () => 1);
    const results = await Promise.allSettled(Array.from({ length: 12 }, async (_, index) => {
      const limiter = index % 2 ? first : second;
      await limiter.check(actor, 'scores-read');
      await limiter.check(actor, 'scores-read', 5);
    }));
    expect(results.filter((result) => result.status === 'rejected')).toEqual([]);
    expect(count).toBe(72);
  });

  it('does not reset a newer quota window after a slow read or a clock-behind request', async () => {
    const table = new TableClient('https://fictional.table.core.windows.net', 'Events');
    let now = 59_999;
    const get = vi.spyOn(table, 'getEntity').mockImplementation(() => {
      now = 60_001;
      return Promise.resolve({ etag: 'new-window', window: 1, count: 600 });
    });
    const update = vi.spyOn(table, 'updateEntity');
    const limiter = new TableRequestLimiter(table, () => now);
    await expect(limiter.check(creator, 'scores-read', 5)).rejects.toMatchObject({ status: 429, code: 'REQUEST_LIMIT_EXCEEDED' });
    now = 59_999;
    get.mockImplementation(() => Promise.resolve({ etag: 'clock-ahead', window: 1, count: 600 }));
    await expect(limiter.check(creator, 'scores-read', 5)).rejects.toMatchObject({ status: 429 });
    expect(update).not.toHaveBeenCalled();
  });

  it('creates and rolls over counters with the full reserved cost, retaining fail-closed storage behavior', async () => {
    const table = new TableClient('https://fictional.table.core.windows.net', 'Events');
    const get = vi.spyOn(table, 'getEntity').mockRejectedValue({ statusCode: 404, code: 'ResourceNotFound' });
    const create = vi.spyOn(table, 'createEntity').mockResolvedValue({ etag: 'created' });
    await new TableRequestLimiter(table, () => 1).check(creator, 'scores-read', 8);
    expect(create).toHaveBeenCalledWith({ partitionKey: `quota:${creator.tenantId}:${creator.objectId}`,
      rowKey: 'scores-read', window: 0, count: 8 });
    get.mockImplementation(() => Promise.resolve({ etag: 'old', window: 0, count: 599 }));
    const update = vi.spyOn(table, 'updateEntity').mockResolvedValue({ etag: 'next' });
    await new TableRequestLimiter(table, () => 60_001).check(creator, 'scores-read', 8);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ window: 1, count: 8 }), 'Replace', { etag: 'old' });
    get.mockRejectedValue(new Error('Fictional reservation store outage'));
    await expect(new TableRequestLimiter(table).check(creator, 'scores-read', 8)).rejects.toThrow('reservation store outage');
  });

  it('uses one site-wide browse bucket and one event-scoped shared public bucket, never visitor/account identity', async () => {
    const table = new TableClient('https://fictional.table.core.windows.net', 'Events');
    const get = vi.spyOn(table, 'getEntity').mockImplementation(() => Promise.resolve({ etag: 'current', window: 0, count: 59 }));
    const update = vi.spyOn(table, 'updateEntity').mockResolvedValue({ etag: 'next' });
    const limiter = new TableRequestLimiter(table, () => 1);
    await limiter.check({ kind: 'public-browse' }, 'events-read');
    await limiter.check({ kind: 'public-browse' }, 'events-read');
    await limiter.check({ kind: 'public-score', eventId: event.id }, 'scores-write');
    await limiter.check({ kind: 'public-score', eventId: identifier(4001) }, 'scores-write');
    expect(update.mock.calls.map((call) => call[0].partitionKey)).toEqual([
      'quota:public-browse', 'quota:public-browse', `quota:public-score:${event.id}`, `quota:public-score:${identifier(4001)}`,
    ]);
    get.mockImplementation(() => Promise.resolve({ etag: 'full', window: 0, count: 240 }));
    for (const actor of [{ kind: 'public-browse' as const }, { kind: 'public-score' as const, eventId: event.id }]) {
      await expect(limiter.check(actor, 'events-read')).rejects.toMatchObject({ status: 429 });
      get.mockRejectedValueOnce(new Error('Fictional shared public quota outage'));
      await expect(limiter.check(actor, 'scores-read')).rejects.toThrow('Fictional shared public quota outage');
    }
    await expect(limiter.check({ kind: 'public-score', eventId: 'invalid' }, 'scores-write'))
      .rejects.toMatchObject({ status: 503, code: 'INVALID_REQUEST_PRINCIPAL' });
  });

  it.each(['public-browse', 'public-score'] as const)('shares the final %s quota slot across independent instances', async (kind) => {
    const table = new TableClient('https://fictional.table.core.windows.net', 'Events');
    let count = 239;
    vi.spyOn(table, 'getEntity').mockImplementation(() => Promise.resolve({ etag: String(count), window: 0, count }));
    vi.spyOn(table, 'updateEntity').mockImplementation((_entity, _mode, options) => {
      if (options?.etag !== String(count)) return Promise.reject(Object.assign(new Error('Fictional shared quota conflict'), { statusCode: 412 }));
      count++;
      return Promise.resolve({ etag: String(count) });
    });
    const principal = kind === 'public-browse' ? { kind } : { kind, eventId: event.id };
    const outcomes = await Promise.allSettled([
      new TableRequestLimiter(table, () => 1).check(principal, 'events-read'),
      new TableRequestLimiter(table, () => 1).check(principal, 'events-read'),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(count).toBe(240);
  });
  it('uses separate durable tester-link event principals and fails closed on their quota-store outage', async () => {
    const table = new TableClient('https://fictional.table.core.windows.net', 'Events');
    const get = vi.spyOn(table, 'getEntity').mockImplementation(() => Promise.resolve({ etag: 'current', window: 0, count: 59 }));
    const update = vi.spyOn(table, 'updateEntity').mockResolvedValue({ etag: 'next' });
    const actor = { kind: 'tester-link' as const, eventId: event.id, linkId: identifier(3000) };
    const limiter = new TableRequestLimiter(table, () => 1);
    await limiter.check(actor, 'scores-write');
    await limiter.check({ ...actor, linkId: identifier(3001) }, 'scores-write');
    expect(update.mock.calls[0]?.[0]).toMatchObject({ partitionKey: `quota:tester-link:${event.id}:${actor.linkId}`, count: 60 });
    expect(update.mock.calls[1]?.[0]).toMatchObject({ partitionKey: `quota:tester-link:${event.id}:${identifier(3001)}` });
    get.mockImplementation(() => Promise.resolve({ etag: 'full', window: 0, count: 60 }));
    await expect(limiter.check(actor, 'scores-write')).rejects.toMatchObject({ status: 429 });
    get.mockRejectedValue(new Error('Fictional quota outage'));
    await expect(limiter.check(actor, 'scores-write')).rejects.toThrow('Fictional quota outage');
  });
  it.each([
    ['catalog-read', 60], ['catalog-write', 60], ['setup-read', 60], ['setup-write', 30],
    ['scores-read', 600], ['scores-write', 60],
  ] as const)('enforces a separate bounded %s bucket without fallback', async (action, limit) => {
    const table = new TableClient('https://fictional.table.core.windows.net', 'Events');
    let count = 0;
    vi.spyOn(table, 'getEntity').mockImplementation(() => Promise.resolve({ etag: String(count), window: 0, count }));
    const update = vi.spyOn(table, 'updateEntity').mockImplementation(() => {
      count++;
      return Promise.resolve({ etag: String(count) });
    });
    const limiter = new TableRequestLimiter(table, () => 1);
    for (let index = 0; index < limit; index++) await limiter.check(creator, action);
    await expect(limiter.check(creator, action)).rejects.toMatchObject({ status: 429 });
    expect(update).toHaveBeenCalledTimes(limit);
    expect(update.mock.calls[0]?.[0]).toMatchObject({ rowKey: action });
  });

  it('supports twelve viewers polling and navigating in one minute while retaining shared read and write ceilings', async () => {
    const table = new TableClient('https://fictional.table.core.windows.net', 'Events');
    const counts = new Map<string, number>();
    vi.spyOn(table, 'getEntity').mockImplementation((partition, key) => {
      const count = counts.get(`${partition}|${key}`) ?? 0;
      return Promise.resolve({ etag: String(count), window: 0, count });
    });
    vi.spyOn(table, 'updateEntity').mockImplementation((entity, _mode, options) => {
      const key = `${entity.partitionKey}|${entity.rowKey}`;
      const count = counts.get(key) ?? 0;
      if (options?.etag !== String(count)) return Promise.reject(Object.assign(new Error('Fictional quota conflict'), { statusCode: 412 }));
      counts.set(key, count + 1);
      return Promise.resolve({ etag: String(count + 1) });
    });
    const actor = { kind: 'public-score' as const, eventId: event.id };
    const first = new TableRequestLimiter(table, () => 1);
    const second = new TableRequestLimiter(table, () => 1);
    const instances = [first, second];
    for (let viewer = 0; viewer < 12; viewer++) {
      const limiter = instances[viewer % instances.length];
      if (!limiter) throw new Error('Missing fictional API instance');
      await limiter.check({ kind: 'public-browse' }, 'events-read');
      await limiter.check(actor, 'setup-read');
      // Four foreground polls and two five-round aggregate visits, each charged once plus every round.
      for (let read = 0; read < 4 + 2 * 6; read++) await limiter.check(actor, 'scores-read');
    }
    const scoreKey = `quota:public-score:${event.id}|scores-read`;
    expect(counts.get(scoreKey)).toBe(192);
    for (let count = 192; count < 599; count++) await first.check(actor, 'scores-read');
    const outcomes = await Promise.allSettled(instances.map((limiter) => limiter.check(actor, 'scores-read')));
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(counts.get(scoreKey)).toBe(600);
    for (let count = 0; count < 60; count++) await first.check(actor, 'scores-write');
    await expect(second.check(actor, 'scores-write')).rejects.toMatchObject({ status: 429 });
    expect(counts.get(`quota:public-score:${event.id}|scores-write`)).toBe(60);
  });

  it('does not raise private event browsing or tester-link setup limits with the shared public budgets', async () => {
    const table = new TableClient('https://fictional.table.core.windows.net', 'Events');
    vi.spyOn(table, 'getEntity').mockImplementation(() => Promise.resolve({ etag: 'full', window: 0, count: 60 }));
    const update = vi.spyOn(table, 'updateEntity').mockResolvedValue({ etag: 'next' });
    const limiter = new TableRequestLimiter(table, () => 1);
    await expect(limiter.check(creator, 'events-read')).rejects.toMatchObject({ status: 429 });
    await expect(limiter.check({ kind: 'tester-link', eventId: event.id, linkId: identifier(3000) }, 'setup-read'))
      .rejects.toMatchObject({ status: 429 });
    expect(update).not.toHaveBeenCalled();
  });

  it('admits a twelve-viewer burst across independent instances without treating ETag contention as exhausted quota', async () => {
    const table = new TableClient('https://fictional.table.core.windows.net', 'Events');
    let count = 0;
    vi.spyOn(table, 'getEntity').mockImplementation(() => Promise.resolve({ etag: String(count), window: 0, count }));
    vi.spyOn(table, 'updateEntity').mockImplementation((_entity, _mode, options) => {
      if (options?.etag !== String(count)) return Promise.reject(Object.assign(new Error('Fictional simultaneous quota read'), { statusCode: 412 }));
      count++;
      return Promise.resolve({ etag: String(count) });
    });
    const actor = { kind: 'public-score' as const, eventId: event.id };
    const first = new TableRequestLimiter(table, () => 1);
    const second = new TableRequestLimiter(table, () => 1);
    const outcomes = await Promise.allSettled(Array.from({ length: 12 }, (_, index) =>
      (index % 2 ? first : second).check(actor, 'scores-read')));
    expect(outcomes.filter((result) => result.status === 'rejected')).toEqual([]);
    expect(count).toBe(12);
  });

  it('keeps conflict retries bounded and reports contention separately from an exhausted budget', { timeout: 10_000 }, async () => {
    const table = new TableClient('https://fictional.table.core.windows.net', 'Events');
    const get = vi.spyOn(table, 'getEntity').mockImplementation(() => Promise.resolve({ etag: 'racing', window: 0, count: 1 }));
    const update = vi.spyOn(table, 'updateEntity').mockRejectedValue({ statusCode: 412 });
    await expect(new TableRequestLimiter(table, () => 1).check(creator, 'scores-read'))
      .rejects.toMatchObject({ status: 429, code: 'REQUEST_LIMIT_CONTENTION' });
    expect(get).toHaveBeenCalledTimes(16);
    expect(update).toHaveBeenCalledTimes(16);
    get.mockImplementation(() => Promise.resolve({ etag: 'full', window: 0, count: 600 }));
    await expect(new TableRequestLimiter(table, () => 1).check(creator, 'scores-read'))
      .rejects.toMatchObject({ status: 429, code: 'REQUEST_LIMIT_EXCEEDED' });
    expect(update).toHaveBeenCalledTimes(16);
  });
  it('creates the first counter from an SDK-mapped missing entity and rejects other 404s', async () => {
    const table = new TableClient('https://fictional.table.core.windows.net', 'Events');
    const get = vi.spyOn(table, 'getEntity').mockRejectedValue({
      statusCode: 404, details: { odataError: { code: 'ResourceNotFound' } },
    });
    const create = vi.spyOn(table, 'createEntity').mockResolvedValue({ etag: 'created' });
    await new TableRequestLimiter(table, () => 1).check(creator, 'identity-read');
    expect(create).toHaveBeenCalledWith({
      partitionKey: `quota:${creator.tenantId}:${creator.objectId}`,
      rowKey: 'identity-read', window: 0, count: 1,
    });
    create.mockClear();
    get.mockRejectedValue({ statusCode: 404, details: { odataError: { code: 'TableNotFound' } } });
    await expect(new TableRequestLimiter(table).check(creator, 'identity-read')).rejects.toMatchObject({ statusCode: 404 });
    expect(create).not.toHaveBeenCalled();
  });

  it('uses ETags so separate limiter instances cannot both consume the final available request', async () => {
    const table = new TableClient('https://fictional.table.core.windows.net', 'Events');
    let count = 9;
    vi.spyOn(table, 'getEntity').mockImplementation(() => Promise.resolve({ etag: String(count), window: 0, count }));
    vi.spyOn(table, 'updateEntity').mockImplementation((_entity, _mode, options) => {
      if (options?.etag !== String(count)) return Promise.reject(Object.assign(new Error('Precondition failed'), { statusCode: 412 }));
      count++;
      return Promise.resolve({ etag: String(count) });
    });
    const outcomes = await Promise.allSettled([
      new TableRequestLimiter(table, () => 1).check(creator, 'events-create'),
      new TableRequestLimiter(table, () => 1).check(creator, 'events-create'),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(count).toBe(10);
  });

  it('retries competing first-counter creation and fails closed if the write is denied', async () => {
    const table = new TableClient('https://fictional.table.core.windows.net', 'Events');
    let count = 0;
    vi.spyOn(table, 'getEntity').mockImplementation(() => count === 0
      ? Promise.reject(Object.assign(new Error('Fictional counter is absent.'), {
        statusCode: 404, details: { odataError: { code: 'ResourceNotFound' } },
      }))
      : Promise.resolve({ etag: String(count), window: 0, count }));
    const create = vi.spyOn(table, 'createEntity').mockImplementation(() => {
      if (count !== 0) return Promise.reject(Object.assign(new Error('Fictional counter already exists.'), { statusCode: 409 }));
      count = 1;
      return Promise.resolve({ etag: String(count) });
    });
    vi.spyOn(table, 'updateEntity').mockImplementation((_entity, _mode, options) => {
      if (options?.etag !== String(count)) return Promise.reject(Object.assign(new Error('Fictional ETag changed.'), { statusCode: 412 }));
      count++;
      return Promise.resolve({ etag: String(count) });
    });
    await Promise.all([
      new TableRequestLimiter(table, () => 1).check(creator, 'identity-read'),
      new TableRequestLimiter(table, () => 1).check(creator, 'identity-read'),
    ]);
    expect(count).toBe(2);
    expect(create).toHaveBeenCalledTimes(2);
    count = 0;
    create.mockRejectedValue({ statusCode: 403 });
    await expect(new TableRequestLimiter(table, () => 1).check(creator, 'identity-read')).rejects.toMatchObject({ statusCode: 403 });
    expect(count).toBe(0);
  });

  it('starts a new window without unbounded bucket-row creation and fails closed on outages', async () => {
    const table = new TableClient('https://fictional.table.core.windows.net', 'Events');
    const get = vi.spyOn(table, 'getEntity').mockImplementation(() => Promise.resolve({ etag: 'previous', window: 0, count: 10 }));
    const update = vi.spyOn(table, 'updateEntity').mockResolvedValue({ etag: 'next' });
    await new TableRequestLimiter(table, () => 60_001).check(creator, 'events-create');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ rowKey: 'events-create', window: 1, count: 1 }), 'Replace', { etag: 'previous' });
    get.mockRejectedValue(new Error('storage unavailable'));
    await expect(new TableRequestLimiter(table).check(creator, 'events-create')).rejects.toThrow('storage unavailable');
  });
});
