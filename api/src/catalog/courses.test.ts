import { describe, expect, it } from 'vitest';
import { isCourseVersion } from '../../../src/contracts/catalog.js';
import { catalogFixture, identifier, manifest, tee } from '../../test/catalog-fixtures.js';
import { creator, member } from '../../test/fixtures.js';

describe('manager-only staged course catalog', () => {
  it('keeps partial imports invisible, requires every expected profile, and preserves each category and source field', async () => {
    const f = catalogFixture();
    const second = { ...tee, id: 102, category: 'Fictional category B', name: 'Fictional Red' };
    const input = { ...manifest, teeProfileIds: [102, 101] };
    await f.courses.start(creator, identifier(100), input);
    await f.courses.putProfile(creator, identifier(100), tee.id, tee);
    expect(await f.courses.list(creator)).toEqual({ courses: [] });
    await expect(f.courses.publish(creator, identifier(100), null)).rejects.toMatchObject({ status: 409, code: 'IMPORT_INCOMPLETE' });
    await expect(f.courses.putProfile(creator, identifier(100), 103, { ...tee, id: 103 })).rejects.toMatchObject({ status: 400 });
    await f.courses.putProfile(creator, identifier(100), second.id, second);
    const version = await f.courses.publish(creator, identifier(100), null);
    expect(isCourseVersion(version)).toBe(true);
    expect(version.data).toEqual({ ...manifest.course, teeProfiles: [tee, second] });
    expect(version.provenance).toEqual(manifest.provenance);
    expect(await f.courses.session(creator, identifier(100))).toMatchObject({
      courseId: 'ghin:12:11', profilesReceived: [101, 102], publishedVersionId: version.id,
    });
    expect((await f.courses.list(creator)).courses).toEqual([expect.objectContaining({ id: 'ghin:12:11', currentVersionId: version.id })]);
    const transaction = f.submit.mock.calls.at(-1)?.[0];
    expect(transaction).toHaveLength(5);
    expect(transaction?.every((action) => action[1].partitionKey === 'catalog:course:ghin:12:11')).toBe(true);
    expect([...f.rows.values()].filter((row) => row.rowKey === 'event')).toHaveLength(0);
  });

  it('replays manifest/profile/publish idempotently and never rolls a newer root back on an old publish retry', async () => {
    const f = catalogFixture();
    const first = await f.publish();
    await f.courses.start(creator, identifier(100), manifest);
    await f.courses.putProfile(creator, identifier(100), tee.id, tee);
    const root = (await f.courses.list(creator)).courses[0];
    expect(root).toBeDefined();
    const second = await f.publish(identifier(101), { ...manifest, course: { ...manifest.course, name: 'Fictional revised course' } }, [tee], root?.etag ?? '');
    expect(second.id).not.toBe(first.id);
    expect(await f.courses.publish(creator, identifier(100), null)).toEqual(first);
    expect((await f.courses.list(creator)).courses[0]?.currentVersionId).toBe(second.id);
    expect(await f.courses.getVersion(creator, first.courseId, first.id)).toEqual(first);
    await expect(f.courses.start(creator, identifier(100), { ...manifest, provenance: { source: 'Changed fictional request', exportedAt: null } })).rejects.toMatchObject({ status: 409 });
    await expect(f.courses.putProfile(creator, identifier(100), tee.id, { ...tee, name: 'Changed profile' })).rejects.toMatchObject({ status: 409 });
    await expect(f.courses.publish(creator, identifier(100), 'different')).rejects.toMatchObject({ status: 409 });
  });

  it('uses deterministic content hashes and reuses an immutable version across equivalent imports', async () => {
    const f = catalogFixture();
    const first = await f.publish();
    const root = (await f.courses.list(creator)).courses[0];
    const second = await f.publish(identifier(101), manifest, [tee], root?.etag ?? '');
    expect(second).toEqual(first);
    expect([...f.rows.values()].filter((row) => row.rowKey === `version:${first.id}`)).toHaveLength(1);
    expect(f.submit.mock.calls.at(-1)?.[0]).toHaveLength(2);
  });

  it('accepts equivalent reordered staged profiles without rewriting their immutable content', async () => {
    const f = catalogFixture();
    const reordered = { ...tee, holes: [...tee.holes].reverse(), ratings: [...tee.ratings].reverse() };
    const originalOrder = structuredClone(reordered);
    await f.courses.start(creator, identifier(100), manifest);
    await f.courses.putProfile(creator, identifier(100), tee.id, reordered);
    const staged = f.rows.get(`catalog:import:${identifier(100)}|profile:${String(tee.id)}`);

    await expect(f.courses.putProfile(creator, identifier(100), tee.id, tee)).resolves.toMatchObject({ profilesReceived: [tee.id] });
    expect(f.rows.get(`catalog:import:${identifier(100)}|profile:${String(tee.id)}`)).toEqual(staged);
    expect(reordered).toEqual(originalOrder);
    const version = await f.courses.publish(creator, identifier(100), null);
    expect(version.data.teeProfiles).toEqual([tee]);
  });

  it('reuses one content version across fresh imports with reordered equivalent holes and ratings per category', async () => {
    const f = catalogFixture();
    const second = {
      ...tee, id: 102, category: 'Fictional category B',
      holes: tee.holes.map((hole) => ({ ...hole, sourceId: hole.sourceId + 1000 })),
      ratings: tee.ratings.map((rating) => ({ ...rating, course: rating.course + 0.1 })),
    };
    const input = { ...manifest, teeProfileIds: [tee.id, second.id] };
    const first = await f.publish(identifier(100), input, [tee, second]);
    const root = (await f.courses.list(creator)).courses[0];
    const reordered = [second, tee].map((item) => ({
      ...item, holes: [...item.holes].reverse(), ratings: [...item.ratings].reverse(),
    }));

    const replay = await f.publish(identifier(101), { ...input, teeProfileIds: [second.id, tee.id] }, reordered, root?.etag ?? '');

    expect(replay).toEqual(first);
    expect(replay.data.teeProfiles).toEqual([tee, second]);
    const immutableRows = [...f.rows.values()].filter((row) =>
      row.partitionKey === `catalog:course:${first.courseId}` && row.rowKey?.startsWith('version:'));
    expect(immutableRows).toHaveLength(3);
    expect(f.submit.mock.calls.at(-1)?.[0]).toHaveLength(2);
  });

  it('rejects stale/create-only root revisions without making a partially published version visible', async () => {
    const f = catalogFixture();
    const first = await f.publish();
    const changed = { ...manifest, course: { ...manifest.course, name: 'Fictional replacement' } };
    await f.courses.start(creator, identifier(101), changed);
    await f.courses.putProfile(creator, identifier(101), tee.id, tee);
    await expect(f.courses.publish(creator, identifier(101), null)).rejects.toMatchObject({ code: 'COURSE_CHANGED' });
    await expect(f.courses.publish(creator, identifier(101), 'stale')).rejects.toMatchObject({ code: 'COURSE_CHANGED' });
    expect((await f.courses.list(creator)).courses[0]?.currentVersionId).toBe(first.id);
    expect((await f.courses.session(creator, identifier(101))).publishedVersionId).toBeNull();
  });

  it('resumes a publication after its atomic commit response was lost', async () => {
    const f = catalogFixture();
    f.submit.mockImplementationOnce((actions) => {
      f.apply(actions);
      return Promise.reject(new Error('Fictional lost response'));
    });
    await expect(f.publish()).rejects.toThrow('Fictional lost response');
    const version = await f.courses.publish(creator, identifier(100), null);
    expect(version.data.teeProfiles).toEqual([tee]);
    expect(f.submit).toHaveBeenCalledTimes(1);
  });

  it('converges simultaneous identical publishes and conflicts independent competing publications atomically', async () => {
      const f = catalogFixture();
      await f.courses.start(creator, identifier(100), manifest);
      await f.courses.putProfile(creator, identifier(100), tee.id, tee);
      const versions = await Promise.all([
        f.courses.publish(creator, identifier(100), null),
        f.courses.publish(creator, identifier(100), null),
      ]);
      expect(versions[0]).toEqual(versions[1]);
      const root = (await f.courses.list(creator)).courses[0];
      for (const id of [101, 102]) {
        await f.courses.start(creator, identifier(id), { ...manifest, course: { ...manifest.course, name: `Fictional version ${String(id)}` } });
        await f.courses.putProfile(creator, identifier(id), tee.id, tee);
      }
      const results = await Promise.allSettled([
        f.courses.publish(creator, identifier(101), root?.etag ?? ''),
        f.courses.publish(creator, identifier(102), root?.etag ?? ''),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect([...f.rows.values()].filter((row) => row.rowKey?.startsWith('publication:'))).toHaveLength(2);
  });

  it('stores the maximum 32-profile import as separate bounded properties in one publication transaction', async () => {
    const f = catalogFixture();
    const profiles = Array.from({ length: 32 }, (_, index) => ({ ...tee, id: index + 1000, category: `Fictional category ${String(index)}` }));
    const version = await f.publish(identifier(100), { ...manifest, teeProfileIds: profiles.map((profile) => profile.id) }, profiles);
    expect(version.data.teeProfiles).toEqual(profiles);
    expect(f.submit.mock.calls.at(-1)?.[0]).toHaveLength(35);
    for (const row of f.rows.values()) {
      if (typeof row.content === 'string') expect(Buffer.byteLength(row.content, 'utf16le')).toBeLessThan(64 * 1024);
    }
  });

  it('denies nonmanager owners and wrong tenants on every global read/write before touching storage', async () => {
    const f = catalogFixture();
    for (const identity of [member, { ...creator, tenantId: member.objectId }]) {
      await expect(f.courses.list(identity)).rejects.toMatchObject({ status: 403 });
      await expect(f.courses.start(identity, identifier(100), manifest)).rejects.toMatchObject({ status: 403 });
      await expect(f.courses.session(identity, identifier(100))).rejects.toMatchObject({ status: 403 });
      await expect(f.courses.putProfile(identity, identifier(100), tee.id, tee)).rejects.toMatchObject({ status: 403 });
      await expect(f.courses.publish(identity, identifier(100), null)).rejects.toMatchObject({ status: 403 });
      await expect(f.courses.getVersion(identity, 'ghin:12:11', 'a'.repeat(64))).rejects.toMatchObject({ status: 403 });
    }
    expect(f.get).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.list).not.toHaveBeenCalled();
  });

  it('fails closed on unavailable, missing-table, unknown-404 and corrupt stored data', async () => {
    const f = catalogFixture();
    for (const error of [{ statusCode: 404 }, { statusCode: 404, code: 'TableNotFound' }, { statusCode: 403 }, new Error('Fictional provider outage')]) {
      f.get.mockRejectedValueOnce(error);
      await expect(f.courses.session(creator, identifier(100))).rejects.toEqual(error);
    }
    const version = await f.publish();
    const partitionKey = `catalog:course:${version.courseId}`;
    f.seed({ partitionKey, rowKey: `version:${version.id}:profile:${String(tee.id)}`, content: JSON.stringify({ ...tee, category: 'Tampered fictional category' }) });
    await expect(f.courses.getVersion(creator, version.courseId, version.id)).rejects.toMatchObject({ status: 503 });
    f.rows.delete(`${partitionKey}|version:${version.id}:profile:${String(tee.id)}`);
    await expect(f.courses.getVersion(creator, version.courseId, version.id)).rejects.toMatchObject({ status: 503 });
  });
});
