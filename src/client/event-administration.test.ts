import { describe, expect, it, vi } from 'vitest';
import { createEventAdministrationClient } from './event-administration';
import { SessionExpiredError } from './events';

const id = '00000000-0000-4000-8000-000000000001';
const requestId = '00000000-0000-4000-8000-000000000002';
const event = { id, name: 'Fictional Quick round', status: 'archived', etag: 'fictional-v1' } as const;
const signal = () => new AbortController().signal;
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

describe('Authenticated event administration client', () => {
  it('uses only private bearer routes with exact conditional revisions and stable request identities', async () => {
    const send = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ events: [event], continuationToken: 'fictional-next' }))
      .mockResolvedValueOnce(json({ eventId: id, requestId, status: 'active' }))
      .mockResolvedValueOnce(json({ eventId: id, requestId, state: 'deleting' }))
      .mockResolvedValueOnce(json({ eventId: id, requestId, state: 'deleted' }));
    const client = createEventAdministrationClient('https://fictional.example/api', () => Promise.resolve('fictional-token'), send);
    await client.listQuick(signal(), 'fictional-current', 'archived');
    expect(send.mock.calls[0]?.[0]).toBe('https://fictional.example/api/administration/quick-rounds?status=archived&cursor=fictional-current');
    await client.restore(event, requestId, signal());
    await client.deleteArchived(event, event.name, requestId, signal());
    expect(send.mock.calls[2]?.[1]).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { Authorization: 'Bearer fictional-token', 'If-Match': event.etag, 'Idempotency-Key': requestId },
      body: JSON.stringify({ confirmation: event.name }) });
    expect(await client.continueDeletion(id, requestId, signal())).toEqual({ eventId: id, requestId, state: 'deleted' });
    expect(send.mock.calls[3]?.[1]?.headers).not.toHaveProperty('If-Match');
  });

  it('rejects mismatched acknowledgements, unexpected private fields, confirmation errors and active deletion', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(json({ eventId: id, requestId: id, state: 'deleted' }));
    const client = createEventAdministrationClient('https://fictional.example/api', () => Promise.resolve('fictional-token'), send);
    await expect(client.continueDeletion(id, requestId, signal())).rejects.toThrow('Invalid deletion acknowledgement');
    await expect(client.deleteArchived(event, 'wrong name', requestId, signal())).rejects.toThrow('exact archived event name');
    await expect(client.deleteArchived({ ...event, status: 'active' }, event.name, requestId, signal())).rejects.toThrow('exact archived event name');
    expect(send).toHaveBeenCalledTimes(1);
    send.mockResolvedValue(json({ events: [{ ...event, recordedBy: 'fictional-private' }] }));
    await expect(client.listQuick(signal(), undefined, 'archived')).rejects.toThrow('Invalid Quick round directory');
    send.mockResolvedValue(json({ deletions: [{ eventId: id, requestId, state: 'deleted' }] }));
    await expect(client.listDeletions(signal())).rejects.toThrow('Invalid pending deletion');
  });

  it('keeps failures explicit and never sends an aborted request after token acquisition', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    const client = createEventAdministrationClient('https://fictional.example/api', () => Promise.resolve('fictional-token'), send);
    await expect(client.listQuick(signal())).rejects.toBeInstanceOf(SessionExpiredError);
    send.mockResolvedValue(new Response(null, { status: 429 }));
    await expect(client.continueDeletion(id, requestId, signal())).rejects.toThrow('Wait a minute');
    send.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(client.continueDeletion(id, requestId, signal())).rejects.toThrow('Retry the same operation');
    send.mockClear();
    const controller = new AbortController();
    const aborted = createEventAdministrationClient('https://fictional.example/api', () => {
      controller.abort();
      return Promise.resolve('fictional-token');
    }, send);
    await expect(aborted.listQuick(controller.signal)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
