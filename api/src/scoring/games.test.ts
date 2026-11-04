import { describe, expect, it, vi } from 'vitest';
import { memoryTable, identifier } from '../../test/catalog-fixtures.js';
import { event } from '../../test/fixtures.js';
import { configuredGameRounds, readGameConfiguration } from './games.js';

describe('persisted game evidence boundaries', () => {
  it('keeps legacy rounds empty only when no registry, settings or history evidence exists', async () => {
    const f = memoryTable();
    const roundId = identifier(500);
    expect(await readGameConfiguration(f.table, event.id, roundId, [])).toBeUndefined();
    f.seed({ partitionKey: event.id, rowKey: `game-change:${roundId}:${identifier(800)}`, content: '{}' });
    await expect(readGameConfiguration(f.table, event.id, roundId, [])).rejects.toMatchObject({ status: 503 });
    expect(f.list).toHaveBeenLastCalledWith({
      queryOptions: { filter: `PartitionKey eq '${event.id}' and RowKey ge 'game-change:${roundId}:' and RowKey lt 'game-change:${roundId};'` },
    });
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('fails closed on an empty partial history page and never follows an unbounded continuation', async () => {
    const f = memoryTable();
    const source = f.table.listEntities();
    const byPage = vi.spyOn(source, 'byPage').mockImplementation(async function* () {
      yield await Promise.resolve(Object.assign([], { continuationToken: 'fictional-more-evidence' }));
      throw new Error('Must not follow game evidence continuation.');
    });
    f.list.mockReturnValue(source);
    await expect(readGameConfiguration(f.table, event.id, identifier(500), [])).rejects.toMatchObject({ status: 503 });
    expect(byPage).toHaveBeenCalledWith({ maxPageSize: 1 });
    expect(byPage).toHaveBeenCalledOnce();
  });
  it('validates the additive registry without interpreting corruption as an empty setting', () => {
    expect(configuredGameRounds(undefined)).toEqual([]);
    expect(configuredGameRounds(JSON.stringify([identifier(500)]))).toEqual([identifier(500)]);
    for (const value of [null, 0, '{}', 'invalid', '["not-uuid"]', JSON.stringify([identifier(500), identifier(500)])]) {
      expect(() => configuredGameRounds(value)).toThrow();
    }
  });
});
