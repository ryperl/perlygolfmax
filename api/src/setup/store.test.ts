import { describe, expect, it } from 'vitest';
import type { EventSetupInput } from '../../../src/domain/setup.js';
import { isEventWorkspace } from '../../../src/contracts/setup.js';
import { catalogFixture, identifier, manifest, tee } from '../../test/catalog-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';

async function fixture() {
  const f = catalogFixture();
  f.seedEvent();
  const version = await f.publish();
  const players = await Promise.all([200, 201, 202, 203].map((id) => f.players.create(creator, identifier(id), `Fictional Player ${String(id)}`)));
  const first = players[0];
  if (!first) throw new Error('Missing fictional first player');
  await f.players.observe(creator, first.id, identifier(300), { value: '+1.2', effectiveDate: '2026-01-15', source: 'Fictional manual index' }, first.etag);
  const ids = players.map((player) => player.id);
  const input: EventSetupInput = {
    name: 'Fictional Saved Event', location: 'Fictional general location', playerIds: ids,
    rounds: [{
      id: identifier(500), name: 'Fictional Round One', courseId: version.courseId, courseVersionId: version.id,
      teeProfileId: tee.id, groups: [{ number: 1, playerIds: ids }],
    }],
  };
  const empty = await f.workspace.get(creator, event.id);
  return { ...f, input, version, empty };
}

describe('saved owner workspace', () => {
  it('returns an empty unsaved workspace, then atomically saves event metadata, immutable selections, roster and groups', async () => {
    const f = await fixture();
    expect(f.empty).toMatchObject({ location: '', roster: [], rounds: [], event: { role: 'owner' } });
    const saved = await f.workspace.save(creator, event.id, f.input, f.empty.etag);
    expect(isEventWorkspace(saved)).toBe(true);
    expect(saved).toMatchObject({
      event: { name: f.input.name }, location: f.input.location, etag: saved.event.etag,
      rounds: [{ courseVersionId: f.version.id, teeProfile: tee, groups: f.input.rounds[0]?.groups }],
    });
    expect(saved.rounds[0]?.players[0]?.handicapIndex).toMatchObject({ value: '+1.2', recordedBy: creator });
    expect(saved.rounds[0]?.players[1]?.handicapIndex).toBeNull();
    expect(saved.rounds[0]?.course).toEqual(manifest.course);
    expect(saved.rounds[0]?.course).not.toHaveProperty('teeProfiles');
    const writes = f.submit.mock.calls.at(-1)?.[0];
    expect(writes).toHaveLength(4);
    expect(writes?.[0]).toEqual(['update', expect.objectContaining({ rowKey: 'event', name: f.input.name }), 'Merge', { etag: f.empty.etag }]);
    expect(writes?.[1]?.[1]).toMatchObject({ rowKey: `member:${creator.objectId}`, role: 'owner' });
    expect(writes?.[1]?.[3]?.etag).toEqual(expect.any(String));
    expect(writes?.every((action) => action[1].partitionKey === event.id)).toBe(true);
  });

  it('does not refresh old-round HI snapshots; new rounds and newly added round players capture current observations', async () => {
    const f = await fixture();
    let saved = await f.workspace.save(creator, event.id, f.input, f.empty.etag);
    const playerId = f.input.playerIds[0] ?? '';
    const player = await f.players.get(creator, playerId);
    await f.players.observe(creator, playerId, identifier(301), { value: '8.1', effectiveDate: '2026-02-01', source: 'Fictional subsequent observation' }, player.etag);
    const extra = await f.players.create(creator, identifier(204), 'Fictional Fifth Player');
    const extraObserved = await f.players.observe(creator, extra.id, identifier(302), { value: '12', effectiveDate: '2026-02-01', source: 'Fictional new player index' }, extra.etag);
    const first = f.input.rounds[0];
    if (!first) throw new Error('Missing fictional round');
    const playerIds = [...f.input.playerIds, extra.id];
    const groups = [{ number: 1, playerIds: f.input.playerIds }, { number: 4, playerIds: [extra.id] }];
    const input = {
      ...f.input, playerIds,
      rounds: [{ ...first, groups }, { ...first, id: identifier(501), name: 'Fictional Round Two', groups }],
    };
    saved = await f.workspace.save(creator, event.id, input, saved.etag);
    expect(saved.rounds[0]?.players[0]?.handicapIndex?.value).toBe('+1.2');
    expect(saved.rounds[1]?.players[0]?.handicapIndex?.value).toBe('8.1');
    expect(saved.rounds[0]?.players[4]?.handicapIndex).toEqual(extraObserved.currentIndex);
    await expect(f.workspace.save(creator, event.id, { ...f.input, rounds: [first] }, saved.etag)).rejects.toMatchObject({ code: 'ROUND_REMOVAL_NOT_SUPPORTED' });
  });

  it('keeps saved course version and tee snapshots unchanged when newer global data is published', async () => {
    const f = await fixture();
    const saved = await f.workspace.save(creator, event.id, f.input, f.empty.etag);
    const root = (await f.courses.list(creator)).courses[0];
    const playerId = f.input.playerIds[0] ?? '';
    const player = await f.players.get(creator, playerId);
    await f.players.rename(creator, playerId, 'Fictional later player name', player.etag);
    await f.publish(identifier(101), { ...manifest, course: { ...manifest.course, name: 'Fictional new global name' } }, [{ ...tee, category: 'Fictional updated category' }], root?.etag ?? '');
    const read = await f.workspace.get(creator, event.id);
    expect(read.rounds).toEqual(saved.rounds);
    const edited = await f.workspace.save(creator, event.id, { ...f.input, location: 'Fictional edited location' }, read.etag);
    expect(edited.rounds).toEqual(saved.rounds);
    expect(edited.roster).toEqual(saved.roster);
  });

  it('returns allowlisted event-local projections to members without any HI/audit/catalog profiles', async () => {
    const f = await fixture();
    await f.workspace.save(creator, event.id, f.input, f.empty.etag);
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'member' });
    const result = await f.workspace.get(member, event.id);
    expect(isEventWorkspace(result)).toBe(true);
    expect(result.roster).toHaveLength(4);
    expect(result.rounds[0]?.players[0]).toEqual({ playerId: f.input.playerIds[0], displayName: 'Fictional Player 200' });
    for (const field of ['handicapIndex', 'recordedBy', 'previousObservationId', 'effectiveDate', 'currentIndex', 'teeProfiles', 'provenance']) {
      expect(JSON.stringify(result)).not.toContain(`"${field}"`);
    }
    await expect(f.workspace.save(member, event.id, f.input, result.etag)).rejects.toMatchObject({ status: 403 });
  });

  it('separates event ownership from catalog management and denies nonmembers/wrong tenants', async () => {
    const f = await fixture();
    await expect(f.workspace.get(member, event.id)).rejects.toMatchObject({ status: 404 });
    await expect(f.workspace.save(member, event.id, f.input, f.empty.etag)).rejects.toMatchObject({ status: 404 });
    await expect(f.workspace.get({ ...creator, tenantId: member.objectId }, event.id)).rejects.toMatchObject({ status: 404 });
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'owner' });
    expect((await f.workspace.get(member, event.id)).event.role).toBe('owner');
    await expect(f.workspace.save(member, event.id, f.input, f.empty.etag)).rejects.toMatchObject({ code: 'CATALOG_MANAGEMENT_FORBIDDEN' });
    f.rows.delete(`${event.id}|member:${creator.objectId}`);
    await expect(f.workspace.get(creator, event.id)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps archived reads owner-only and rejects all workspace writes to archived events', async () => {
    const f = await fixture();
    await f.workspace.save(creator, event.id, f.input, f.empty.etag);
    f.seed({ partitionKey: event.id, rowKey: 'event', ...event, status: 'archived' });
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'member' });
    const archived = await f.workspace.get(creator, event.id);
    expect(archived.event.status).toBe('archived');
    await expect(f.workspace.get(member, event.id)).rejects.toMatchObject({ status: 404 });
    await expect(f.workspace.save(creator, event.id, f.input, archived.etag)).rejects.toMatchObject({ code: 'EVENT_ARCHIVED' });
  });

  it.each([null, 'invalid', 0])('fails closed without writes when the stored event status is %j', async (status) => {
    const f = await fixture();
    const corrupted = f.seed({ partitionKey: event.id, rowKey: 'event', ...event, status });
    const before = new Map(f.rows);
    f.submit.mockClear();
    f.create.mockClear();

    await expect(f.workspace.get(creator, event.id)).rejects.toMatchObject({ status: 503, code: 'INVALID_STORED_EVENT' });
    await expect(f.workspace.save(creator, event.id, f.input, corrupted.etag)).rejects.toMatchObject({ status: 503, code: 'INVALID_STORED_EVENT' });

    expect(f.submit).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.rows).toEqual(before);
  });

  it('rechecks authoritative grants after assembling a private read', async () => {
    const f = await fixture();
    await f.workspace.save(creator, event.id, f.input, f.empty.etag);
    const original = f.get.getMockImplementation();
    if (!original) throw new Error('Missing fictional table getter');
    f.get.mockImplementation(async (partition, row, options) => {
      const result = await original(partition, row, options);
      if (row === `round:${identifier(500)}`) f.rows.delete(`${event.id}|member:${creator.objectId}`);
      return result;
    });
    await expect(f.workspace.get(creator, event.id)).rejects.toMatchObject({ status: 404 });
  });

  it('models eight rounds and an eight-player roster with independently configured manual groups', async () => {
    const f = await fixture();
    const additional = await Promise.all([204, 205, 206, 207].map((id) => f.players.create(creator, identifier(id), `Fictional Player ${String(id)}`)));
    const playerIds = [...f.input.playerIds, ...additional.map((player) => player.id)];
    const first = f.input.rounds[0];
    if (!first) throw new Error('Missing fictional first round');
    const rounds = Array.from({ length: 8 }, (_, index) => ({
      ...first, id: identifier(500 + index),
      groups: [{ number: 1, playerIds: playerIds.slice(0, 4) }, { number: 4, playerIds: playerIds.slice(4) }],
    }));
    const saved = await f.workspace.save(creator, event.id, { ...f.input, playerIds, rounds }, f.empty.etag);
    expect(saved.roster).toHaveLength(8);
    expect(saved.rounds).toHaveLength(8);
    expect(saved.rounds[7]?.groups.map((group) => group.number)).toEqual([1, 4]);
    expect(f.submit.mock.calls.at(-1)?.[0]).toHaveLength(11);
  });

  it.each(['revoke', 'archive'] as const)('conditionally aborts the whole write if %s races setup saving', async (operation) => {
    const f = await fixture();
    f.submit.mockImplementationOnce((actions) => {
      if (operation === 'revoke') f.rows.delete(`${event.id}|member:${creator.objectId}`);
      else f.seed({ partitionKey: event.id, rowKey: 'event', ...event, status: 'archived' });
      try { f.apply(actions); } catch (error) { return Promise.reject(error instanceof Error ? error : new Error('Invalid fictional transaction')); }
      return Promise.reject(new Error('Unexpected successful race'));
    });
    await expect(f.workspace.save(creator, event.id, f.input, f.empty.etag)).rejects.toMatchObject({ code: 'EVENT_CHANGED' });
    expect(f.rows.has(`${event.id}|workspace`)).toBe(false);
    expect(f.rows.has(`${event.id}|round:${identifier(500)}`)).toBe(false);
  });

  it('rejects stale ETags, invalid groups/rosters, absent version/profile and invalid stored data explicitly', async () => {
    const f = await fixture();
    await expect(f.workspace.save(creator, event.id, f.input, 'stale')).rejects.toMatchObject({ code: 'EVENT_CHANGED' });
    const first = f.input.rounds[0];
    if (!first) throw new Error('Missing fictional round');
    for (const groups of [
      [{ number: 5, playerIds: f.input.playerIds }],
      [{ number: 1, playerIds: [f.input.playerIds[0] ?? '', ...f.input.playerIds] }],
      [{ number: 1, playerIds: f.input.playerIds.slice(1) }],
      [{ number: 1, playerIds: f.input.playerIds }, { number: 1, playerIds: [] }],
    ]) {
      await expect(f.workspace.save(creator, event.id, { ...f.input, rounds: [{ ...first, groups }] }, f.empty.etag)).rejects.toMatchObject({ code: 'INVALID_EVENT_SETUP' });
    }
    await expect(f.workspace.save(creator, event.id, { ...f.input, rounds: [{ ...first, courseVersionId: 'a'.repeat(64) }] }, f.empty.etag)).rejects.toMatchObject({ code: 'COURSE_VERSION_NOT_FOUND' });
    await expect(f.workspace.save(creator, event.id, { ...f.input, rounds: [{ ...first, teeProfileId: 999 }] }, f.empty.etag)).rejects.toMatchObject({ code: 'TEE_PROFILE_NOT_FOUND' });
    f.seed({ partitionKey: event.id, rowKey: 'workspace', content: '{}' });
    await expect(f.workspace.get(creator, event.id)).rejects.toMatchObject({ status: 503 });
  });
});
