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
  it('creates server-expiring hash-only grants and allowlists owner projections', async () => {
    const f = await testerFixture();
    const management = await f.testers.list(creator, event.id);
    expect(isTesterAccessManagement(management)).toBe(true);
    const link = management.links[0];
    expect(link?.state).toBe('active');
    expect(Date.parse(link?.expiresAt ?? '') - Date.parse(link?.createdAt ?? '')).toBe(testerLinkLifetimeMs);
    expect(Object.keys(link ?? {}).sort()).toEqual(['createdAt', 'expiresAt', 'linkId', 'revision', 'state']);
    const persisted = f.row(`tester-link:${f.linkId}`);
    expect(persisted.tokenHash).toBe(f.tokenHash);
    expect(JSON.stringify([...f.rows.values()])).not.toContain(f.token);
    expect(JSON.stringify(management)).not.toContain(f.tokenHash);
    expect(JSON.stringify(management)).not.toContain(creator.objectId);
    expect(f.actor).toEqual({ kind: 'tester-link', eventId: event.id, linkId: f.linkId });
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
