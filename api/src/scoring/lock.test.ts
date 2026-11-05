import { describe, expect, it, vi } from 'vitest';
import { identifier, memoryTable } from '../../test/catalog-fixtures.js';
import { creator, event } from '../../test/fixtures.js';
import { scoringLock } from './lock.js';
import { stagePrivateContent } from '../private-values.js';
import { canonical } from '../catalog/entities.js';

describe('missing score-lock evidence probe', () => {
  it('reloads a versioned written-player registry exceeding one Table string without dropping permanent lock metadata', async () => {
    const f = memoryTable();
    const roundId = identifier(500);
    const key = `score-lock:${roundId}`;
    const lock = {
      kind: 'score-lock', eventId: event.id, roundId, requestId: identifier(600),
      startedAt: '2026-01-01T00:00:00.000Z', startedBy: creator,
      writtenPlayerIds: Array.from({ length: 3000 }, (_, index) => identifier(10_000 + index)),
    };
    expect(Buffer.byteLength(canonical(lock), 'utf16le')).toBeGreaterThan(65536);
    const content = await stagePrivateContent(f.table, event.id, key, creator, canonical(lock));
    const row = f.seed({ partitionKey: event.id, rowKey: key, content });
    expect(await scoringLock(f.table, event.id, roundId)).toEqual({ ...lock, etag: row.etag });
    const fragment = [...f.rows.entries()].find(([entry]) => entry.includes('|private-fragment:'));
    if (!fragment) throw new Error('Missing fictional lock fragment');
    f.rows.delete(fragment[0]);
    await expect(scoringLock(f.table, event.id, roundId)).rejects.toMatchObject({ status: 503 });
    expect(f.rows.has(`${event.id}|${key}`)).toBe(true);
  });

  it('distinguishes truly untouched rounds from a surviving card with an exact one-row bounded query', async () => {
    const f = memoryTable();
    const roundId = identifier(500);
    expect(await scoringLock(f.table, event.id, roundId)).toBeUndefined();
    const iterate = f.list.getMockImplementation();
    if (!iterate) throw new Error('Missing fictional list implementation');
    let size: number | undefined;
    f.list.mockImplementation((options) => {
      const source = iterate(options);
      const byPage = vi.mocked(source.byPage).getMockImplementation();
      if (!byPage) throw new Error('Missing fictional page implementation');
      vi.spyOn(source, 'byPage').mockImplementation((settings) => {
        size = settings?.maxPageSize;
        return byPage(settings);
      });
      return source;
    });
    f.seed({ partitionKey: event.id, rowKey: `score-card:${roundId}:${identifier(200)}`, content: '{}' });
    await expect(scoringLock(f.table, event.id, roundId)).rejects.toMatchObject({ status: 503, code: 'INVALID_STORED_SCORE_LOCK' });
    expect(size).toBe(1);
    expect(f.list).toHaveBeenLastCalledWith({
      queryOptions: { filter: `PartitionKey eq '${event.id}' and RowKey ge 'score-card:${roundId}:' and RowKey lt 'score-card:${roundId};'` },
    });
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });

  it('fails closed on an empty partial evidence page and does not follow unbounded continuation', async () => {
    const f = memoryTable();
    const source = f.table.listEntities();
    const byPage = vi.spyOn(source, 'byPage').mockImplementation(async function* () {
      yield await Promise.resolve(Object.assign([], { continuationToken: 'fictional-more-evidence' }));
      throw new Error('Must not follow fictional continuation');
    });
    f.list.mockReturnValue(source);
    await expect(scoringLock(f.table, event.id, identifier(500))).rejects.toMatchObject({ status: 503, code: 'INVALID_STORED_SCORE_LOCK' });
    expect(byPage).toHaveBeenCalledOnce();
    expect(byPage).toHaveBeenCalledWith({ maxPageSize: 1 });
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('propagates evidence-store failure rather than treating it as an unlocked round', async () => {
    const f = memoryTable();
    f.list.mockImplementationOnce(() => { throw new Error('Fictional evidence-store outage'); });
    await expect(scoringLock(f.table, event.id, identifier(500))).rejects.toThrow('Fictional evidence-store outage');
    expect(f.submit).not.toHaveBeenCalled();
  });
});
