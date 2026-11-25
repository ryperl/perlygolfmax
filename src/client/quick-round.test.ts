import { describe, expect, it, vi } from 'vitest';
import { createQuickRoundClient } from './quick-round';
import { fictionalId, fictionalSetup } from './catalog.test-support';
import { fictionalPublicWorkspace } from './public-events.test-support';
import { EventChangedError } from './events';

const signal = new AbortController().signal;
const workspace = { ...fictionalPublicWorkspace, quickRound: true as const,
  event: { ...fictionalPublicWorkspace.event, quickRound: true as const },
  rounds: fictionalPublicWorkspace.rounds.map((round, index) => ({ ...round, groups: fictionalSetup.rounds[index]?.groups ?? [] })) };
const eventId = workspace.event.id;
const input = { ...fictionalSetup, name: workspace.event.name };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const receipt = (requestId = eventId) => ({ eventId, requestId, workspaceEtag: workspace.etag });

describe('anonymous Quick round transport', () => {
  it('creates public players without identity and strictly validates inputs, capability and scalar acknowledgements', async () => {
    const input = { displayName: 'Fictional Public Golfer', handicapIndexValue: '+0.5' };
    const player = { id: fictionalId(970), ...input };
    const send = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ items: [], publicPlayerCreation: true }))
      .mockResolvedValueOnce(json(player))
      .mockResolvedValueOnce(json({ ...player, currentIndex: {} }))
      .mockResolvedValueOnce(json({ items: [] }));
    const client = createQuickRoundClient('https://fictional.example.test/api', send);
    expect((await client.players(signal)).publicPlayerCreation).toBe(true);
    if (!client.createPlayer) throw new Error('Missing public create adapter');
    await expect(client.createPlayer(input, fictionalId(971), signal)).resolves.toEqual(player);
    const [url, options] = send.mock.calls[1] ?? [];
    expect(url).toBe('https://fictional.example.test/api/public/players');
    expect(options).toMatchObject({ method: 'POST', body: JSON.stringify(input), credentials: 'omit', cache: 'no-store' });
    const headers = new Headers(options?.headers);
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('Idempotency-Key')).toBe(fictionalId(971));
    expect(headers.get('If-Match')).toBeNull();
    await expect(client.createPlayer(input, fictionalId(971), signal)).rejects.toThrow('not confirmed');
    expect((await client.players(signal)).publicPlayerCreation).toBeUndefined();
    await expect(client.createPlayer({ ...input, handicapIndexValue: '' }, fictionalId(971), signal)).rejects.toThrow('Nothing was sent');
    expect(send).toHaveBeenCalledTimes(4);
  });
  it('archives with an exact conditional retry identity and accepts only the matching minimal acknowledgement', async () => {
    const requestId = fictionalId(960);
    const send = vi.fn<typeof fetch>().mockImplementationOnce(() => Promise.resolve(json({ eventId, requestId, status: 'archived' })))
      .mockImplementationOnce(() => Promise.resolve(json({ eventId, requestId: fictionalId(961), status: 'archived' })));
    const archive = createQuickRoundClient('https://fictional.example.test/api', send).archive;
    if (!archive) throw new Error('Missing archive adapter');
    await expect(archive(eventId, workspace.etag, requestId, signal)).resolves.toBeUndefined();
    const [url, options] = send.mock.calls[0] ?? [];
    expect(url).toBe(`https://fictional.example.test/api/public/quick-rounds/${eventId}/archive`);
    expect(options).toMatchObject({ method: 'PUT', body: '{}', credentials: 'omit', cache: 'no-store' });
    const headers = new Headers(options?.headers);
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('If-Match')).toBe(workspace.etag);
    expect(headers.get('Idempotency-Key')).toBe(requestId);
    await expect(archive(eventId, workspace.etag, requestId, signal)).rejects.toThrow('Archive is not confirmed');
  });
  it('creates then loads a confirmed public setup without tokens/cookies and sends conditional stable edit identities', async () => {
    const operation = fictionalId(950);
    const send = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => Promise.resolve(json(receipt())))
      .mockImplementationOnce(() => Promise.resolve(json(workspace)))
      .mockImplementationOnce(() => Promise.resolve(json(receipt(operation))))
      .mockImplementationOnce(() => Promise.resolve(json(workspace)));
    const client = createQuickRoundClient('https://fictional.example.test/api', send);
    expect(await client.create(eventId, input, signal)).toEqual(workspace);
    expect(await client.save(eventId, workspace.etag, operation, input, signal)).toEqual(workspace);
    const first = send.mock.calls[0];
    expect(first?.[0]).toBe(`https://fictional.example.test/api/public/quick-rounds/${eventId}?nines=1`);
    expect(send.mock.calls[2]?.[0]).toBe(`https://fictional.example.test/api/public/quick-rounds/${eventId}/workspace?nines=1`);
    expect(first?.[1]).toMatchObject({ method: 'PUT', credentials: 'omit', cache: 'no-store', body: JSON.stringify(input) });
    expect(new Headers(first?.[1]?.headers).get('If-None-Match')).toBe('*');
    expect(new Headers(first?.[1]?.headers).get('Idempotency-Key')).toBe(eventId);
    expect(new Headers(send.mock.calls[2]?.[1]?.headers).get('If-Match')).toBe(workspace.etag);
    expect(new Headers(send.mock.calls[2]?.[1]?.headers).get('Idempotency-Key')).toBe(operation);
    for (const [, request] of send.mock.calls) expect(new Headers(request?.headers).get('Authorization')).toBeNull();
  });

  it('retains the same retry identity when publication succeeds but the confirming read fails', async () => {
    const send = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => Promise.resolve(json(receipt())))
      .mockRejectedValueOnce(new Error('Fictional interrupted read'))
      .mockImplementationOnce(() => Promise.resolve(json(receipt())))
      .mockImplementationOnce(() => Promise.resolve(json(workspace)));
    const client = createQuickRoundClient('https://fictional.example.test/api', send);
    await expect(client.create(eventId, input, signal)).rejects.toThrow('Fictional interrupted read');
    await expect(client.create(eventId, input, signal)).resolves.toEqual(workspace);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[2]);
  });

  it('rejects ordinary/owner responses and acknowledged-but-newer setup rather than claiming the draft saved', async () => {
    for (const bad of [fictionalPublicWorkspace, { ...workspace, event: { ...workspace.event, role: 'owner' } }]) {
      const send = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(json(bad)));
      await expect(createQuickRoundClient('https://fictional.example.test/api', send).load(eventId, signal))
        .rejects.toThrow('could not be loaded');
    }
    const send = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => Promise.resolve(json(receipt())))
      .mockImplementationOnce(() => Promise.resolve(json({ ...workspace, event: { ...workspace.event, name: 'Fictional concurrent rename' } })));
    await expect(createQuickRoundClient('https://fictional.example.test/api', send).create(eventId, input, signal))
      .rejects.toBeInstanceOf(EventChangedError);
  });

  it('validates scalar-only paged selections and rejects history metadata without sending invalid inputs', async () => {
    const player = { id: fictionalId(1), displayName: 'Fictional selected golfer', handicapIndexValue: '+1.2' };
    const send = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => Promise.resolve(json({ items: [player], continuationToken: 'next' })))
      .mockImplementationOnce(() => Promise.resolve(json({ items: [{ ...player, currentIndex: null }] })));
    const client = createQuickRoundClient('https://fictional.example.test/api', send);
    expect((await client.players(signal, 'first')).items).toEqual([player]);
    expect(send.mock.calls[0]?.[0]).toBe('https://fictional.example.test/api/public/quick-rounds/players?cursor=first');
    await expect(client.players(signal, 'next')).rejects.toThrow('Invalid Quick round player');
    await expect(client.create('invalid', input, signal)).rejects.toThrow('Invalid Quick round identifier');
    await expect(client.create(eventId, { ...input, rounds: [] }, signal)).rejects.toThrow('Check the Quick round');
    expect(send).toHaveBeenCalledTimes(2);
  });
});
