import { describe, expect, it, vi } from 'vitest';
import type { EventSetupInput } from '../../../src/domain/setup.js';
import { isEventWorkspace } from '../../../src/contracts/setup.js';
import { catalogFixture, identifier, manifest, tee } from '../../test/catalog-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import { decode } from '../catalog/entities.js';
import { isIndexRefreshAudit } from './index-refresh.js';

async function fixture(teeProfile = tee) {
  const f = catalogFixture();
  f.seedEvent();
  const version = await f.publish(identifier(100), manifest, [teeProfile]);
  const players = await Promise.all([200, 201, 202, 203].map((id) => f.players.create(creator, identifier(id), `Fictional Player ${String(id)}`)));
  const first = players[0];
  if (!first) throw new Error('Missing fictional first player');
  await f.players.observe(creator, first.id, identifier(300), { value: '+1.2', effectiveDate: '2026-01-15', source: 'Fictional manual index' }, first.etag);
  const ids = players.map((player) => player.id);
  const input: EventSetupInput = {
    name: 'Fictional Saved Event', location: 'Fictional general location', playerIds: ids,
    rounds: [{
      id: identifier(500), name: 'Fictional Round One', courseId: version.courseId, courseVersionId: version.id,
      teeProfileId: teeProfile.id, groups: [{ number: 1, playerIds: ids }],
    }],
  };
  const empty = await f.workspace.get(creator, event.id);
  return { ...f, input, version, empty };
}

describe('saved owner workspace', () => {
  it('projects authoritative purse availability without an additional purse or round-score read', async () => {
    const f = await fixture();
    expect(f.empty.purseConfigured).toBe(false);
    const reads = vi.spyOn(f.table, 'getEntity');
    const stored = f.rows.get(`${event.id}|event`);
    if (!stored) throw new Error('Missing fictional event.');
    f.rows.set(`${event.id}|event`, { ...stored, purseConfigured: true });
    expect((await f.workspace.get(creator, event.id)).purseConfigured).toBe(true);
    expect(reads.mock.calls.every(([, rowKey]) => rowKey !== 'purse' && !rowKey.startsWith('score-card:'))).toBe(true);
    f.rows.set(`${event.id}|event`, { ...stored, purseConfigured: 'invalid' });
    await expect(f.workspace.get(creator, event.id)).rejects.toMatchObject({ status: 503, code: 'INVALID_STORED_PURSE' });
  });
  it.each([1, 10, 18])('persists and reloads explicit starting hole %i and validates captured workspace groups', async (startingHole) => {
    const f = await fixture();
    const input = { ...f.input, rounds: f.input.rounds.map((round) => ({
      ...round, groups: round.groups.map((group) => ({ ...group, startingHole })),
    })) };
    const saved = await f.workspace.save(creator, event.id, input, f.empty.etag);
    expect(saved.rounds[0]?.groups).toEqual(input.rounds[0]?.groups);
    expect((await f.workspace.get(creator, event.id)).rounds).toEqual(saved.rounds);
    expect(isEventWorkspace(saved)).toBe(true);
    for (const invalid of [0, 19, 1.5, Number.NaN, Infinity, '10', null]) {
      expect(isEventWorkspace({ ...saved, rounds: saved.rounds.map((round) => ({
        ...round, groups: round.groups.map((group) => ({ ...group, startingHole: invalid })),
      })) })).toBe(false);
    }
  });

  it('rejects a start absent from the selected nine-hole tee before persistence and in captured workspace guards', async () => {
    const f = await fixture({
      ...tee, holeCount: 9, totalYardage: 3150, totalPar: 36, holes: tee.holes.slice(0, 9),
    });
    const input = { ...f.input, rounds: f.input.rounds.map((round) => ({
      ...round, groups: round.groups.map((group) => ({ ...group, startingHole: 10 })),
    })) };
    f.submit.mockClear();
    const before = new Map(f.rows);
    await expect(f.workspace.save(creator, event.id, input, f.empty.etag)).rejects.toMatchObject({
      status: 400, code: 'INVALID_GROUP_STARTING_HOLE',
    });
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.rows).toEqual(before);
    const saved = await f.workspace.save(creator, event.id, f.input, f.empty.etag);
    expect(isEventWorkspace(saved)).toBe(true);
    expect(isEventWorkspace({ ...saved, rounds: saved.rounds.map((round) => ({
      ...round, groups: input.rounds[0]?.groups,
    })) })).toBe(false);
  });

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

    async function refreshFixture() {
      const f = await fixture();
      const first = f.input.rounds[0];
      if (!first) throw new Error('Missing fictional first round');
      const saved = await f.workspace.save(creator, event.id, {
        ...f.input, rounds: [first, { ...first, id: identifier(501), name: 'Fictional Round Two' }],
      }, f.empty.etag);
      const player = await f.players.get(creator, identifier(200));
      const latest = await f.players.observe(creator, player.id, identifier(310), {
        value: '7.5', effectiveDate: '2026-03-01', source: 'Fictional current observation',
      }, player.etag);
      f.submit.mockClear();
      return { ...f, saved, latest };
    }

    describe('explicit setup-only captured-index refresh', () => {
      it('updates only the selected round captures, retaining unknowns, other rounds, course/groups and global profiles', async () => {
        const f = await refreshFixture();
        const globalBefore = [...f.rows.entries()].filter(([key]) => key.startsWith('catalog:'));
        const refreshed = await f.workspace.refreshIndices(creator, event.id, identifier(500), identifier(600), f.saved.etag);
        const previousRound = f.saved.rounds[0];
        expect(refreshed.rounds[0]).toEqual({
          ...previousRound,
          players: previousRound?.players.map((entry) => ({
            ...entry, handicapIndex: entry.playerId === identifier(200) ? f.latest.currentIndex : entry.handicapIndex,
          })),
        });
        expect(refreshed.rounds[0]?.players[1]?.handicapIndex).toBeNull();
        expect(refreshed.rounds[1]).toEqual(f.saved.rounds[1]);
        expect(refreshed.roster).toEqual(f.saved.roster);
        expect(refreshed.location).toBe(f.saved.location);
        expect(refreshed.event.name).toBe(f.saved.event.name);
        expect(refreshed.etag).not.toBe(f.saved.etag);
        expect([...f.rows.entries()].filter(([key]) => key.startsWith('catalog:'))).toEqual(globalBefore);
        const receipt = f.rows.get(`${event.id}|index-refresh:${identifier(600)}`);
        const audit = decode(receipt?.content, isIndexRefreshAudit);
        expect(audit).toMatchObject({
          eventId: event.id, roundId: identifier(500), requestId: identifier(600), expectedEtag: f.saved.etag,
          recordedBy: creator,
        });
        expect(audit.recordedAt).toEqual(expect.any(String));
        expect(audit.previous[0]?.handicapIndex?.value).toBe('+1.2');
        expect(audit.updated[0]?.handicapIndex).toEqual(f.latest.currentIndex);
        expect(f.rows.get(`${event.id}|event`)?.indicesRefreshedAt).toBe(audit.recordedAt);
        expect(f.submit.mock.calls[0]?.[0]).toEqual([
          ['update', expect.objectContaining({ rowKey: 'event', indicesRefreshedAt: audit.recordedAt }), 'Merge', { etag: f.saved.etag }],
          ['update', expect.objectContaining({ rowKey: `member:${creator.objectId}` }), 'Merge', expect.any(Object)],
          ['update', expect.objectContaining({ rowKey: `round:${identifier(500)}` }), 'Merge'],
          ['create', expect.objectContaining({ rowKey: `index-refresh:${identifier(600)}` })],
        ]);
        expect(f.submit.mock.calls[0]?.[0][1]?.[3]?.etag).toEqual(expect.any(String));
        f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'member' });
        const memberRead = await f.workspace.get(member, event.id);
        expect(JSON.stringify(memberRead)).not.toContain('handicapIndex');
        expect(JSON.stringify(memberRead)).not.toContain('recordedBy');
      });

      it('captures unknown as null explicitly and refreshes newly known observations only on the explicit action', async () => {
        const f = await refreshFixture();
        const unknownPlayer = await f.players.get(creator, identifier(201));
        const observed = await f.players.observe(creator, unknownPlayer.id, identifier(311), {
          value: '+0.5', effectiveDate: '2026-03-01', source: 'Fictional initially unknown observation',
        }, unknownPlayer.etag);
        expect((await f.workspace.get(creator, event.id)).rounds[0]?.players[1]?.handicapIndex).toBeNull();
        const result = await f.workspace.refreshIndices(creator, event.id, identifier(500), identifier(600), f.saved.etag);
        expect(result.rounds[0]?.players[1]?.handicapIndex).toEqual(observed.currentIndex);
        expect(result.rounds[0]?.players[2]?.handicapIndex).toBeNull();
        expect(result.rounds[1]?.players[1]?.handicapIndex).toBeNull();
      });

      it('replays a lost committed response with the original revision, returns fresh workspace and preserves one audit', async () => {
        const f = await refreshFixture();
        f.submit.mockImplementationOnce((actions) => {
          f.apply(actions);
          return Promise.reject(new Error('Fictional lost refresh response'));
        });
        await expect(f.workspace.refreshIndices(creator, event.id, identifier(500), identifier(600), f.saved.etag)).rejects.toThrow('Fictional lost refresh response');
        const committed = await f.workspace.get(creator, event.id);
        const receipt = f.rows.get(`${event.id}|index-refresh:${identifier(600)}`);
        const player = await f.players.get(creator, identifier(200));
        await f.players.observe(creator, player.id, identifier(312), {
          value: '9', effectiveDate: '2026-04-01', source: 'Fictional later current index',
        }, player.etag);
        const original = f.input.rounds[0];
        if (!original) throw new Error('Missing fictional original round');
        const fresh = await f.workspace.save(creator, event.id, {
          ...f.input, location: 'Fictional subsequent location',
          rounds: [original, { ...original, id: identifier(501), name: 'Fictional Round Two' }],
        }, committed.etag);
        expect(await f.workspace.refreshIndices(creator, event.id, identifier(500), identifier(600), f.saved.etag)).toEqual(fresh);
        expect(fresh.rounds[0]?.players[0]?.handicapIndex?.value).toBe('7.5');
        expect(f.rows.get(`${event.id}|index-refresh:${identifier(600)}`)).toEqual(receipt);
        expect([...f.rows.values()].filter((row) => row.rowKey?.startsWith('index-refresh:'))).toHaveLength(1);
        await expect(f.workspace.refreshIndices(creator, event.id, identifier(501), identifier(600), f.saved.etag)).rejects.toMatchObject({ code: 'INDEX_REFRESH_REQUEST_CONFLICT' });
        await expect(f.workspace.refreshIndices(creator, event.id, identifier(500), identifier(600), fresh.etag)).rejects.toMatchObject({ code: 'INDEX_REFRESH_REQUEST_CONFLICT' });
      });

      it('requires both authoritative event ownership and organizer capability, including for replays', async () => {
        const f = await refreshFixture();
        await expect(f.workspace.refreshIndices(member, event.id, identifier(500), identifier(600), f.saved.etag)).rejects.toMatchObject({ status: 404 });
        for (const role of ['member', 'owner']) {
          f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role });
          await expect(f.workspace.refreshIndices(member, event.id, identifier(500), identifier(600), f.saved.etag)).rejects.toMatchObject({ status: 403 });
        }
        await expect(f.workspace.refreshIndices({ ...creator, tenantId: member.objectId }, event.id, identifier(500), identifier(600), f.saved.etag)).rejects.toMatchObject({ status: 404 });
        expect(f.submit).not.toHaveBeenCalled();
        const refreshed = await f.workspace.refreshIndices(creator, event.id, identifier(500), identifier(600), f.saved.etag);
        f.seed({ partitionKey: event.id, rowKey: 'event', ...event, status: 'archived' });
        await expect(f.workspace.refreshIndices(creator, event.id, identifier(500), identifier(600), f.saved.etag)).rejects.toMatchObject({ code: 'EVENT_ARCHIVED' });
        f.rows.delete(`${event.id}|member:${creator.objectId}`);
        await expect(f.workspace.refreshIndices(creator, event.id, identifier(500), identifier(601), refreshed.etag)).rejects.toMatchObject({ status: 404 });
      });

      it('rejects stale revisions and nonexistent rounds without saving any changes', async () => {
        const f = await refreshFixture();
        const before = new Map(f.rows);
        await expect(f.workspace.refreshIndices(creator, event.id, identifier(500), identifier(600), 'stale')).rejects.toMatchObject({ code: 'EVENT_CHANGED' });
        await expect(f.workspace.refreshIndices(creator, event.id, identifier(999), identifier(600), f.saved.etag)).rejects.toMatchObject({ code: 'ROUND_NOT_FOUND' });
        expect(f.submit).not.toHaveBeenCalled();
        expect(f.rows).toEqual(before);
      });

      it.each(['revoke', 'archive', 'edit'] as const)('conditionally aborts all snapshot/audit writes when %s races refresh', async (operation) => {
        const f = await refreshFixture();
        const beforeRound = f.rows.get(`${event.id}|round:${identifier(500)}`);
        f.submit.mockImplementationOnce((actions) => {
          if (operation === 'revoke') f.rows.delete(`${event.id}|member:${creator.objectId}`);
          else f.seed({ partitionKey: event.id, rowKey: 'event', ...event, status: operation === 'archive' ? 'archived' : 'active' });
          try { f.apply(actions); } catch (error) {
            return Promise.reject(error instanceof Error ? error : new Error('Invalid fictional refresh transaction'));
          }
          return Promise.reject(new Error('Unexpected successful refresh race'));
        });
        await expect(f.workspace.refreshIndices(creator, event.id, identifier(500), identifier(600), f.saved.etag)).rejects.toMatchObject({ code: 'EVENT_CHANGED' });
        expect(f.rows.get(`${event.id}|round:${identifier(500)}`)).toEqual(beforeRound);
        expect(f.rows.has(`${event.id}|index-refresh:${identifier(600)}`)).toBe(false);
      });

      it('converges identical concurrent retries but rejects competing new refreshes using the same revision', async () => {
        const f = await refreshFixture();
        const identical = await Promise.all([
          f.workspace.refreshIndices(creator, event.id, identifier(500), identifier(600), f.saved.etag),
          f.workspace.refreshIndices(creator, event.id, identifier(500), identifier(600), f.saved.etag),
        ]);
        expect(identical[0]).toEqual(identical[1]);
        const etag = identical[0].etag;
        const competing = await Promise.allSettled([
          f.workspace.refreshIndices(creator, event.id, identifier(500), identifier(601), etag),
          f.workspace.refreshIndices(creator, event.id, identifier(501), identifier(602), etag),
        ]);
        expect(competing.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(competing.filter((result) => result.status === 'rejected')).toHaveLength(1);
        expect([...f.rows.values()].filter((row) => row.rowKey?.startsWith('index-refresh:'))).toHaveLength(2);
      });

      it('fails closed on catalog/transaction provider failure or corrupt audit without modifying saved data', async () => {
        const f = await refreshFixture();
        const before = new Map(f.rows);
        const original = f.get.getMockImplementation();
        if (!original) throw new Error('Missing fictional table getter');
        f.get.mockImplementation((partition, row, options) => partition === 'catalog:players'
          ? Promise.reject(new Error('Fictional catalog provider failure')) : original(partition, row, options));
        await expect(f.workspace.refreshIndices(creator, event.id, identifier(500), identifier(600), f.saved.etag)).rejects.toThrow('Fictional catalog provider failure');
        expect(f.submit).not.toHaveBeenCalled();
        expect(f.rows).toEqual(before);
        f.get.mockImplementation(original);
        f.submit.mockRejectedValueOnce(new Error('Fictional batch provider failure'));
        await expect(f.workspace.refreshIndices(creator, event.id, identifier(500), identifier(600), f.saved.etag)).rejects.toThrow('Fictional batch provider failure');
        expect(f.rows).toEqual(before);
        f.seed({ partitionKey: event.id, rowKey: `index-refresh:${identifier(600)}`, content: '{}' });
        await expect(f.workspace.refreshIndices(creator, event.id, identifier(500), identifier(600), f.saved.etag)).rejects.toMatchObject({ status: 503 });
      });
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
      [{ number: 0, playerIds: f.input.playerIds }],
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
