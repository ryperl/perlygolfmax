import { describe, expect, it, vi } from 'vitest';
import { loadQuickDirectory } from './quick-directory';
import type { QuickDirectory } from './quick-directory';
import type { QuickPage } from '../../domain/quick-round';

describe('Quick round directory paging', () => {
  it('resumes the failed cursor without re-reading completed pages', async () => {
    const read = vi.fn<(signal: AbortSignal, cursor?: string) => Promise<QuickPage<{ readonly id: string }>>>()
      .mockResolvedValueOnce({ items: [{ id: 'fictional-a' }], continuationToken: 'next' })
      .mockRejectedValueOnce(new Error('Quota'))
      .mockResolvedValueOnce({ items: [{ id: 'fictional-b' }] });
    let progress: QuickDirectory<{ readonly id: string }> | undefined;
    const remember = (value: QuickDirectory<{ readonly id: string }>) => { progress = value; };
    const signal = new AbortController().signal;
    await expect(loadQuickDirectory(read, signal, remember)).rejects.toThrow('Quota');
    const result = await loadQuickDirectory(read, signal, remember, progress);
    expect(result.items.map((item) => item.id)).toEqual(['fictional-a', 'fictional-b']);
    expect(read.mock.calls.map((call) => call[1])).toEqual([undefined, 'next', 'next']);
  });
  it('does not expose aborted reads and rejects cursor cycles', async () => {
    const controller = new AbortController();
    const remember = vi.fn();
    await expect(loadQuickDirectory(() => {
      controller.abort(); return Promise.resolve({ items: [{ id: 'fictional-a' }] });
    }, controller.signal, remember)).rejects.toMatchObject({ name: 'AbortError' });
    expect(remember).not.toHaveBeenCalled();
    await expect(loadQuickDirectory(() => Promise.resolve({ items: [], continuationToken: 'same' }),
      new AbortController().signal, remember)).rejects.toThrow('paging repeated');
  });
});
