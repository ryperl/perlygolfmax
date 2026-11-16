import { describe, expect, it, vi } from 'vitest';
import { catalogDirectoryProgress, readCatalogDirectory } from './catalog-directory';
import type { CatalogDirectoryPage } from './catalog-directory';

describe('complete catalog directory reads', () => {
  it('retains a failed page cursor and loaded rows, then resumes without repeating earlier pages', async () => {
    type Entry = { readonly id: string; readonly name: string };
    const progress = catalogDirectoryProgress<Entry>();
    const read = vi.fn<(cursor?: string) => Promise<CatalogDirectoryPage<Entry>>>().mockResolvedValueOnce({ entries: [{ id: 'one', name: 'First' }], continuationToken: 'next' })
      .mockRejectedValueOnce(new Error('Read limited'))
      .mockResolvedValueOnce({ entries: [{ id: 'two', name: 'Second' }, { id: 'one', name: 'Updated' }] });
    const page = vi.fn();
    const signal = new AbortController().signal;
    await expect(readCatalogDirectory(read, progress, signal, page)).rejects.toThrow('Read limited');
    expect(progress.cursor).toBe('next');
    expect(progress.complete).toBe(false);
    expect([...progress.entries.keys()]).toEqual(['one']);
    await readCatalogDirectory(read, progress, signal, page);
    expect(read.mock.calls.map(([cursor]) => cursor)).toEqual([undefined, 'next', 'next']);
    expect(page).toHaveBeenLastCalledWith([{ id: 'one', name: 'Updated' }, { id: 'two', name: 'Second' }], true);
  });
  it('rejects repeated cursors and ignores an aborted response without claiming completeness', async () => {
    const progress = catalogDirectoryProgress<{ readonly id: string }>();
    const read = vi.fn().mockResolvedValue({ entries: [{ id: 'one' }], continuationToken: 'same' });
    await expect(readCatalogDirectory(read, progress, new AbortController().signal, vi.fn())).rejects.toThrow('Invalid catalog paging');
    expect(read).toHaveBeenCalledTimes(2);
    expect(progress.complete).toBe(false);
    const controller = new AbortController();
    controller.abort();
    const page = vi.fn();
    await expect(readCatalogDirectory(vi.fn().mockResolvedValue({ entries: [] }), progress, controller.signal, page)).rejects.toThrow();
    expect(page).not.toHaveBeenCalled();
    expect(progress.complete).toBe(false);
  });
});
