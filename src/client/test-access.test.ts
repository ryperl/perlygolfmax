import { describe, expect, it, vi } from 'vitest';
import type { RoundScores, ScoreChange } from '../domain/scoring';
import type { EventWorkspace } from '../domain/setup';
import { createTesterAccessClient, generateTesterSecret, readTesterFragment, testerUrl } from './test-access';
import { fictionalEvent, fictionalId, fictionalWorkspace } from './catalog.test-support';
import { fictionalChange, fictionalRoundScores, scoreResult } from './scoring.test-support';
import { SessionExpiredError } from './events';
import { PrivateRequestError } from './private-request';

const credential = { eventId: fictionalEvent.id, linkId: fictionalId(910), token: 'A'.repeat(43) };
const signal = new AbortController().signal;
const round: RoundScores = { ...fictionalRoundScores, permissions: {
  role: 'tester', writePlayerIds: fictionalRoundScores.cards.map((card) => card.playerId), canManageGames: false,
} };
const workspace: EventWorkspace = { ...fictionalWorkspace, event: { ...fictionalEvent, role: 'viewer' },
  testerAccess: true, canViewScores: true, rounds: fictionalWorkspace.rounds.map((saved) => ({
    ...saved, players: saved.players.map((player) => ({ playerId: player.playerId, displayName: player.displayName })),
  })) };
const change: ScoreChange = { ...fictionalChange, recordedBy: {
  kind: 'tester-link', eventId: credential.eventId, linkId: credential.linkId,
} };

function fixture(value: unknown = round, status = 200) {
  const send = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(value), { status })));
  const token = vi.fn<() => Promise<string>>().mockResolvedValue('fictional-owner-token');
  return { send, token, client: createTesterAccessClient('https://fictional.example.test/api', token, send) };
}

describe('private no-account tester transport', () => {
  it('renews an existing link through conditional owner authentication without sending its secret or selecting expiry', async () => {
    const result = { operationId: fictionalId(912), linkId: credential.linkId, state: 'active' };
    const f = fixture(result);
    const input = { linkId: credential.linkId, revision: fictionalId(911) };
    await f.client.renew(credential.eventId, input, 'event-etag', result.operationId, signal);
    expect(f.send.mock.calls[0]?.[0]).toBe(`https://fictional.example.test/api/events/${credential.eventId}/test-access/renew`);
    const init = f.send.mock.calls[0]?.[1];
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify(input) });
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fictional-owner-token');
    expect(new Headers(init?.headers).get('if-match')).toBe('event-etag');
    expect(new Headers(init?.headers).get('idempotency-key')).toBe(result.operationId);
    await expect(f.client.renew(credential.eventId, input, 'event-etag', fictionalId(999), signal))
      .rejects.toThrow('Retry the original');
  });
  it('generates strong secrets and parses only exact private fragment routes', async () => {
    const secret = await generateTesterSecret();
    expect(secret.token).toMatch(/^[a-zA-Z0-9_-]{43}$/);
    expect(secret.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    const url = testerUrl('https://fictional.example.test/?owner=1#access', { ...credential, token: secret.token });
    expect(new URL(url).search).toBe('');
    expect(readTesterFragment(new URL(url).hash)).toEqual({ ...credential, token: secret.token });
    for (const hash of ['', '#events', `#tester?event=${credential.eventId}&link=${credential.linkId}&token=${credential.token}&role=owner`,
      `#tester?event=${credential.eventId}&event=${credential.eventId}&link=${credential.linkId}&token=${credential.token}`,
      `#tester?event=${credential.eventId}&link=${credential.linkId}&token=${'A'.repeat(42)}B`]) {
      expect(readTesterFragment(hash)).toBeUndefined();
    }
    expect(() => testerUrl('http://untrusted.invalid', credential)).toThrow('secure');
    expect(() => testerUrl('https://user:password@fictional.example.test', credential)).toThrow('secure');
  });
  it('loads only the scoped workspace with Tester authorization, never an identity token or cookie', async () => {
    const f = fixture(workspace);
    expect(await f.client.workspace(credential, signal)).toEqual(workspace);
    expect(f.token).not.toHaveBeenCalled();
    expect(f.send.mock.calls[0]?.[0]).toBe(`https://fictional.example.test/api/tester/events/${credential.eventId}/workspace`);
    const init = f.send.mock.calls[0]?.[1];
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'omit' });
    expect(new Headers(init?.headers).get('authorization')).toBe(`Tester ${credential.linkId}.${credential.token}`);
    expect(f.send.mock.calls[0]?.[0]).not.toContain(credential.token);
  });
  it('loads all-group cards and conditionally saves with exact tester-link audit identity', async () => {
    const f = fixture(scoreResult(change, round));
    const client = f.client.bindScores(credential);
    const result = await client.save(credential.eventId, round.roundId, change.playerId, 1, change.after, null, change.id, signal);
    expect(result.change.recordedBy).toEqual(change.recordedBy);
    expect(f.token).not.toHaveBeenCalled();
    const init = f.send.mock.calls[0]?.[1];
    expect(init).toMatchObject({ method: 'PUT', body: JSON.stringify({ score: change.after }) });
    const headers = new Headers(init?.headers);
    expect(headers.get('if-none-match')).toBe('*');
    expect(headers.get('idempotency-key')).toBe(change.id);
    expect(headers.get('authorization')).toBe(`Tester ${credential.linkId}.${credential.token}`);
    const read = fixture();
    expect(await read.client.bindScores(credential).load(credential.eventId, round.roundId, signal)).toEqual(round);
  });
  it('rejects cross-event use and management/history before any network call', async () => {
    const f = fixture();
    const client = f.client.bindScores(credential);
    await expect(client.load(fictionalId(999), round.roundId, signal)).rejects.toThrow('limited to its event');
    await expect(client.save(fictionalId(999), round.roundId, change.playerId, 1, change.after, null, change.id, signal))
      .rejects.toThrow('limited to its event');
    await expect(client.history(credential.eventId, round.roundId, change.playerId, signal)).rejects.toBeInstanceOf(PrivateRequestError);
    await expect(client.saveGames(credential.eventId, round.roundId, [], null, change.id, signal)).rejects.toBeInstanceOf(PrivateRequestError);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.token).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404])('ends guest access on %i without a sign-in instruction', async (status) => {
    const f = fixture({ code: 'TESTER_ACCESS_UNAVAILABLE' }, status);
    await expect(f.client.workspace(credential, signal)).rejects.toBeInstanceOf(SessionExpiredError);
    await expect(f.client.bindScores(credential).load(credential.eventId, round.roundId, signal))
      .rejects.toThrow('Ask the organizer for a new link');
    expect(f.token).not.toHaveBeenCalled();
  });
  it('rejects wrong-event/private/owner-shaped workspace responses and non-tester permissions', async () => {
    for (const value of [fictionalWorkspace, { ...workspace, testerAccess: undefined },
      { ...workspace, event: { ...workspace.event, id: fictionalId(999) } },
      { ...workspace, rounds: fictionalWorkspace.rounds }]) {
      await expect(fixture(value).client.workspace(credential, signal)).rejects.toThrow('Invalid tester workspace');
    }
    await expect(fixture(fictionalRoundScores).client.bindScores(credential).load(credential.eventId, round.roundId, signal))
      .rejects.toThrow('Invalid tester score permissions');
    const foreignActor = { ...change, recordedBy: { kind: 'tester-link' as const, eventId: credential.eventId, linkId: fictionalId(999) } };
    await expect(fixture(scoreResult(foreignActor, round)).client.bindScores(credential)
      .save(credential.eventId, round.roundId, change.playerId, 1, change.after, null, change.id, signal))
      .rejects.toThrow('outcome is uncertain');
  });
  it('keeps link management on JWT owner routes with conditional/idempotent requests', async () => {
    const result = { operationId: fictionalId(911), linkId: credential.linkId, state: 'active' };
    const f = fixture(result);
    await f.client.create(credential.eventId, { linkId: credential.linkId, tokenHash: 'a'.repeat(64) },
      'fictional-etag', result.operationId, signal);
    expect(f.token).toHaveBeenCalledOnce();
    expect(f.send.mock.calls[0]?.[0]).toBe(`https://fictional.example.test/api/events/${credential.eventId}/test-access/create`);
    const init = f.send.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fictional-owner-token');
    expect(new Headers(init?.headers).get('if-match')).toBe('fictional-etag');
    expect(new Headers(init?.headers).get('idempotency-key')).toBe(result.operationId);
    expect(init?.body).not.toContain(credential.token);
    await expect(f.client.create(credential.eventId, { linkId: credential.linkId, tokenHash: 'a'.repeat(64) },
      'fictional-etag', fictionalId(999), signal)).rejects.toThrow('Retry the original');
  });
});
