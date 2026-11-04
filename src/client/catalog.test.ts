import { describe, expect, it, vi } from 'vitest';
import { createCatalogClient } from './catalog';
import { EventChangedError, SessionExpiredError } from './events';
import {
  fictionalEntry, fictionalId, fictionalImport, fictionalManifest, fictionalPlayers,
  fictionalProfile, fictionalVersion,
} from './catalog.test-support';

const signal = () => new AbortController().signal;
const response = (value: unknown) => new Response(JSON.stringify(value));
const url = 'https://fictional.example.test/api';
const token = () => Promise.resolve('fictional-token');

describe('catalog API client', () => {
  it('uses staged manifest/profile/publication requests with stable identity and exact expected revision', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(response(fictionalImport))
      .mockResolvedValueOnce(response({ ...fictionalImport, profilesReceived: [fictionalProfile.id] }))
      .mockResolvedValueOnce(response(fictionalVersion));
    const client = createCatalogClient(url, token, send);
    await client.beginImport(fictionalManifest, fictionalImport.id, signal());
    await client.uploadProfile(fictionalImport.id, fictionalProfile, signal());
    await client.publish(fictionalImport.id, 'course-v1', signal());
    expect(send.mock.calls.map(([path]) => path)).toEqual([
      `${url}/catalog/courses/imports`,
      `${url}/catalog/courses/imports/${fictionalImport.id}/profiles/${String(fictionalProfile.id)}`,
      `${url}/catalog/courses/imports/${fictionalImport.id}/publish`,
    ]);
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST', credentials: 'omit', cache: 'no-store', body: JSON.stringify(fictionalManifest),
      headers: { Authorization: 'Bearer fictional-token', 'Idempotency-Key': fictionalImport.id },
    });
    expect(send.mock.calls[1]?.[1]?.body).toBe(JSON.stringify(fictionalProfile));
    expect(send.mock.calls[2]?.[1]?.body).toBe(JSON.stringify({ expectedEtag: 'course-v1' }));
  });

  it('validates paginated catalog reads, exact version identity, staged IDs and manual history', async () => {
    const player = fictionalPlayers[0];
    if (!player) throw new Error('Missing fictional player.');
    const send = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ courses: [fictionalEntry], continuationToken: 'next' }))
      .mockResolvedValueOnce(response(fictionalVersion))
      .mockResolvedValueOnce(response(fictionalImport))
      .mockResolvedValueOnce(response({ players: [player] }))
      .mockResolvedValueOnce(response({ observations: [] }));
    const client = createCatalogClient(url, token, send);
    await expect(client.courses(signal(), 'a+b')).resolves.toMatchObject({ continuationToken: 'next' });
    expect(send.mock.calls[0]?.[0]).toBe(`${url}/catalog/courses?cursor=a%2Bb`);
    await expect(client.version(fictionalVersion.courseId, fictionalVersion.id, signal())).resolves.toEqual(fictionalVersion);
    await expect(client.importStatus(fictionalImport.id, signal())).resolves.toEqual(fictionalImport);
    await expect(client.players(signal())).resolves.toEqual({ players: [player] });
    await expect(client.history(player.id, signal(), 'page')).resolves.toEqual({ observations: [] });
    expect(send.mock.calls[4]?.[0]).toContain('/indices?cursor=page');
  });

  it('sends explicit plus indices, conditional player revisions, dates and sources without inventing unknown values', async () => {
    const player = fictionalPlayers[0];
    if (!player) throw new Error('Missing fictional player.');
    const send = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(response(player)));
    const client = createCatalogClient(url, token, send);
    await expect(client.createPlayer(player.displayName, fictionalId(20), signal())).resolves.toMatchObject({ currentIndex: null });
    await client.renamePlayer(player, 'Fictional New Name', signal());
    const input = { value: '+1.2', effectiveDate: '2026-01-02', source: 'Fictional manual report' };
    await client.recordIndex(player, input, fictionalId(21), signal());
    expect(send.mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH', headers: { 'If-Match': player.etag } });
    expect(send.mock.calls[2]?.[1]).toMatchObject({
      body: JSON.stringify(input), headers: { 'If-Match': player.etag, 'Idempotency-Key': fictionalId(21) },
    });
    await expect(client.recordIndex(player, { ...input, effectiveDate: '2026-02-31' }, fictionalId(22), signal())).rejects.toThrow('Invalid catalog request');
    expect(send).toHaveBeenCalledTimes(3);
  });

  it.each([
    [401, SessionExpiredError], [409, EventChangedError], [403, Error], [429, Error], [503, Error],
  ] as const)('reports HTTP %s without confirming a save', async (status, error) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status }));
    const client = createCatalogClient(url, token, send);
    await expect(client.publish(fictionalImport.id, null, signal())).rejects.toBeInstanceOf(error);
  });

  it('rejects malformed or mismatched responses and aborts even when a transport ignores cancellation', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ ...fictionalVersion, id: 'b'.repeat(64) }))
      .mockResolvedValueOnce(response({ courses: [{}] }))
      .mockResolvedValueOnce(response({ ...fictionalImport, profilesReceived: [999] }));
    const client = createCatalogClient(url, token, send);
    await expect(client.version(fictionalVersion.courseId, fictionalVersion.id, signal())).rejects.toThrow('Invalid course version');
    await expect(client.courses(signal())).rejects.toThrow('Invalid course catalog');
    await expect(client.importStatus(fictionalImport.id, signal())).rejects.toThrow('Invalid staged import');
    const controller = new AbortController();
    const cancelled = createCatalogClient(url, () => { controller.abort(); return token(); }, send);
    await expect(cancelled.courses(controller.signal)).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(3);
    const afterResponse = new AbortController();
    send.mockImplementationOnce(() => { afterResponse.abort(); return Promise.resolve(response({ courses: [] })); });
    await expect(client.courses(afterResponse.signal)).rejects.toThrow();
  });
});
