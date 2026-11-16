import { describe, expect, it, vi } from 'vitest';
import { createPublicServices } from './public-events';
import { fictionalPublicScores, fictionalPublicWorkspace } from './public-events.test-support';
import { fictionalChange, scoreResult } from './scoring.test-support';
import { fictionalId, fictionalSetup, fictionalWorkspace } from './catalog.test-support';
import { SessionExpiredError } from './events';
import { PrivateRequestError } from './private-request';
import { fictionalPurse } from '../../tests/smoke/purse-fixture-data';
import { publicPurseSummary } from '../domain/public-purse';
import { publicLeaderboardFixture } from '../domain/public-leaderboard.test-support';
import { publicLeaderboardSummary } from '../domain/public-leaderboard';

const signal = new AbortController().signal;
function fixture(value: unknown, status = 200) {
  const send = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(value), { status })));
  return { send, services: createPublicServices('https://fictional.example.test/api', send) };
}
describe('unsigned public event transport', () => {
  it.each(['overall', 'event-skins'] as const)('requests only %s display data and remains compatible with an old full-response API', async (kind) => {
    const full = publicLeaderboardFixture();
    const summary = publicLeaderboardSummary(full, kind);
    for (const response of [summary, full]) {
      const f = fixture(response);
      expect(await f.services.leaderboard.load(full.workspace.event.id, signal, kind)).toEqual(summary);
      expect(f.send.mock.calls[0]?.[0]).toBe(`https://fictional.example.test/api/public/events/${full.workspace.event.id}/leaderboard?view=${kind}`);
      expect(f.send.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', cache: 'no-store' });
      expect(new Headers(f.send.mock.calls[0]?.[1]?.headers).get('authorization')).toBeNull();
    }
    await expect(fixture({ ...summary, roundScores: [] }).services.leaderboard.load(full.workspace.event.id, signal, kind))
      .rejects.toThrow('Invalid public leaderboard');
  });
  it('requests only the compact purse contract with no identity, cookies or cached scores', async () => {
    const summary = publicPurseSummary(fictionalPurse());
    const f = fixture(summary);
    expect(await f.services.purse.load(summary.eventId, signal)).toEqual(summary);
    expect(f.send.mock.calls[0]?.[0]).toBe(`https://fictional.example.test/api/public/events/${summary.eventId}/purse?view=summary`);
    expect(f.send.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', cache: 'no-store', signal });
    expect(new Headers(f.send.mock.calls[0]?.[1]?.headers).get('authorization')).toBeNull();
    for (const invalid of [{ ...summary, eventId: fictionalId(999) }, { ...summary, roundScores: [] }, fictionalPurse()]) {
      await expect(fixture(invalid).services.purse.load(summary.eventId, signal)).rejects.toThrow('Invalid public winnings');
    }
  });

  it('lists only active public events with the exact continuation parameter and no Authorization/cookies', async () => {
    const f = fixture({ events: [fictionalPublicWorkspace.event], continuationToken: 'next-page' });
    await f.services.events.list(signal, 'opaque-page');
    expect(f.send.mock.calls[0]?.[0]).toBe('https://fictional.example.test/api/public/events?continuationToken=opaque-page');
    const request = f.send.mock.calls[0]?.[1];
    expect(request).toMatchObject({ credentials: 'omit', cache: 'no-store', signal });
    expect(new Headers(request?.headers).get('authorization')).toBeNull();
    await expect(f.services.events.list(signal, undefined, 'archived')).rejects.toThrow('Only active');
    expect(f.send).toHaveBeenCalledOnce();
  });
  it('loads allowlisted public workspaces and rejects private/owner-shaped responses', async () => {
    const f = fixture(fictionalPublicWorkspace);
    expect(await f.services.setup.load(fictionalPublicWorkspace.event.id, signal)).toEqual(fictionalPublicWorkspace);
    for (const value of [fictionalWorkspace, { ...fictionalPublicWorkspace, publicAccess: undefined },
      { ...fictionalPublicWorkspace, rounds: fictionalWorkspace.rounds }]) {
      await expect(fixture(value).services.setup.load(fictionalPublicWorkspace.event.id, signal)).rejects.toThrow('Invalid public');
    }
  });
  it('saves scores with conditional/idempotent headers and an explicit unverified public actor', async () => {
    const change = { ...fictionalChange, recordedBy: { kind: 'public-score' as const, eventId: fictionalPublicWorkspace.event.id } };
    const result = scoreResult(change, fictionalPublicScores);
    const f = fixture(result);
    expect(await f.services.scores.save(change.eventId, change.roundId, change.playerId, change.holeNumber,
      change.after, null, change.id, signal)).toEqual(result);
    const request = f.send.mock.calls[0]?.[1];
    expect(new Headers(request?.headers).get('authorization')).toBeNull();
    expect(new Headers(request?.headers).get('if-none-match')).toBe('*');
    expect(new Headers(request?.headers).get('idempotency-key')).toBe(change.id);
    expect(request?.body).toBe(JSON.stringify({ score: change.after }));
    await expect(fixture(scoreResult()).services.scores.save(change.eventId, change.roundId,
      change.playerId, 1, change.after, null, change.id, signal)).rejects.toThrow('outcome is uncertain');
  });
  it('rejects all management and history requests before networking', async () => {
    const f = fixture({});
    await expect(f.services.setup.save(fictionalPublicWorkspace.event.id, 'etag', fictionalSetup, signal)).rejects.toBeInstanceOf(PrivateRequestError);
    await expect(f.services.setup.refreshIndices(fictionalPublicWorkspace.event.id, fictionalId(70), 'etag', fictionalId(100), signal))
      .rejects.toBeInstanceOf(PrivateRequestError);
    await expect(f.services.scores.history(fictionalPublicWorkspace.event.id, fictionalId(70), fictionalId(1), signal))
      .rejects.toBeInstanceOf(PrivateRequestError);
    await expect(f.services.scores.saveGames(fictionalPublicWorkspace.event.id, fictionalId(70), [], null, fictionalId(100), signal))
      .rejects.toBeInstanceOf(PrivateRequestError);
    expect(f.send).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404])('clears unavailable public context on %i without a sign-in instruction', async (status) => {
    const f = fixture({}, status);
    await expect(f.services.setup.load(fictionalPublicWorkspace.event.id, signal)).rejects.toBeInstanceOf(SessionExpiredError);
    await expect(f.services.setup.load(fictionalPublicWorkspace.event.id, signal)).rejects.toThrow('Choose an active event');
  });
});
