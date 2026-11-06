import { afterEach, describe, expect, it, vi } from 'vitest';
import { creator, event, member } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { isTesterAccessManagement } from '../../../src/contracts/test-access.js';
import { testerLinkLifetimeMs } from '../../../src/domain/test-access.js';
import { TableEventStore } from '../events/store.js';
import { TableTesterAccessStore } from './store.js';
import { testerFixture } from './test-support.js';

afterEach(() => vi.useRealTimers());

describe('owner-managed private tester links', () => {
  it('retains saved event and round dates in the scoped tester projection without exposing owner fields', async () => {
    const f = await testerFixture();
    const before = await f.workspace.get(creator, event.id);
    await f.workspace.save(creator, event.id, { ...f.input, startDate: '2024-02-29',
      rounds: f.input.rounds.map((round) => ({ ...round, startDate: '2026-11-06' })) }, before.etag);
    const workspace = await f.workspace.get(f.actor, event.id);
    expect(workspace.event).toMatchObject({ role: 'viewer', startDate: '2024-02-29' });
    expect(workspace.rounds[0]?.startDate).toBe('2026-11-06');
    expect(JSON.stringify(workspace)).not.toContain(creator.objectId);
    expect(workspace.rounds[0]?.players.every((player) => player.handicapIndex === undefined)).toBe(true);
  });
  it('creates server-expiring hash-only grants and allowlists owner projections', async () => {
    const f = await testerFixture();
    const management = await f.testers.list(creator, event.id);
    expect(isTesterAccessManagement(management)).toBe(true);
    const link = management.links[0];
    expect(link?.state).toBe('active');
    expect(testerLinkLifetimeMs).toBe(604_800_000);
    expect(Date.parse(link?.expiresAt ?? '') - Date.parse(link?.createdAt ?? '')).toBe(testerLinkLifetimeMs);
    expect(Object.keys(link ?? {}).sort()).toEqual(['createdAt', 'expiresAt', 'linkId', 'revision', 'state']);
    const persisted = f.row(`tester-link:${f.linkId}`);
    expect(persisted.tokenHash).toBe(f.tokenHash);
    expect(JSON.stringify([...f.rows.values()])).not.toContain(f.token);
    expect(JSON.stringify(management)).not.toContain(f.tokenHash);
    expect(JSON.stringify(management)).not.toContain(creator.objectId);
    expect(f.actor).toEqual({ kind: 'tester-link', eventId: event.id, linkId: f.linkId });
  });

  it('keeps new links valid beyond one day and ends access exactly seven days after creation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2026-01-01T00:00:00Z');
    const f = await testerFixture();
    expect(f.row(`tester-link:${f.linkId}`).expiresAt).toBe('2026-01-08T00:00:00.000Z');
    vi.setSystemTime('2026-01-07T23:59:59.999Z');
    expect(await f.testers.verify(event.id, f.header)).toEqual(f.actor);
    vi.setSystemTime('2026-01-08T00:00:00Z');
    await expect(f.testers.verify(event.id, f.header)).rejects.toMatchObject({ status: 403 });
  });

  it('renews an expired legacy link for seven days from now without changing its URL, creation or digest', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2026-01-01T00:00:00Z');
    const f = await testerFixture();
    const original = f.row(`tester-link:${f.linkId}`);
    f.seed({ ...original, expiresAt: '2026-01-02T00:00:00.000Z' });
    vi.setSystemTime('2026-01-03T00:00:00Z');
    await expect(f.testers.verify(event.id, f.header)).rejects.toMatchObject({ status: 403 });
    const before = await f.testers.list(creator, event.id);
    expect(before.links[0]?.expiresAt).toBe('2026-01-02T00:00:00.000Z');
    expect(f.row(`tester-link:${f.linkId}`).expiresAt).toBe('2026-01-02T00:00:00.000Z');
    const legacy = before.links[0];
    if (!legacy) throw new Error('Missing fictional legacy link.');
    const input = { linkId: f.linkId, revision: legacy.revision };
    f.submit.mockImplementationOnce((actions) => { f.apply(actions); return Promise.reject(new Error('Fictional lost renewal reply')); });
    const result = await f.testers.renew(creator, event.id, input, before.etag, identifier(3030));
    const renewed = f.row(`tester-link:${f.linkId}`);
    expect(renewed).toMatchObject({ tokenHash: original.tokenHash, createdAt: original.createdAt,
      renewedAt: '2026-01-03T00:00:00.000Z', expiresAt: '2026-01-10T00:00:00.000Z', revision: identifier(3030) });
    expect(await f.testers.verify(event.id, f.header)).toEqual(f.actor);
    expect(f.row(`tester-request:${identifier(3030)}`)).toMatchObject({ action: 'renew',
      previousExpiresAt: '2026-01-02T00:00:00.000Z', expiresAt: renewed.expiresAt, actorObjectId: creator.objectId });
    vi.setSystemTime('2026-01-04T00:00:00Z');
    expect(await f.testers.renew(creator, event.id, input, before.etag, identifier(3030))).toEqual(result);
    expect(f.row(`tester-link:${f.linkId}`).expiresAt).toBe(renewed.expiresAt);
    const current = await f.testers.list(creator, event.id);
    await f.testers.renew(creator, event.id, { linkId: f.linkId, revision: identifier(3030) }, current.etag, identifier(3031));
    expect(f.row(`tester-link:${f.linkId}`)).toMatchObject({ createdAt: original.createdAt,
      renewedAt: '2026-01-04T00:00:00.000Z', expiresAt: '2026-01-11T00:00:00.000Z', tokenHash: original.tokenHash });
  });

  it('rejects unauthorized, stale, revoked or concurrently revoked renewal without extending a grant', async () => {
    const f = await testerFixture();
    const current = await f.testers.list(creator, event.id);
    const link = f.row(`tester-link:${f.linkId}`);
    const listed = current.links[0];
    if (!listed) throw new Error('Missing fictional current link.');
    const input = { linkId: f.linkId, revision: listed.revision };
    await expect(f.testers.renew(member, event.id, input, current.etag, identifier(3030))).rejects.toMatchObject({ status: 403 });
    await expect(f.testers.renew(creator, event.id, { ...input, revision: identifier(999) }, current.etag, identifier(3030)))
      .rejects.toMatchObject({ status: 409 });
    f.submit.mockImplementationOnce(async (actions) => {
      await f.revoke();
      f.apply(actions);
      return { status: 202, subResponses: [], getResponseForEntity: () => undefined };
    });
    await expect(f.testers.renew(creator, event.id, input, current.etag, identifier(3030))).rejects.toMatchObject({ status: 409 });
    const revoked = await f.testers.list(creator, event.id);
    const revokedLink = revoked.links[0];
    if (!revokedLink) throw new Error('Missing fictional revoked link.');
    await expect(f.testers.renew(creator, event.id, { linkId: f.linkId, revision: revokedLink.revision },
      revoked.etag, identifier(3031))).rejects.toMatchObject({ code: 'TESTER_LINK_REVOKED' });
    expect(f.row(`tester-link:${f.linkId}`)).toMatchObject({ state: 'revoked', expiresAt: link.expiresAt });
    expect(f.rows.has(`${event.id}|tester-request:${identifier(3030)}`)).toBe(false);
  });

  it('rejects nonowners, exact revision conflicts, reused operations and duplicate link IDs', async () => {
    const f = await testerFixture();
    const current = await f.testers.list(creator, event.id);
    const input = { linkId: identifier(3010), tokenHash: f.tokenHash };
    await expect(f.testers.list(member, event.id)).rejects.toMatchObject({ status: 403 });
    await expect(f.testers.create(member, event.id, input, current.etag, identifier(3011))).rejects.toMatchObject({ status: 403 });
    await expect(f.testers.create(creator, event.id, input, 'stale-revision', identifier(3011))).rejects.toMatchObject({ status: 409 });
    await f.testers.create(creator, event.id, input, current.etag, identifier(3011));
    await expect(f.testers.create(creator, event.id, { ...input, tokenHash: '0'.repeat(64) }, current.etag, identifier(3011)))
      .rejects.toMatchObject({ code: 'TESTER_REQUEST_CONFLICT' });
    const latest = await f.testers.list(creator, event.id);
    await expect(f.testers.create(creator, event.id, input, latest.etag, identifier(3012))).rejects.toMatchObject({ status: 409 });
    await expect(f.testers.revoke(creator, event.id, { linkId: f.linkId, revision: identifier(9999) }, latest.etag, identifier(3013)))
      .rejects.toMatchObject({ status: 409 });
  });

  it('uses immutable creation/revocation receipts after lost responses without extending expiry', async () => {
    const f = await testerFixture();
    const before = await f.testers.list(creator, event.id);
    const input = { linkId: identifier(3010), tokenHash: f.tokenHash };
    f.submit.mockImplementationOnce((actions) => { f.apply(actions); return Promise.reject(new Error('Fictional lost response')); });
    const created = await f.testers.create(creator, event.id, input, before.etag, identifier(3011));
    const saved = f.row(`tester-link:${input.linkId}`);
    expect(await f.testers.create(creator, event.id, input, before.etag, identifier(3011))).toEqual(created);
    expect(f.row(`tester-link:${input.linkId}`).expiresAt).toBe(saved.expiresAt);
    const current = await f.testers.list(creator, event.id);
    const revoke = { linkId: input.linkId, revision: created.operationId };
    f.submit.mockImplementationOnce((actions) => { f.apply(actions); return Promise.reject(new Error('Fictional lost response')); });
    const revoked = await f.testers.revoke(creator, event.id, revoke, current.etag, identifier(3012));
    expect(await f.testers.revoke(creator, event.id, revoke, current.etag, identifier(3012))).toEqual(revoked);
  });

  it.each(['missing', 'wrong', 'malformed', 'expired', 'revoked', 'archived', 'cross-event'] as const)(
    'fails closed for %s guest credentials', async (failure) => {
      const f = await testerFixture();
      let header: string | null = f.header;
      let eventId = event.id;
      if (failure === 'missing') header = null;
      if (failure === 'wrong') header = `Tester ${f.linkId}.${Buffer.alloc(32, 20).toString('base64url')}`;
      if (failure === 'malformed') header = `${f.header} extra`;
      if (failure === 'expired') vi.spyOn(Date, 'now').mockReturnValue(Date.parse(String(f.row(`tester-link:${f.linkId}`).expiresAt)));
      if (failure === 'revoked') await f.revoke();
      if (failure === 'archived') {
        const owner = await f.workspace.get(creator, event.id);
        await new TableEventStore(f.table).setStatus(creator, event.id, 'archived', owner.etag);
      }
      if (failure === 'cross-event') eventId = identifier(9999);
      await expect(f.testers.verify(eventId, header)).rejects.toMatchObject({ status: 403, code: 'TESTER_ACCESS_ENDED' });
      vi.restoreAllMocks();
    },
  );

  it('forbids new archived links but allows owner revocation there', async () => {
    const f = await testerFixture();
    const owner = await f.workspace.get(creator, event.id);
    await new TableEventStore(f.table).setStatus(creator, event.id, 'archived', owner.etag);
    const current = await f.testers.list(creator, event.id);
    await expect(f.testers.create(creator, event.id, { linkId: identifier(3010), tokenHash: f.tokenHash }, current.etag, identifier(3011)))
      .rejects.toMatchObject({ code: 'EVENT_ARCHIVED' });
    const link = current.links[0];
    if (!link) throw new Error('Missing fictional archived link.');
    await expect(f.testers.renew(creator, event.id, { linkId: link.linkId, revision: link.revision }, current.etag, identifier(3012)))
      .rejects.toMatchObject({ code: 'EVENT_ARCHIVED' });
    expect(await f.revoke()).toMatchObject({ state: 'revoked' });
  });

  it('retains existing one-golfer scoring and has no low link-count product cap', async () => {
    const f = await scoringFixture(1);
    const testers = new TableTesterAccessStore(f.table);
    for (let index = 0; index < 55; index++) {
      const current = await testers.list(creator, event.id);
      await testers.create(creator, event.id, { linkId: identifier(4000 + index), tokenHash: '0'.repeat(64) }, current.etag, identifier(5000 + index));
    }
    const charge = vi.fn().mockResolvedValue(undefined);
    expect((await testers.list(creator, event.id, charge)).links).toHaveLength(55);
    expect(charge).toHaveBeenCalledTimes(2);
    const saved = await f.write();
    expect(saved.round.cards).toHaveLength(1);
  });
});
