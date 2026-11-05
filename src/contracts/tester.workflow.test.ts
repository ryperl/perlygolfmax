// @vitest-environment node
import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import { createTesterHandler } from '../../api/src/test-access/handlers.js';
import type { TesterAction } from '../../api/src/test-access/handlers.js';
import { TableTesterAccessStore } from '../../api/src/test-access/store.js';
import { ApiError } from '../../api/src/errors.js';
import { scoringFixture } from '../../api/test/scoring-fixtures.js';
import { creator, event } from '../../api/test/fixtures.js';
import { identifier } from '../../api/test/catalog-fixtures.js';
import { createTesterAccessClient, generateTesterSecret } from '../client/test-access';
import { SessionExpiredError } from '../client/events';

describe('no-account tester HTTP/client/storage workflow', () => {
  it('creates a scoped link as owner, scores another group without any account, then ends access on revocation', async () => {
    const stored = await scoringFixture(3);
    const saved = await stored.workspace.save(creator, event.id, { ...stored.input,
      rounds: stored.input.rounds.map((round) => ({ ...round, groups: [
        { number: 1, playerIds: stored.input.playerIds.slice(0, 2) },
        { number: 2, playerIds: stored.input.playerIds.slice(2) },
      ] })),
    }, stored.saved.etag);
    const verify = vi.fn((header: string | null) => header === 'Bearer fictional-owner'
      ? Promise.resolve(creator) : Promise.reject(new ApiError(401, 'AUTHENTICATION_REQUIRED')));
    const api = { verify, limiter: { check: vi.fn().mockResolvedValue(undefined) },
      testers: new TableTesterAccessStore(stored.table), workspace: stored.workspace, scores: stored.scores };
    const logs = vi.fn();
    const context = new InvocationContext({ invocationId: 'fictional-no-account-workflow', logHandler: logs });
    const send = vi.fn<typeof fetch>().mockImplementation(async (target, options) => {
      const url = typeof target === 'string' ? target : target instanceof URL ? target.href : target.url;
      const parts = new URL(url).pathname.replace(/^\/api\//, '').split('/');
      let action: TesterAction;
      let params: Record<string, string>;
      if (parts[0] === 'tester') {
        params = { id: parts[2] ?? '', roundId: parts[4] ?? '', playerId: parts[6] ?? '', holeNumber: parts[8] ?? '' };
        if (parts[3] === 'workspace') action = 'workspace';
        else if (parts[5] === 'scores') action = 'scores';
        else if (parts[5] === 'players' && parts[7] === 'holes') action = 'score-hole';
        else throw new Error('Unregistered fictional tester route.');
      } else {
        params = { id: parts[1] ?? '' };
        if (parts[2] !== 'test-access') throw new Error('Unregistered fictional owner route.');
        if (parts[3] === 'create' || parts[3] === 'revoke') action = parts[3];
        else if (parts.length === 3) action = 'list';
        else throw new Error('Unregistered fictional management action.');
      }
      const request = new HttpRequest({ url, method: options?.method ?? 'GET', params,
        headers: Object.fromEntries(new Headers(options?.headers).entries()),
        ...(typeof options?.body === 'string' ? { body: { string: options.body } } : {}),
      });
      const result = await createTesterHandler(() => api, action)(request, context);
      return new Response(JSON.stringify(result.jsonBody), { status: result.status ?? 200 });
    });
    const getToken = vi.fn<() => Promise<string>>().mockResolvedValue('fictional-owner');
    const client = createTesterAccessClient('https://fictional.example.test/api', getToken, send);
    const signal = new AbortController().signal;
    const secret = await generateTesterSecret();
    const credential = { eventId: event.id, linkId: identifier(4000), token: secret.token };
    const management = await client.list(event.id, signal);
    expect(management.etag).toBe(saved.etag);
    const input = { linkId: credential.linkId, tokenHash: secret.tokenHash };
    const created = await client.create(event.id, input, management.etag, identifier(4001), signal);
    expect(created.state).toBe('active');
    expect(await client.create(event.id, input, management.etag, identifier(4001), signal)).toEqual(created);
    const beforeGuest = getToken.mock.calls.length;
    const jwtBeforeGuest = verify.mock.calls.length;
    const workspace = await client.workspace(credential, signal);
    expect(workspace.event.role).toBe('viewer');
    expect(workspace.testerAccess).toBe(true);
    expect(JSON.stringify(workspace)).not.toContain('handicapIndex');
    const scores = client.bindScores(credential);
    const cards = await scores.load(event.id, stored.roundId, signal);
    expect(cards.groups).toHaveLength(2);
    expect(cards.permissions).toEqual({ role: 'tester', writePlayerIds: stored.input.playerIds, canManageGames: false });
    const target = stored.input.playerIds[2];
    if (!target) throw new Error('Missing fictional other-group golfer.');
    const result = await scores.save(event.id, stored.roundId, target, 1, { kind: 'strokes', strokes: 4 },
      null, identifier(4002), signal);
    expect(result.change.recordedBy).toEqual({ kind: 'tester-link', eventId: event.id, linkId: credential.linkId });
    expect(result.round.cards.find((card) => card.playerId === target)?.holes[0]?.score).toEqual({ kind: 'strokes', strokes: 4 });
    expect(result.round.setupLocked).toBe(true);
    expect(await scores.save(event.id, stored.roundId, target, 1, { kind: 'strokes', strokes: 4 },
      null, identifier(4002), signal)).toEqual(result);
    expect(getToken).toHaveBeenCalledTimes(beforeGuest);
    expect(verify).toHaveBeenCalledTimes(jwtBeforeGuest);
    const members = [...stored.rows.values()].filter((row) => row.partitionKey === event.id
      && typeof row.rowKey === 'string' && row.rowKey.startsWith('member:'));
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ ...creator, role: 'owner' });
    await expect(client.workspace({ ...credential, eventId: identifier(999) }, signal)).rejects.toBeInstanceOf(SessionExpiredError);
    const latest = await client.list(event.id, signal);
    const link = latest.links.find((entry) => entry.linkId === credential.linkId);
    if (!link) throw new Error('Missing saved fictional tester link.');
    await client.revoke(event.id, { linkId: link.linkId, revision: link.revision }, latest.etag, identifier(4003), signal);
    await expect(scores.load(event.id, stored.roundId, signal)).rejects.toBeInstanceOf(SessionExpiredError);
    await expect(scores.save(event.id, stored.roundId, target, 2, { kind: 'strokes', strokes: 5 },
      result.round.cards.find((card) => card.playerId === target)?.etag ?? null, identifier(4004), signal))
      .rejects.toBeInstanceOf(SessionExpiredError);
    expect((await stored.scores.get(creator, event.id, stored.roundId)).cards.find((card) => card.playerId === target)?.holes[0]?.score)
      .toEqual({ kind: 'strokes', strokes: 4 });
    expect(JSON.stringify([...stored.rows.values()])).not.toContain(secret.token);
    expect(JSON.stringify(logs.mock.calls)).not.toContain(secret.token);
    for (const [url, options] of send.mock.calls) {
      expect(url).not.toContain(secret.token);
      if (typeof options?.body === 'string') expect(options.body).not.toContain(secret.token);
    }
  });
});
