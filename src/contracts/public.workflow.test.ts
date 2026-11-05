// @vitest-environment node
import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import { publicFixture } from '../../api/src/public-access/test-support.js';
import { createPublicHandler } from '../../api/src/public-access/handlers.js';
import type { PublicAction } from '../../api/src/public-access/handlers.js';
import { identifier } from '../../api/test/catalog-fixtures.js';
import { creator, event } from '../../api/test/fixtures.js';
import { createPublicServices } from '../client/public-events';
import { TableEventStore } from '../../api/src/events/store.js';
import { SessionExpiredError } from '../client/events';

describe('public app client/HTTP/storage workflow', () => {
  it('discovers and scores without identity, reads standings/prizes, then denies an archived event', async () => {
    const f = await publicFixture();
    const api = { ...f, limiter: { check: vi.fn().mockResolvedValue(undefined) } };
    const context = new InvocationContext({ invocationId: 'fictional-public-workflow', logHandler: () => undefined });
    const send = vi.fn<typeof fetch>().mockImplementation(async (target, options) => {
      const url = typeof target === 'string' ? target : target instanceof URL ? target.href : target.url;
      const parts = new URL(url).pathname.replace('/api/public/', '').split('/');
      let action: PublicAction;
      if (parts.length === 1 && parts[0] === 'events') action = 'events';
      else if (parts[2] === 'workspace') action = 'workspace';
      else if (parts[2] === 'leaderboard') action = 'event-leaderboard';
      else if (parts[2] === 'purse') action = 'purse';
      else if (parts[4] === 'scores') action = 'scores';
      else if (parts[4] === 'players' && parts[6] === 'holes') action = 'score-hole';
      else throw new Error('Unregistered public route.');
      const request = new HttpRequest({ url, method: options?.method ?? 'GET',
        headers: Object.fromEntries(new Headers(options?.headers).entries()),
        params: { id: parts[1] ?? '', roundId: parts[3] ?? '', playerId: parts[5] ?? '', holeNumber: parts[7] ?? '' },
        ...(typeof options?.body === 'string' ? { body: { string: options.body } } : {}),
      });
      const result = await createPublicHandler(() => api, action)(request, context);
      return new Response(JSON.stringify(result.jsonBody), { status: result.status ?? 200 });
    });
    const client = createPublicServices('https://fictional.example.test/api', send);
    const signal = new AbortController().signal;
    expect((await client.events.list(signal)).events).toEqual([expect.objectContaining({ id: event.id, role: 'viewer' })]);
    const workspace = await client.setup.load(event.id, signal);
    expect(workspace.publicAccess).toBe(true);
    expect(JSON.stringify(workspace)).not.toContain('handicapIndex');
    const first = await client.scores.load(event.id, f.roundId, signal);
    expect(first.permissions?.role).toBe('public');
    const result = await client.scores.save(event.id, f.roundId, f.peerId, 1, { kind: 'strokes', strokes: 4 },
      null, identifier(8000), signal);
    expect(result.change.recordedBy).toEqual({ kind: 'public-score', eventId: event.id });
    expect(result.round.cards.find((card) => card.playerId === f.peerId)?.holes[0]?.score).toEqual({ kind: 'strokes', strokes: 4 });
    expect(await client.scores.save(event.id, f.roundId, f.peerId, 1, { kind: 'strokes', strokes: 4 },
      null, identifier(8000), signal)).toEqual(result);
    expect((await client.leaderboard.load(event.id, signal)).workspace.publicAccess).toBe(true);
    expect((await client.purse.load(event.id, signal)).workspace.publicAccess).toBe(true);
    for (const [, request] of send.mock.calls) expect(new Headers(request?.headers).get('authorization')).toBeNull();
    const owner = await f.workspace.get(creator, event.id);
    await new TableEventStore(f.table).setStatus(creator, event.id, 'archived', owner.etag);
    expect((await client.events.list(signal)).events).toEqual([]);
    await expect(client.scores.load(event.id, f.roundId, signal)).rejects.toBeInstanceOf(SessionExpiredError);
    await expect(client.scores.save(event.id, f.roundId, f.foreignId, 1, { kind: 'strokes', strokes: 4 },
      null, identifier(8001), signal)).rejects.toBeInstanceOf(SessionExpiredError);
    expect((await f.scores.get(creator, event.id, f.roundId)).cards.find((card) => card.playerId === f.peerId)?.holes[0]?.score)
      .toEqual({ kind: 'strokes', strokes: 4 });
  });
});
