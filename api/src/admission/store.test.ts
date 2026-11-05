import { describe, expect, it } from 'vitest';
import { creator, event, member } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { TableEventStore } from '../events/store.js';
import { admissionIndexKey, admissionIndexPartition, assertEventAccessUnchanged, readEventAccess } from '../event-access.js';
import { admissionFixture } from './test-support.js';

describe('private player invitation admission', () => {
  it('creates a digest-only link, claims pending, publishes a bound player and global viewer, then revokes without deleting scores', async () => {
    const f = admissionFixture();
    const otherEvent = identifier(999);
    f.seed({ partitionKey: otherEvent, rowKey: 'event', ...event, id: otherEvent });
    await expect(readEventAccess(f.table, member, event.id)).rejects.toMatchObject({ status: 404 });
    await f.invite();
    expect(f.row(`admission:${f.inviteId}`)).toMatchObject({ state: 'open', tokenHash: f.tokenHash, expiresAt: '2026-01-03T00:00:00.000Z' });
    expect(JSON.stringify([...f.rows.values()])).not.toContain(f.token);
    const pending = await f.claim();
    expect(pending).toMatchObject({ state: 'pending', displayName: 'Fictional Golfer 200', eventName: event.name });
    await expect(readEventAccess(f.table, member, event.id)).rejects.toMatchObject({ status: 404 });
    const ownerList = await f.store.list(creator, event.id);
    expect(JSON.stringify(ownerList)).not.toContain(member.objectId);
    expect(JSON.stringify(ownerList)).not.toContain(f.tokenHash);
    expect(ownerList).toMatchObject({ viewingPolicy: 'all-active-events', invitations: [{ verificationCode: pending.verificationCode }] });
    await f.approve();
    const access = await readEventAccess(f.table, member, event.id);
    expect(access).toMatchObject({ summary: { role: 'member' }, admittedPlayer: true, viewerPlayerId: f.playerId });
    expect(access.member?.etag).toBe(f.row(`member:${member.objectId}`).etag);
    expect(await readEventAccess(f.table, member, otherEvent)).toMatchObject({ summary: { role: 'viewer' }, admittedPlayer: true });
    expect(await readEventAccess(f.table, member, otherEvent)).not.toHaveProperty('member');
    const discovered = await new TableEventStore(f.table).list(member);
    expect(discovered.events.map((item) => [item.id, item.role])).toEqual([[event.id, 'member'], [otherEvent, 'viewer']]);
    f.seed({ partitionKey: event.id, rowKey: 'score:fictional', content: 'Preserved fictional score' });
    const approved = f.row(`admission:${f.inviteId}`);
    await f.store.revoke(creator, event.id, { inviteId: f.inviteId, revision: String(approved.revision) }, f.etag(), identifier(403));
    expect(f.row('score:fictional').content).toBe('Preserved fictional score');
    expect(f.row(`member:${member.objectId}`).revoked).toBe(true);
    expect(f.row(`player-account:${f.playerId}`).revoked).toBe(true);
    await expect(assertEventAccessUnchanged(f.table, member, event.id, access)).rejects.toMatchObject({ status: 404 });
    await expect(readEventAccess(f.table, member, otherEvent)).rejects.toMatchObject({ status: 404 });
    expect((await new TableEventStore(f.table).list(member)).events).toEqual([]);
    expect((await f.store.status(member, event.id, f.inviteId)).state).toBe('revoked');
    expect(f.rows.has(`${admissionIndexPartition(member)}|${admissionIndexKey(event.id, f.inviteId)}`)).toBe(true);
    expect(f.submit.mock.calls.every(([actions]) => new Set(actions.map((action) => action[1].partitionKey)).size === 1)).toBe(true);
  });
  it('fails explicitly when an admission-index provider repeats its continuation cursor', async () => {
    const f = admissionFixture();
    const normalList = f.list.getMockImplementation();
    if (!normalList) throw new Error('Missing fictional list implementation.');
    f.list.mockImplementation((options) => {
      const source = normalList(options);
      source.byPage = async function* () {
        yield await Promise.resolve(Object.assign([], { continuationToken: 'fictional-repeated-cursor' }));
      };
      return source;
    });
    await expect(readEventAccess(f.table, member, event.id)).rejects.toMatchObject({ status: 503, code: 'INVALID_ADMISSION_INDEX' });
    expect(f.list).toHaveBeenCalledTimes(2);
  });

  it('replays exact operation IDs, binds receipts to actor/content and never reacquires a revoked grant', async () => {
    const f = admissionFixture();
    const etag = f.etag();
    const input = { inviteId: f.inviteId, playerId: f.playerId, tokenHash: f.tokenHash };
    const original = await f.store.invite(creator, event.id, input, etag, identifier(400));
    expect(await f.store.invite(creator, event.id, input, etag, identifier(400))).toEqual(original);
    await expect(f.store.invite(creator, event.id, { ...input, tokenHash: 'a'.repeat(64) }, etag, identifier(400))).rejects.toMatchObject({ code: 'ADMISSION_REQUEST_CONFLICT' });
    const claim = await f.claim();
    expect(await f.claim()).toEqual(claim);
    await expect(f.store.claim({ ...member, objectId: identifier(44) }, event.id, { inviteId: f.inviteId, token: f.token }, identifier(401)))
      .rejects.toMatchObject({ code: 'ADMISSION_REQUEST_CONFLICT' });
    const approvalEtag = f.etag();
    const approval = { inviteId: f.inviteId, revision: String(f.row(`admission:${f.inviteId}`).revision), verificationCode: claim.verificationCode };
    expect(await f.store.approve(creator, event.id, approval, approvalEtag, identifier(402))).toEqual(await f.store.approve(creator, event.id, approval, approvalEtag, identifier(402)));
    await f.store.revoke(creator, event.id, { inviteId: f.inviteId, revision: identifier(402) }, f.etag(), identifier(403));
    await expect(f.store.approve(creator, event.id, approval, approvalEtag, identifier(402))).rejects.toMatchObject({ code: 'ADMISSION_CHANGED' });
  });

  it('fails closed until index publication and final activation, then completes an exact original approval retry after a lost response', async () => {
    const f = admissionFixture();
    await f.invite();
    const pending = await f.claim();
    const input = { inviteId: f.inviteId, revision: identifier(401), verificationCode: pending.verificationCode };
    const expected = f.etag();
    f.create.mockRejectedValueOnce(new Error('Fictional discovery publication unavailable'));
    await expect(f.store.approve(creator, event.id, input, expected, identifier(402))).rejects.toThrow('Fictional discovery');
    expect(f.row(`admission:${f.inviteId}`).published).toBe(false);
    expect((await f.store.list(creator, event.id)).invitations[0]?.state).toBe('pending');
    await expect(readEventAccess(f.table, member, event.id)).rejects.toMatchObject({ status: 404 });
    await expect(f.store.status(member, event.id, f.inviteId)).rejects.toMatchObject({ status: 404 });
    f.submit.mockImplementationOnce((actions) => {
      f.apply(actions);
      return Promise.reject(new Error('Fictional activation response lost'));
    });
    await expect(f.store.approve(creator, event.id, input, expected, identifier(402))).rejects.toThrow('Fictional activation');
    expect(f.row(`admission:${f.inviteId}`).published).toBe(true);
    expect(await f.store.approve(creator, event.id, input, expected, identifier(402))).toMatchObject({ state: 'approved' });
    expect((await f.store.status(member, event.id, f.inviteId)).state).toBe('approved');
  });

  it('does not trust an index written before activation, or permit a final approval to race past revocation', async () => {
    const f = admissionFixture();
    await f.invite();
    const pending = await f.claim();
    const input = { inviteId: f.inviteId, revision: identifier(401), verificationCode: pending.verificationCode };
    const expected = f.etag();
    const normalSubmit = f.submit.getMockImplementation();
    if (!normalSubmit) throw new Error('Missing fictional transaction harness');
    let submissions = 0;
    f.submit.mockImplementation((actions) => {
      if (++submissions === 2) return Promise.reject(new Error('Fictional activation unavailable'));
      return normalSubmit(actions);
    });
    await expect(f.store.approve(creator, event.id, input, expected, identifier(402))).rejects.toThrow('Fictional activation');
    const indexKey = `${admissionIndexPartition(member)}|${admissionIndexKey(event.id, f.inviteId)}`;
    expect(f.rows.has(indexKey)).toBe(true);
    expect(f.row(`admission:${f.inviteId}`).published).toBe(false);
    await expect(readEventAccess(f.table, member, event.id)).rejects.toMatchObject({ status: 404 });
    await f.store.revoke(creator, event.id, { inviteId: f.inviteId, revision: identifier(402) }, f.etag(), identifier(403));
    await expect(f.store.approve(creator, event.id, input, expected, identifier(402))).rejects.toMatchObject({ status: 409 });
    expect(f.row(`member:${member.objectId}`).revoked).toBe(true);
    await expect(readEventAccess(f.table, member, event.id)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps published membership beyond link expiry and detects changes to every saved authority proof', async () => {
    const f = admissionFixture();
    await f.admit();
    f.setTime('2027-01-03T00:00:00Z');
    const access = await readEventAccess(f.table, member, event.id);
    expect(access.admittedPlayer).toBe(true);
    for (const proof of access.authorityProofs) {
      if (typeof proof.partitionKey !== 'string' || typeof proof.rowKey !== 'string') throw new Error('Invalid fictional proof');
      const key = `${proof.partitionKey}|${proof.rowKey}`;
      const before = f.rows.get(key);
      if (!before) throw new Error('Missing fictional proof');
      f.seed({ ...before, fictionalConcurrentRevision: true });
      await expect(assertEventAccessUnchanged(f.table, member, event.id, access)).rejects.toMatchObject({ status: 409 });
      f.rows.set(key, before);
    }
    await expect(assertEventAccessUnchanged(f.table, member, event.id, access)).resolves.toBeUndefined();
  });

  it('requires explicit replacement of open/pending links and rejects expired, replaced, wrong and used tokens', async () => {
    const f = admissionFixture();
    await f.invite();
    await expect(f.store.claim(member, event.id, { inviteId: f.inviteId, token: Buffer.alloc(32, 8).toString('base64url') }, identifier(401)))
      .rejects.toMatchObject({ status: 404 });
    await f.claim();
    await expect(f.store.claim({ ...member, objectId: identifier(45) }, event.id, { inviteId: f.inviteId, token: f.token }, identifier(405)))
      .rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE' });
    const replacement = { inviteId: identifier(301), playerId: f.playerId, tokenHash: f.tokenHash };
    await expect(f.store.invite(creator, event.id, replacement, f.etag(), identifier(404))).rejects.toMatchObject({ code: 'EXPLICIT_REPLACEMENT_REQUIRED' });
    await f.store.invite(creator, event.id, { ...replacement, replaceInviteId: f.inviteId }, f.etag(), identifier(404));
    expect((await f.store.status(member, event.id, f.inviteId)).state).toBe('replaced');
    await expect(f.store.claim(member, event.id, { inviteId: f.inviteId, token: f.token }, identifier(405))).rejects.toMatchObject({ status: 409 });
    f.setTime('2026-01-03T00:00:00Z');
    await expect(f.store.claim(member, event.id, { inviteId: replacement.inviteId, token: f.token }, identifier(406))).rejects.toMatchObject({ status: 404 });
  });

  it('guards wrong event, roster, account, owner linking, expired approval, verification and tenant boundaries', async () => {
    const f = admissionFixture();
    await expect(f.store.invite(member, event.id, { inviteId: f.inviteId, playerId: f.playerId, tokenHash: f.tokenHash }, f.etag(), identifier(400)))
      .rejects.toMatchObject({ status: 404 });
    await expect(f.store.invite(creator, event.id, { inviteId: f.inviteId, playerId: identifier(999), tokenHash: f.tokenHash }, f.etag(), identifier(400)))
      .rejects.toMatchObject({ code: 'ROSTER_PLAYER_REQUIRED' });
    await f.invite();
    await expect(f.store.claim(creator, event.id, { inviteId: f.inviteId, token: f.token }, identifier(401))).rejects.toMatchObject({ code: 'ACCOUNT_ALREADY_BOUND' });
    await expect(f.store.claim(member, identifier(999), { inviteId: f.inviteId, token: f.token }, identifier(401))).rejects.toMatchObject({ status: 404 });
    const pending = await f.claim();
    await expect(f.store.status({ ...member, tenantId: identifier(888) }, event.id, f.inviteId)).rejects.toMatchObject({ status: 404 });
    await expect(f.store.approve(creator, event.id, { inviteId: f.inviteId, revision: identifier(401), verificationCode: '0000-0000' }, f.etag(), identifier(402)))
      .rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE' });
    expect(pending.verificationCode).not.toBe('0000-0000');
    f.setTime('2026-01-03T00:00:00Z');
    await expect(f.approve()).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE' });
  });

  it('allows only one winning concurrent claimant and serializes simultaneous approvals to one account and one golfer', async () => {
    const f = admissionFixture();
    await f.invite();
    const claims = await Promise.allSettled([
      f.claim(),
      f.store.claim({ ...member, objectId: identifier(45) }, event.id, { inviteId: f.inviteId, token: f.token }, identifier(405)),
    ]);
    expect(claims.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(claims.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const approvalEtag = f.etag();
    const approvalInput = { inviteId: f.inviteId, revision: identifier(401), verificationCode: String(f.row(`admission:${f.inviteId}`).verificationCode) };
    const approve = () => f.store.approve(creator, event.id, approvalInput, approvalEtag, identifier(402));
    const approved = await Promise.allSettled([approve(), approve()]);
    expect(approved.some((result) => result.status === 'fulfilled')).toBe(true);
    await approve();
    const second = { inviteId: identifier(301), playerId: identifier(201), tokenHash: f.tokenHash };
    await f.store.invite(creator, event.id, second, f.etag(), identifier(406));
    await expect(f.store.claim(member, event.id, { inviteId: second.inviteId, token: f.token }, identifier(407))).rejects.toMatchObject({ code: 'ACCOUNT_ALREADY_BOUND' });
    await expect(f.store.invite(creator, event.id, { inviteId: identifier(302), playerId: f.playerId, tokenHash: f.tokenHash }, f.etag(), identifier(408)))
      .rejects.toMatchObject({ code: 'PLAYER_ALREADY_BOUND' });
  });

  it('serializes approvals of two pending golfer claims made by the same account', async () => {
    const f = admissionFixture();
    await f.invite();
    const first = await f.claim();
    const secondId = identifier(301);
    await f.store.invite(creator, event.id, { inviteId: secondId, playerId: identifier(201), tokenHash: f.tokenHash }, f.etag(), identifier(404));
    const second = await f.store.claim(member, event.id, { inviteId: secondId, token: f.token }, identifier(405));
    const expected = f.etag();
    const results = await Promise.allSettled([
      f.store.approve(creator, event.id, { inviteId: f.inviteId, revision: identifier(401), verificationCode: first.verificationCode }, expected, identifier(402)),
      f.store.approve(creator, event.id, { inviteId: secondId, revision: identifier(405), verificationCode: second.verificationCode }, expected, identifier(406)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const winner = f.row(`member:${member.objectId}`);
    expect([f.playerId, identifier(201)]).toContain(winner.playerId);
    expect([...f.rows.values()].filter((row) => row.partitionKey === event.id && row.rowKey?.startsWith('player-account:') && row.revoked !== true)).toHaveLength(1);
    const loser = winner.playerId === f.playerId
      ? { inviteId: secondId, revision: identifier(405), verificationCode: second.verificationCode }
      : { inviteId: f.inviteId, revision: identifier(401), verificationCode: first.verificationCode };
    await expect(f.store.approve(creator, event.id, loser, f.etag(), identifier(407)))
      .rejects.toMatchObject({ code: 'ACCOUNT_ALREADY_BOUND' });
  });

  it('atomically rejects an owner revocation or archive between approval reads and publication', async () => {
    for (const change of ['archive', 'owner'] as const) {
      const f = admissionFixture();
      await f.invite();
      await f.claim();
      f.submit.mockImplementationOnce((actions) => {
        if (change === 'archive') f.seed({ ...f.row('event'), status: 'archived' });
        else f.seed({ ...f.row(`member:${creator.objectId}`), revoked: true });
        try { f.apply(actions); } catch (error) { return Promise.reject(error instanceof Error ? error : new Error('Fictional transaction failed')); }
        return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
      });
      await expect(f.approve()).rejects.toMatchObject({ status: 409 });
      expect(f.rows.has(`${event.id}|member:${member.objectId}`)).toBe(false);
    }
  });

  it('keeps archive owner-only, permits security revocation there, and uses an archived source grant to prove unrelated active viewing', async () => {
    const f = admissionFixture();
    await f.admit();
    f.seed({ ...f.row('event'), status: 'archived' });
    const other = identifier(999);
    f.seed({ partitionKey: other, rowKey: 'event', ...event, id: other, status: 'active' });
    await expect(readEventAccess(f.table, member, event.id)).rejects.toMatchObject({ status: 404 });
    expect((await readEventAccess(f.table, member, other)).summary.role).toBe('viewer');
    await expect(f.store.invite(creator, event.id, { inviteId: identifier(301), playerId: identifier(201), tokenHash: f.tokenHash }, f.etag(), identifier(404)))
      .rejects.toMatchObject({ code: 'EVENT_ARCHIVED' });
    await f.store.revoke(creator, event.id, { inviteId: f.inviteId, revision: identifier(402) }, f.etag(), identifier(403));
    await expect(readEventAccess(f.table, member, other)).rejects.toMatchObject({ status: 404 });
  });

  it.each(['member', 'binding', 'admission', 'index', 'source-event'] as const)('fails closed for missing %s counterpart and never trusts an index alone', async (part) => {
    const f = admissionFixture();
    await f.admit();
    const other = identifier(999);
    f.seed({ partitionKey: other, rowKey: 'event', ...event, id: other });
    const keys = {
      member: `${event.id}|member:${member.objectId}`, binding: `${event.id}|player-account:${f.playerId}`,
      admission: `${event.id}|admission:${f.inviteId}`,
      index: `${admissionIndexPartition(member)}|${admissionIndexKey(event.id, f.inviteId)}`, 'source-event': `${event.id}|event`,
    };
    f.rows.delete(keys[part]);
    await expect(readEventAccess(f.table, member, other)).rejects.toMatchObject({ status: 404 });
    await expect(readEventAccess(f.table, member, event.id)).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    ['player-account', 'tenantId', identifier(99)], ['player-account', 'objectId', identifier(99)],
    ['player-account', 'admissionId', identifier(99)], ['player-account', 'revoked', true],
    ['admission', 'claimObjectId', identifier(99)], ['admission', 'state', 'revoked'],
    ['admission', 'published', false], ['admission', 'playerId', identifier(99)],
    ['admission', 'verificationCode', 'corrupt'], ['admission', 'displayName', ''],
    ['admission', 'createdAt', 'not-an-instant'], ['player-account', 'revoked', 'invalid'],
  ])('does not trust corrupted %s %s source authority', async (kind, property, value) => {
    const f = admissionFixture();
    await f.admit();
    const key = kind === 'player-account' ? `player-account:${f.playerId}` : `admission:${f.inviteId}`;
    f.seed({ ...f.row(key), [property]: value });
    await expect(readEventAccess(f.table, member, event.id)).rejects.toMatchObject({ status: 404 });
  });

  it('walks every discovery page past stale proofs and retains viewing when another valid admission remains', async () => {
    const f = admissionFixture();
    await f.admit();
    const other = identifier(999);
    f.seed({ partitionKey: other, rowKey: 'event', ...event, id: other });
    const indexPartition = admissionIndexPartition(member);
    for (let index = 0; index < 70; index++) f.seed({
      partitionKey: indexPartition, rowKey: `${identifier(0)}:${identifier(index)}`, eventId: identifier(0), admissionId: identifier(index),
    });
    expect((await readEventAccess(f.table, member, other)).summary.role).toBe('viewer');
    expect(f.list.mock.calls.filter(([options]) => options?.queryOptions?.filter?.includes(indexPartition)).length).toBeGreaterThan(1);
    const secondSource = identifier(998);
    const sourceMember = f.row(`member:${member.objectId}`);
    const sourceBinding = f.row(`player-account:${f.playerId}`);
    const sourceAdmission = f.row(`admission:${f.inviteId}`);
    f.seed({ partitionKey: secondSource, rowKey: 'event', ...event, id: secondSource, status: 'active' });
    f.seed({ ...sourceMember, partitionKey: secondSource });
    f.seed({ ...sourceBinding, partitionKey: secondSource });
    f.seed({ ...sourceAdmission, partitionKey: secondSource });
    f.seed({ partitionKey: indexPartition, rowKey: admissionIndexKey(secondSource, f.inviteId), eventId: secondSource,
      admissionId: f.inviteId, playerId: f.playerId, ...member });
    await f.store.revoke(creator, event.id, { inviteId: f.inviteId, revision: identifier(402) }, f.etag(), identifier(403));
    expect((await readEventAccess(f.table, member, other)).summary.role).toBe('viewer');
    const target = await readEventAccess(f.table, member, event.id);
    expect(target.summary.role).toBe('viewer');
    expect(target).not.toHaveProperty('member');
    expect(target).not.toHaveProperty('viewerPlayerId');
  });

  it('preserves legacy scoped members and owner authority without inventing player bindings', async () => {
    const f = admissionFixture();
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'member' });
    const legacy = await readEventAccess(f.table, member, event.id);
    expect(legacy).toMatchObject({ summary: { role: 'member' }, admittedPlayer: false });
    expect(legacy).not.toHaveProperty('viewerPlayerId');
    const owner = await readEventAccess(f.table, creator, event.id);
    expect(owner).toMatchObject({ summary: { role: 'owner' }, admittedPlayer: false });
    f.seed({ ...f.row(`member:${member.objectId}`), revoked: true });
    await expect(readEventAccess(f.table, member, event.id)).rejects.toMatchObject({ status: 404 });
  });

  it('retains a real legacy target membership while deriving general read eligibility from another source', async () => {
    const f = admissionFixture();
    await f.admit();
    const other = identifier(999);
    f.seed({ partitionKey: other, rowKey: 'event', ...event, id: other });
    const targetMember = f.seed({ partitionKey: other, rowKey: `member:${member.objectId}`, ...member, role: 'member' });
    const access = await readEventAccess(f.table, member, other);
    expect(access).toMatchObject({ summary: { role: 'member' }, admittedPlayer: true, memberEtag: targetMember.etag });
    expect(access).not.toHaveProperty('viewerPlayerId');
  });
});
