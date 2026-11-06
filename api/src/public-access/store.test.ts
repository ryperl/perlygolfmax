import { describe, expect, it } from 'vitest';
import { memoryTable, identifier } from '../../test/catalog-fixtures.js';
import { event, member } from '../../test/fixtures.js';
import { TableEventStore } from '../events/store.js';
import { TablePublicEventStore } from './store.js';
import { readEventAccess } from '../event-access.js';
import { createPublicApi } from './runtime.js';

describe('unsigned bounded active-event discovery', () => {
  it('projects dates, normalizes explicit stored clears and fails closed on malformed calendar dates', async () => {
    const f = memoryTable();
    const row = { partitionKey: event.id, rowKey: 'event', ...event, status: 'active', startDate: '2024-02-29',
      creatorObjectId: member.objectId };
    f.seed(row);
    const store = new TablePublicEventStore(f.table);
    expect((await store.list({ kind: 'public-browse' })).events[0]).toMatchObject({ startDate: '2024-02-29', role: 'viewer' });
    expect((await store.list({ kind: 'public-browse' })).events[0]).not.toHaveProperty('creatorObjectId');
    f.seed({ ...row, startDate: '' });
    expect((await store.list({ kind: 'public-browse' })).events[0]).not.toHaveProperty('startDate');
    f.seed({ ...row, startDate: '2026-02-29' });
    await expect(store.list({ kind: 'public-browse' })).rejects.toMatchObject({ status: 503 });
  });
  it('pages provider rows once per request, returns only active viewer summaries, no synthetic account admission', async () => {
    const f = memoryTable();
    for (let index = 0; index < 57; index++) f.seed({
      partitionKey: identifier(5000 + index), rowKey: 'event', name: `Fictional Public Event ${String(index)}`,
      createdAt: event.createdAt, status: index % 2 === 0 ? 'active' : 'archived',
      creatorTenantId: member.tenantId, creatorObjectId: member.objectId, privateAudit: 'Fictional protected history',
    });
    const store = new TablePublicEventStore(f.table);
    const principal = { kind: 'public-browse' as const };
    const first = await store.list(principal);
    expect(first.events).toHaveLength(25);
    expect(first.continuationToken).toBeDefined();
    expect(f.list).toHaveBeenCalledTimes(1);
    const second = await store.list(principal, first.continuationToken);
    expect(second.events).toHaveLength(4);
    expect(second.continuationToken).toBeUndefined();
    expect(new Set([...first.events, ...second.events].map((item) => item.id)).size).toBe(29);
    for (const summary of [...first.events, ...second.events]) {
      expect(summary.status).toBe('active');
      expect(summary.role).toBe('viewer');
      expect(Object.keys(summary).sort()).toEqual(['createdAt', 'etag', 'id', 'name', 'role', 'status']);
    }
    expect(JSON.stringify({ first, second })).not.toContain('privateAudit');
    expect(JSON.stringify({ first, second })).not.toContain(member.objectId);
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
    expect((await new TableEventStore(f.table).list(member)).events).toEqual([]);
    await expect(readEventAccess(f.table, member, identifier(5000))).rejects.toMatchObject({ status: 404 });
  });

  it('returns an empty bounded page with a continuation when all first-page events are archived', async () => {
    const f = memoryTable();
    for (let index = 0; index < 51; index++) f.seed({
      partitionKey: identifier(5000 + index), rowKey: 'event', name: 'Fictional bounded archive',
      createdAt: event.createdAt, ...(index < 50 ? { status: 'archived' } : {}),
    });
    const store = new TablePublicEventStore(f.table);
    const first = await store.list({ kind: 'public-browse' });
    expect(first.events).toEqual([]);
    expect(first.continuationToken).toBeDefined();
    expect(f.list).toHaveBeenCalledTimes(1);
    const second = await store.list({ kind: 'public-browse' }, first.continuationToken);
    expect(second.events).toHaveLength(1);
    expect(second.events[0]).toMatchObject({ status: 'active', role: 'viewer' });
  });

  it('rechecks all event revisions after reading the page and rejects a late archive without publishing stale data', async () => {
    const f = memoryTable();
    const first = f.seed({ partitionKey: identifier(5000), rowKey: 'event', name: 'Fictional First',
      createdAt: event.createdAt, status: 'active' });
    f.seed({ ...first, partitionKey: identifier(5001), name: 'Fictional Second' });
    const read = f.get.getMockImplementation();
    if (!read) throw new Error('Missing fictional public reader');
    f.get.mockImplementation(async (partition, key, options) => {
      if (partition === identifier(5001)) f.seed({ ...first, status: 'archived' });
      return read(partition, key, options);
    });
    await expect(new TablePublicEventStore(f.table).list({ kind: 'public-browse' }))
      .rejects.toMatchObject({ status: 404, code: 'PUBLIC_EVENT_NOT_AVAILABLE' });
  });

  it('fails closed on malformed records and storage outages and requires no JWT/organizer settings to construct the public runtime', async () => {
    const f = memoryTable();
    f.seed({ partitionKey: identifier(5000), rowKey: 'event', name: '', createdAt: event.createdAt, status: 'active' });
    const store = new TablePublicEventStore(f.table);
    await expect(store.list({ kind: 'public-browse' })).rejects.toMatchObject({ status: 503 });
    f.get.mockRejectedValue(new Error('Fictional public storage outage'));
    await expect(store.list({ kind: 'public-browse' })).rejects.toThrow('Fictional public storage outage');
    expect(() => createPublicApi({
      EVENTS_TABLE_ENDPOINT: 'https://fictional.table.core.windows.net', EVENTS_TABLE_NAME: 'Events',
    })).not.toThrow();
    for (const env of [{}, { EVENTS_TABLE_ENDPOINT: 'http://fictional.invalid', EVENTS_TABLE_NAME: 'Events' },
      { EVENTS_TABLE_ENDPOINT: 'https://fictional.invalid?secret=fictional', EVENTS_TABLE_NAME: 'Events' },
      { EVENTS_TABLE_ENDPOINT: 'https://fictional.invalid', EVENTS_TABLE_NAME: 'x' }]) {
      expect(() => createPublicApi(env)).toThrow();
    }
  });
});
