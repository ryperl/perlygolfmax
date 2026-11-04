import { TableClient } from '@azure/data-tables';
import { describe, expect, it, vi } from 'vitest';
import { creator, event, member } from '../../test/fixtures.js';
import { TableEventStore } from './store.js';

function table() { return new TableClient('https://fictional.table.core.windows.net', 'Events'); }

describe('Table event persistence', () => {
  it('creates metadata and owner membership in one event-partition transaction', async () => {
    const client = table();
    const submit = vi.spyOn(client, 'submitTransaction').mockResolvedValue({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
    vi.spyOn(client, 'getEntity').mockImplementation((_partition, row) => Promise.resolve(row === 'event'
      ? { ...event, etag: 'event', creatorTenantId: creator.tenantId, creatorObjectId: creator.objectId }
      : { ...creator, etag: 'member', role: 'owner' }));
    await expect(new TableEventStore(client).create(creator, event)).resolves.toEqual({ ...event, role: 'owner', status: 'active', etag: 'event' });
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
      .mockRejectedValueOnce({ statusCode: 404, details: { odataError: { code: 'ResourceNotFound' } } });
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
      .mockRejectedValueOnce({ statusCode: 404, details: { odataError: { code: 'ResourceNotFound' } } });
    await expect(new TableEventStore(client).list(creator)).resolves.toEqual({ events: [{ ...event, role: 'owner', status: 'active', etag: 'one' }], continuationToken: 'next' });
    expect(byPage).toHaveBeenCalledWith({ maxPageSize: 50 });
  });

  it('fails explicitly on storage outages instead of returning a successful empty list', async () => {
    const client = table();
    const source = client.listEntities();
    vi.spyOn(source, 'byPage').mockImplementation(async function* () { await Promise.reject(new Error('unavailable')); yield []; });
    vi.spyOn(client, 'listEntities').mockReturnValue(source);
    await expect(new TableEventStore(client).list(creator)).rejects.toThrow('unavailable');
  });

  it('does not hide a missing table or an unclassified membership lookup failure', async () => {
    const client = table();
    const source = client.listEntities();
    vi.spyOn(source, 'byPage').mockImplementation(async function* () {
      yield await Promise.resolve([{ partitionKey: event.id, ...event, etag: 'event' }]);
    });
    vi.spyOn(client, 'listEntities').mockReturnValue(source);
    const get = vi.spyOn(client, 'getEntity').mockRejectedValue({
      statusCode: 404, details: { odataError: { code: 'TableNotFound' } },
    });
    await expect(new TableEventStore(client).list(creator)).rejects.toMatchObject({ statusCode: 404 });
    get.mockRejectedValue({ statusCode: 404 });
    await expect(new TableEventStore(client).list(creator)).rejects.toMatchObject({ statusCode: 404 });
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

  it('separates active and archived lists, keeping archived events owner-only', async () => {
    const client = table();
    const source = client.listEntities();
    vi.spyOn(source, 'byPage').mockImplementation(async function* () {
      yield await Promise.resolve([
        { partitionKey: event.id, ...event, etag: 'legacy' },
        { partitionKey: member.objectId, ...event, status: 'archived', etag: 'archived' },
      ]);
    });
    vi.spyOn(client, 'listEntities').mockReturnValue(source);
    const get = vi.spyOn(client, 'getEntity').mockImplementation(() => Promise.resolve({ ...creator, role: 'owner', etag: 'member' }));
    const store = new TableEventStore(client);
    expect((await store.list(creator)).events.map((item) => item.status)).toEqual(['active']);
    expect((await store.list(creator, undefined, 'archived')).events.map((item) => item.status)).toEqual(['archived']);
    get.mockImplementation(() => Promise.resolve({ ...creator, role: 'member', etag: 'member' }));
    expect((await store.list(creator, undefined, 'archived')).events).toEqual([]);
  });

  it.each(['active', 'archived'] as const)('updates %s atomically with the owner grant, without replacing event data', async (status) => {
    const client = table();
    let updated = false;
    vi.spyOn(client, 'getEntity').mockImplementation((_partition, row) => Promise.resolve(row === 'event'
      ? { ...event, status: updated ? status : status === 'active' ? 'archived' : 'active', etag: updated ? 'event-v2' : 'event-v1' }
      : { ...member, role: 'owner', etag: 'owner-v1' }));
    const submit = vi.spyOn(client, 'submitTransaction').mockImplementation(() => {
      updated = true;
      return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
    });
    const result = await new TableEventStore(client).setStatus(member, event.id, status, 'event-v1');
    expect(result).toEqual({ ...event, role: 'owner', status, etag: 'event-v2' });
    expect(submit).toHaveBeenCalledWith([
      ['update', { partitionKey: event.id, rowKey: 'event', status }, 'Merge', { etag: 'event-v1' }],
      ['update', { partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'owner' }, 'Merge', { etag: 'owner-v1' }],
    ]);
  });

  it('does not grant management to the global creator, nonmembers or another tenant', async () => {
    const client = table();
    const get = vi.spyOn(client, 'getEntity').mockImplementation(() => Promise.resolve({ ...creator, role: 'member', etag: 'member' }));
    const submit = vi.spyOn(client, 'submitTransaction');
    const store = new TableEventStore(client);
    await expect(store.setStatus(creator, event.id, 'archived', 'event-v1')).rejects.toMatchObject({ status: 403 });
    get.mockImplementation(() => Promise.resolve({ ...creator, tenantId: member.objectId, role: 'owner', etag: 'member' }));
    await expect(store.setStatus(creator, event.id, 'archived', 'event-v1')).rejects.toMatchObject({ status: 404 });
    get.mockRejectedValue({ statusCode: 404, details: { odataError: { code: 'ResourceNotFound' } } });
    await expect(store.setStatus(creator, event.id, 'archived', 'event-v1')).rejects.toMatchObject({ status: 404 });
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects stale event revisions and simultaneous owner revocation without a successful update', async () => {
    const client = table();
    vi.spyOn(client, 'getEntity').mockImplementation((_partition, row) => Promise.resolve(row === 'event'
      ? { ...event, etag: 'event-v1' } : { ...creator, role: 'owner', etag: 'owner-v1' }));
    const submit = vi.spyOn(client, 'submitTransaction').mockRejectedValue({ statusCode: 412 });
    const store = new TableEventStore(client);
    await expect(store.setStatus(creator, event.id, 'archived', 'old-version')).rejects.toMatchObject({ status: 409, code: 'EVENT_CHANGED' });
    expect(submit).not.toHaveBeenCalled();
    await expect(store.setStatus(creator, event.id, 'archived', 'event-v1')).rejects.toMatchObject({ status: 409, code: 'EVENT_CHANGED' });
    submit.mockRejectedValue(new Error('storage unavailable'));
    await expect(store.setStatus(creator, event.id, 'archived', 'event-v1')).rejects.toThrow('storage unavailable');
  });

  it('does not restore an archived event when replaying its creation request', async () => {
    const client = table();
    vi.spyOn(client, 'submitTransaction').mockRejectedValue({ statusCode: 409 });
    vi.spyOn(client, 'getEntity').mockImplementation((_partition, row) => Promise.resolve(row === 'event'
      ? { ...event, status: 'archived', etag: 'event', creatorTenantId: creator.tenantId, creatorObjectId: creator.objectId }
      : { ...creator, role: 'owner', etag: 'member' }));
    await expect(new TableEventStore(client).create(creator, event)).resolves.toMatchObject({ status: 'archived' });
  });
});
