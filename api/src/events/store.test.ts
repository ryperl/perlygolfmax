import { TableClient } from '@azure/data-tables';
import { describe, expect, it, vi } from 'vitest';
import { creator, event, member } from '../../test/fixtures.js';
import { TableEventStore } from './store.js';

function table() { return new TableClient('https://fictional.table.core.windows.net', 'Events'); }

describe('Table event persistence', () => {
  it('creates metadata and owner membership in one event-partition transaction', async () => {
    const client = table();
    const submit = vi.spyOn(client, 'submitTransaction').mockResolvedValue({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
    await expect(new TableEventStore(client).create(creator, event)).resolves.toEqual({ ...event, role: 'owner' });
    expect(submit).toHaveBeenCalledWith([
      ['create', expect.objectContaining({ partitionKey: event.id, rowKey: 'event', creatorObjectId: creator.objectId })],
      ['create', expect.objectContaining({ partitionKey: event.id, rowKey: `member:${creator.objectId}`, role: 'owner' })],
    ]);
  });

  it('replays identical requests without changing ownership and rejects reused keys with changed content', async () => {
    const client = table();
    vi.spyOn(client, 'submitTransaction').mockRejectedValue({ statusCode: 409 });
    vi.spyOn(client, 'getEntity').mockImplementation((_partition, row) => Promise.resolve(row === 'event'
      ? { ...event, etag: 'etag', creatorTenantId: creator.tenantId, creatorObjectId: creator.objectId }
      : { ...creator, etag: 'member', role: 'owner' }));
    const store = new TableEventStore(client);
    await expect(store.create(creator, event)).resolves.toMatchObject({ id: event.id, createdAt: event.createdAt });
    await expect(store.create(creator, { ...event, name: 'Changed' })).rejects.toMatchObject({ status: 409 });
    await expect(store.create(member, event)).rejects.toMatchObject({ status: 409 });
  });

  it('does not resurrect revoked event access through an idempotency replay', async () => {
    const client = table();
    vi.spyOn(client, 'submitTransaction').mockRejectedValue({ statusCode: 409 });
    vi.spyOn(client, 'getEntity')
      .mockImplementationOnce(() => Promise.resolve({ ...event, etag: 'event', creatorTenantId: creator.tenantId, creatorObjectId: creator.objectId }))
      .mockRejectedValueOnce({ statusCode: 404, code: 'ResourceNotFound' });
    await expect(new TableEventStore(client).create(creator, event)).rejects.toMatchObject({ status: 403 });
  });

  it('bounds scanned pages and rechecks authoritative membership before returning any event', async () => {
    const client = table();
    const source = client.listEntities();
    const page = Object.assign([
      { partitionKey: event.id, ...event, etag: 'one' },
      { partitionKey: '00000000-0000-4000-8000-000000000009', ...event, etag: 'two' },
    ], { continuationToken: 'next' });
    const byPage = vi.spyOn(source, 'byPage').mockImplementation(async function* () { yield await Promise.resolve(page); });
    vi.spyOn(client, 'listEntities').mockReturnValue(source);
    vi.spyOn(client, 'getEntity')
      .mockImplementationOnce(() => Promise.resolve({ etag: 'member', ...creator, role: 'owner' }))
      .mockRejectedValueOnce({ statusCode: 404, code: 'ResourceNotFound' });
    await expect(new TableEventStore(client).list(creator)).resolves.toEqual({ events: [{ ...event, role: 'owner' }], continuationToken: 'next' });
    expect(byPage).toHaveBeenCalledWith({ maxPageSize: 50 });
  });

  it('fails explicitly on storage outages instead of returning a successful empty list', async () => {
    const client = table();
    const source = client.listEntities();
    vi.spyOn(source, 'byPage').mockImplementation(async function* () { await Promise.reject(new Error('unavailable')); yield []; });
    vi.spyOn(client, 'listEntities').mockReturnValue(source);
    await expect(new TableEventStore(client).list(creator)).rejects.toThrow('unavailable');
  });

  it('does not disclose an event to a mismatched tenant or revoked member', async () => {
    const client = table();
    const source = client.listEntities();
    vi.spyOn(source, 'byPage').mockImplementation(async function* () {
      yield await Promise.resolve([{ partitionKey: event.id, ...event, etag: 'event' }]);
    });
    vi.spyOn(client, 'listEntities').mockReturnValue(source);
    const get = vi.spyOn(client, 'getEntity').mockImplementation(() => Promise.resolve({ etag: 'member', ...creator, tenantId: member.objectId, role: 'owner' }));
    await expect(new TableEventStore(client).list(creator)).resolves.toEqual({ events: [] });
    get.mockRejectedValue({ statusCode: 404, code: 'ResourceNotFound' });
    await expect(new TableEventStore(client).list(creator)).resolves.toEqual({ events: [] });
  });
});
