import { describe, expect, it, vi } from 'vitest';
import { calculateEventStandings } from '../domain/event-leaderboard';
import type { EventLeaderboardView } from '../domain/event-leaderboard';
import type { EventWorkspace } from '../domain/setup';
import type { RoundScores } from '../domain/scoring';
import { fictionalId, fictionalWorkspace } from './catalog.test-support';
import { createEventLeaderboardClient } from './event-leaderboard';
import { SessionExpiredError } from './events';

function view(): EventLeaderboardView {
  const first = fictionalWorkspace.rounds[0];
  if (!first) throw new Error('Missing fictional round.');
  const workspace: EventWorkspace = { ...fictionalWorkspace, rounds: [first],
    overallCompetition: { kind: 'stroke-play', basis: 'gross' } };
  const roundScores: readonly RoundScores[] = [{
    eventId: workspace.event.id, eventName: workspace.event.name, eventStatus: workspace.event.status,
    roundId: first.id, roundName: first.name, courseName: first.course.name,
    teeName: first.teeProfile.name, teeCategory: first.teeProfile.category,
    layout: first.teeProfile.holes, teeRatings: first.teeProfile.ratings, groups: first.groups,
    cards: first.players.map((player) => ({
      playerId: player.playerId, displayName: player.displayName, etag: null, updatedAt: null,
      holes: first.teeProfile.holes.map((hole) => ({ number: hole.number, score: { kind: 'unplayed' } })),
    })),
    setupLocked: false, lastUpdatedAt: null,
  }];
  return { workspace, roundScores, standings: calculateEventStandings(workspace, roundScores) };
}

describe('overall leaderboard transport', () => {
  it('loads one owner projection with a bearer token, cancellation and no cookies/cache', async () => {
    const result = view();
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(result)));
    const token = vi.fn().mockResolvedValue('fictional');
    const client = createEventLeaderboardClient('https://fictional.example.test/api', token, send);
    const signal = new AbortController().signal;
    expect(await client.load(result.workspace.event.id, signal)).toEqual(result);
    expect(send.mock.calls[0]).toEqual([
      `https://fictional.example.test/api/events/${result.workspace.event.id}/leaderboard`,
      expect.objectContaining({ signal, cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer fictional' } }),
    ]);
  });
  it('rejects invalid IDs before authentication and mismatched or tampered projections', async () => {
    const result = view();
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(result)));
    const token = vi.fn().mockResolvedValue('fictional');
    const client = createEventLeaderboardClient('https://fictional.example.test/api', token, send);
    const signal = new AbortController().signal;
    await expect(client.load('not-an-id', signal)).rejects.toThrow('identifier');
    expect(token).not.toHaveBeenCalled();
    await expect(client.load(fictionalId(999), signal)).rejects.toThrow('response');
    send.mockResolvedValue(new Response(JSON.stringify({ ...result, roundScores: [] })));
    await expect(client.load(result.workspace.event.id, signal)).rejects.toThrow('response');
  });
  it('accepts disabled legacy events without manufacturing standings', async () => {
    const result = { workspace: fictionalWorkspace, roundScores: [],
      standings: calculateEventStandings(fictionalWorkspace, []) };
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(result)));
    const client = createEventLeaderboardClient('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    expect(await client.load(fictionalWorkspace.event.id, new AbortController().signal)).toEqual(result);
  });
  it('surfaces access expiry, permission failures and cancellation without saved-data fallback', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 403 }));
    const token = vi.fn().mockResolvedValue('fictional');
    const client = createEventLeaderboardClient('https://fictional.example.test/api', token, send);
    const signal = new AbortController().signal;
    await expect(client.load(fictionalWorkspace.event.id, signal)).rejects.toBeInstanceOf(SessionExpiredError);
    await expect(client.load(fictionalWorkspace.event.id, signal)).rejects.toMatchObject({ status: 403 });
    const stopped = new AbortController();
    stopped.abort();
    const count = token.mock.calls.length;
    await expect(client.load(fictionalWorkspace.event.id, stopped.signal)).rejects.toThrow();
    expect(token).toHaveBeenCalledTimes(count);
  });
});
