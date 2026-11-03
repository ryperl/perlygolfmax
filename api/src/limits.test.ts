import { TableClient } from '@azure/data-tables';
import { describe, expect, it, vi } from 'vitest';
import { creator } from '../test/fixtures.js';
import { TableRequestLimiter } from './limits.js';

describe('shared identity request limits', () => {
  it('uses ETags so separate limiter instances cannot both consume the final available request', async () => {
    const table = new TableClient('https://fictional.table.core.windows.net', 'Events');
    let count = 9;
    vi.spyOn(table, 'getEntity').mockImplementation(() => Promise.resolve({ etag: String(count), window: 0, count }));
    vi.spyOn(table, 'updateEntity').mockImplementation((_entity, _mode, options) => {
      if (options?.etag !== String(count)) return Promise.reject(Object.assign(new Error('Precondition failed'), { statusCode: 412 }));
      count++;
      return Promise.resolve({ etag: String(count) });
    });
    const outcomes = await Promise.allSettled([
      new TableRequestLimiter(table, () => 1).check(creator, 'events-create'),
      new TableRequestLimiter(table, () => 1).check(creator, 'events-create'),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(count).toBe(10);
  });

  it('starts a new window without unbounded bucket-row creation and fails closed on outages', async () => {
    const table = new TableClient('https://fictional.table.core.windows.net', 'Events');
    const get = vi.spyOn(table, 'getEntity').mockImplementation(() => Promise.resolve({ etag: 'previous', window: 0, count: 10 }));
    const update = vi.spyOn(table, 'updateEntity').mockResolvedValue({ etag: 'next' });
    await new TableRequestLimiter(table, () => 60_001).check(creator, 'events-create');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ rowKey: 'events-create', window: 1, count: 1 }), 'Replace', { etag: 'previous' });
    get.mockRejectedValue(new Error('storage unavailable'));
    await expect(new TableRequestLimiter(table).check(creator, 'events-create')).rejects.toThrow('storage unavailable');
  });
});
