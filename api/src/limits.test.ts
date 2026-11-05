import { TableClient } from '@azure/data-tables';
import { describe, expect, it, vi } from 'vitest';
import { creator, event } from '../test/fixtures.js';
import { identifier } from '../test/catalog-fixtures.js';
import { TableRequestLimiter } from './limits.js';

describe('shared identity request limits', () => {
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
    get.mockImplementation(() => Promise.resolve({ etag: 'full', window: 0, count: 60 }));
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
    let count = 59;
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
    expect(count).toBe(60);
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
    ['scores-read', 60], ['scores-write', 60],
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
