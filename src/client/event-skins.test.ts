import { describe, expect, it, vi } from 'vitest';
import { eventSkinsFixture } from '../domain/event-skins.test-support';
import { calculateEventSkins } from '../domain/event-skins';
import { calculateEventStandings } from '../domain/event-leaderboard';
import { purseTestId } from '../domain/purse.test-support';
import { createEventLeaderboardClient } from './event-leaderboard';
import { createPublicServices } from './public-events';
import type { EventSkinsChange } from '../domain/event-skins';
import { publishedCourseHandicaps } from '../domain/playing-handicaps';

describe('event skins private/public adapters', () => {
  const signal = () => new AbortController().signal;
  function fixture() {
    const f = eventSkinsFixture();
    const value = { workspace: f.workspace, roundScores: f.rounds,
      standings: calculateEventStandings(f.workspace, f.rounds), eventSkins: calculateEventSkins(f.workspace, f.rounds) };
    const change: EventSkinsChange = { id: purseTestId(7000), eventId: f.workspace.event.id, expectedEtag: f.workspace.etag,
      before: null, after: { version: 1 }, recordedAt: '2026-01-01T00:00:00Z',
      recordedBy: { tenantId: purseTestId(7001), objectId: purseTestId(7002) } };
    return { ...f, value, change };
  }
  it('loads recomputed event-wide results independently of the primary competition', async () => {
    const f = fixture();
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(f.value)));
    const client = createEventLeaderboardClient('https://fictional.example.test/api', async () => Promise.resolve('fictional'), send);
    expect(await client.load(f.workspace.event.id, signal())).toEqual(f.value);
    expect(send.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', credentials: 'omit' });
  });
  it('sends an explicit conditional versioned owner choice with an idempotency key and validates the exact receipt', async () => {
    const f = fixture();
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(f.change)));
    const client = createEventLeaderboardClient('https://fictional.example.test/api', async () => Promise.resolve('fictional'), send);
    if (!client.configureEventSkins) throw new Error('Missing configured adapter.');
    expect(await client.configureEventSkins(f.workspace.event.id, { version: 1 }, f.workspace.etag, f.change.id, signal())).toEqual(f.change);
    expect(send.mock.calls[0]).toEqual([`https://fictional.example.test/api/events/${f.workspace.event.id}/event-skins`,
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ configuration: { version: 1 } }),
        cache: 'no-store', credentials: 'omit' })]);
    expect(send.mock.calls[0]?.[1]?.headers).toMatchObject({
      'If-Match': f.workspace.etag, 'Idempotency-Key': f.change.id, Authorization: 'Bearer fictional',
    });
    for (const change of [{ ...f.change, eventId: purseTestId(999) }, { ...f.change, id: purseTestId(998) },
      { ...f.change, expectedEtag: 'other' }, { ...f.change, after: null }, { ...f.change, after: { version: 1, extra: true } }]) {
      send.mockResolvedValue(new Response(JSON.stringify(change)));
      await expect(client.configureEventSkins(f.workspace.event.id, { version: 1 }, f.workspace.etag, f.change.id, signal()))
        .rejects.toThrow('not confirmed');
    }
  });
  it('does not turn unsupported/error responses into empty results or confirmed config', async () => {
    const f = fixture();
    const send = vi.fn<typeof fetch>();
    const client = createEventLeaderboardClient('https://fictional.example.test/api', async () => Promise.resolve('fictional'), send);
    if (!client.configureEventSkins) throw new Error('Missing configured adapter.');
    for (const status of [403, 404, 429, 503]) {
      send.mockResolvedValue(new Response('{}', { status }));
      await expect(client.load(f.workspace.event.id, signal())).rejects.toMatchObject({ status });
      await expect(client.configureEventSkins(f.workspace.event.id, null, f.workspace.etag, f.change.id, signal())).rejects.toMatchObject({ status });
    }
    send.mockResolvedValue(new Response('{}', { status: 409 }));
    await expect(client.load(f.workspace.event.id, signal())).rejects.toThrow('changed');
    await expect(client.configureEventSkins(f.workspace.event.id, null, f.workspace.etag, f.change.id, signal())).rejects.toThrow('changed');
    send.mockResolvedValue(new Response(JSON.stringify({ ...f.value, eventSkins: { status: { toString: null } } })));
    await expect(client.load(f.workspace.event.id, signal())).rejects.toThrow('response');
    const calls = send.mock.calls.length;
    await expect(client.configureEventSkins('bad', null, f.workspace.etag, f.change.id, signal())).rejects.toThrow('Nothing was sent');
    expect(send).toHaveBeenCalledTimes(calls);
  });
  it('reads the public scalar projection without tokens and exposes no management method', async () => {
    const f = fixture();
    const workspace = { ...f.workspace, publicAccess: true as const, canViewScores: true,
      event: { ...f.workspace.event, role: 'viewer' as const },
      rounds: f.workspace.rounds.map((round) => ({ ...round, players: round.players.map(({ handicapIndex, ...player }) => ({
        ...player, handicapIndexValue: handicapIndex?.value ?? null,
      })) })) };
    const roundScores = f.rounds.map((round) => ({ ...round,
      permissions: { role: 'public' as const, canManageGames: false, writePlayerIds: round.cards.map((card) => card.playerId) },
      courseHandicaps: workspace.rounds.flatMap(publishedCourseHandicaps),
    }));
    const value = { ...f.value, workspace, roundScores, eventSkins: calculateEventSkins(workspace, roundScores) };
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(value)));
    const client = createPublicServices('https://fictional.example.test/api', send).leaderboard;
    expect(client.configureEventSkins).toBeUndefined();
    expect(await client.load(workspace.event.id, signal())).toEqual(value);
    expect(send.mock.calls[0]?.[0]).toContain('/public/events/');
    expect(send.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Authorization');
  });
});
