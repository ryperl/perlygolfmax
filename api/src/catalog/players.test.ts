import { describe, expect, it } from 'vitest';
import { catalogFixture, identifier } from '../../test/catalog-fixtures.js';
import { creator, member } from '../../test/fixtures.js';

const input = { value: '+1.2', effectiveDate: '2026-01-15', source: 'Fictional manual observation' };

describe('audited reusable player catalog', () => {
  it('starts unknown, preserves explicit plus indices, and atomically records server attribution and audit linkage', async () => {
    const f = catalogFixture();
    const player = await f.players.create(creator, identifier(200), 'Fictional Player A');
    expect(player.currentIndex).toBeNull();
    const observed = await f.players.observe(creator, player.id, identifier(300), input, player.etag);
    expect(observed.currentIndex).toMatchObject({
      id: identifier(300), ...input, recordedBy: creator, previousObservationId: null,
    });
    expect(observed.currentIndex?.recordedAt).toEqual(expect.any(String));
    const corrected = await f.players.observe(creator, player.id, identifier(301), { ...input, value: '2.1' }, observed.etag);
    expect(corrected.currentIndex).toMatchObject({ value: '2.1', previousObservationId: identifier(300) });
    const history = await f.players.history(creator, player.id);
    expect(history.observations).toHaveLength(2);
    expect(history.observations[0]).toEqual(observed.currentIndex);
    expect(f.submit.mock.calls[0]?.[0]).toEqual([
      ['update', expect.objectContaining({ partitionKey: 'catalog:players', rowKey: `player:${player.id}` }), 'Merge', { etag: player.etag }],
      ['create', expect.objectContaining({ partitionKey: 'catalog:players', rowKey: `index:${player.id}:${identifier(300)}` })],
    ]);
  });

  it('retains backdated history without silently replacing a newer current observation', async () => {
    const f = catalogFixture();
    let player = await f.players.create(creator, identifier(200), 'Fictional Player A');
    player = await f.players.observe(creator, player.id, identifier(300), input, player.etag);
    const backdated = await f.players.observe(creator, player.id, identifier(301), { ...input, value: '12', effectiveDate: '2025-12-01' }, player.etag);
    expect(backdated.currentIndex).toEqual(player.currentIndex);
    const latest = await f.players.observe(creator, player.id, identifier(302), { ...input, value: '3', effectiveDate: '2026-01-16' }, backdated.etag);
    expect(latest.currentIndex?.previousObservationId).toBe(identifier(301));
    expect((await f.players.history(creator, player.id)).observations).toHaveLength(3);
  });

  it('retries creation and observations without duplication, even after rename/newer observations', async () => {
    const f = catalogFixture();
    const player = await f.players.create(creator, identifier(200), 'Fictional Player A');
    const first = await f.players.observe(creator, player.id, identifier(300), input, player.etag);
    const latest = await f.players.observe(creator, player.id, identifier(301), { ...input, value: '4' }, first.etag);
    expect(await f.players.observe(creator, player.id, identifier(300), input, player.etag)).toEqual(latest);
    expect((await f.players.history(creator, player.id)).observations).toHaveLength(2);
    const renamed = await f.players.rename(creator, player.id, 'Fictional Renamed Player', latest.etag);
    expect(await f.players.create(creator, player.id, 'Fictional Player A')).toEqual(renamed);
    await expect(f.players.create(creator, player.id, 'Different fictional request')).rejects.toMatchObject({ status: 409 });
    await expect(f.players.observe(creator, player.id, identifier(300), { ...input, value: '5' }, renamed.etag)).rejects.toMatchObject({ status: 409 });
  });

  it('rejects stale profile changes and concurrent audits without writing partial observations', async () => {
    const f = catalogFixture();
    const player = await f.players.create(creator, identifier(200), 'Fictional Player A');
    const outcomes = await Promise.allSettled([
      f.players.observe(creator, player.id, identifier(300), input, player.etag),
      f.players.observe(creator, player.id, identifier(301), input, player.etag),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect((await f.players.history(creator, player.id)).observations).toHaveLength(1);
    await expect(f.players.rename(creator, player.id, 'Changed fictional player', player.etag)).rejects.toMatchObject({ code: 'PLAYER_CHANGED' });
  });

  it('resumes idempotent audit writes after a lost response and bounds global and history reads', async () => {
    const f = catalogFixture();
    const player = await f.players.create(creator, identifier(200), 'Fictional Player A');
    f.submit.mockImplementationOnce((actions) => {
      f.apply(actions);
      return Promise.reject(new Error('Fictional response loss'));
    });
    await expect(f.players.observe(creator, player.id, identifier(300), input, player.etag)).rejects.toThrow('Fictional response loss');
    await expect(f.players.observe(creator, player.id, identifier(300), input, player.etag)).resolves.toMatchObject({ currentIndex: { id: identifier(300) } });
    for (let index = 0; index < 55; index++) await f.players.create(creator, identifier(400 + index), `Fictional Player ${String(index)}`);
    const page = await f.players.list(creator);
    expect(page.players).toHaveLength(50);
    expect(page.continuationToken).toBeDefined();
    expect((await f.players.list(creator, page.continuationToken)).players).toHaveLength(6);
    expect((await f.players.history(creator, player.id)).observations).toHaveLength(1);
    expect(f.list.mock.calls.at(-1)?.[0]?.queryOptions?.filter).toContain(`index:${player.id}`);
  });

  it('bounds history pages and preserves the immutable audit chain across those pages', async () => {
    const f = catalogFixture();
    let player = await f.players.create(creator, identifier(200), 'Fictional Player A');
    for (let index = 0; index < 55; index++) player = await f.players.observe(creator, player.id, identifier(300 + index), input, player.etag);
    const first = await f.players.history(creator, player.id);
    expect(first.observations).toHaveLength(50);
    expect(first.continuationToken).toBeDefined();
    const second = await f.players.history(creator, player.id, first.continuationToken);
    expect(second.observations).toHaveLength(5);
    expect(second.observations[0]?.previousObservationId).toBe(first.observations[49]?.id);
    expect(second.continuationToken).toBeUndefined();
  });

  it('converges identical simultaneous audit retries to one observation and rejects changed payload reuse', async () => {
    const f = catalogFixture();
    const player = await f.players.create(creator, identifier(200), 'Fictional Player A');
    const results = await Promise.all([
      f.players.observe(creator, player.id, identifier(300), input, player.etag),
      f.players.observe(creator, player.id, identifier(300), input, player.etag),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect((await f.players.history(creator, player.id)).observations).toHaveLength(1);
    await expect(f.players.observe(creator, player.id, identifier(300), { ...input, effectiveDate: '2026-01-16' }, player.etag)).rejects.toMatchObject({ code: 'INDEX_REQUEST_CONFLICT' });
  });

  it('keeps player profiles separate from auth identities and denies every nonmanager operation', async () => {
    const f = catalogFixture();
    for (const identity of [member, { ...creator, tenantId: member.objectId }]) {
      await expect(f.players.list(identity)).rejects.toMatchObject({ status: 403 });
      await expect(f.players.get(identity, identifier(200))).rejects.toMatchObject({ status: 403 });
      await expect(f.players.create(identity, identifier(200), 'Fictional Player')).rejects.toMatchObject({ status: 403 });
      await expect(f.players.rename(identity, identifier(200), 'Fictional Player', 'old')).rejects.toMatchObject({ status: 403 });
      await expect(f.players.history(identity, identifier(200))).rejects.toMatchObject({ status: 403 });
      await expect(f.players.observe(identity, identifier(200), identifier(300), input, 'old')).rejects.toMatchObject({ status: 403 });
    }
    expect(f.get).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });
});
