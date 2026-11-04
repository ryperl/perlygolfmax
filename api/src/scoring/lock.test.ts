import { describe, expect, it, vi } from 'vitest';
import { identifier, memoryTable } from '../../test/catalog-fixtures.js';
import { event } from '../../test/fixtures.js';
import { scoringLock } from './lock.js';

describe('missing score-lock evidence probe', () => {
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
