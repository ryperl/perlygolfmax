import { describe, expect, it, vi } from 'vitest';
import { fictionalEvent } from './catalog.test-support';
import type { EventPage } from '../domain/events';
import { eventDirectoryFailure, loadEventDirectory } from './event-directory';
import type { EventDirectoryProgress } from './event-directory';
import { PrivateRequestError } from './private-request';
import type { EventsClient } from './events';

describe('whole event directory', () => {
  it('serially reads empty/intermediate pages before sorting every event, retaining distinct tied IDs', async () => {
    const list = vi.fn<EventsClient['list']>().mockResolvedValueOnce({ events: [{ ...fictionalEvent, id: 'b', startDate: '2026-11-02' }], continuationToken: 'one' })
      .mockResolvedValueOnce({ events: [], continuationToken: 'two' })
      .mockResolvedValueOnce({ events: [{ ...fictionalEvent, id: 'z' }, { ...fictionalEvent, id: 'a', startDate: '2026-11-02' },
        { ...fictionalEvent, id: 'c', startDate: '2024-02-29' }] });
    const signal = new AbortController().signal;
    const progress = vi.fn();
    expect((await loadEventDirectory({ list }, signal, 'archived', progress)).events.map((event) => event.id)).toEqual(['c', 'a', 'b', 'z']);
    expect(list.mock.calls.map((call) => call.slice(1))).toEqual([[undefined, 'archived'], ['one', 'archived'], ['two', 'archived']]);
    expect(progress).toHaveBeenCalledTimes(3);
  });
  it.each([new Error('Fictional outage'), new PrivateRequestError(429, 'Fictional quota', 12)])('retains loaded pages and resumes the unread cursor after %s', async (failure) => {
    const list = vi.fn<EventsClient['list']>().mockResolvedValueOnce({ events: [fictionalEvent], continuationToken: 'next' }).mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ events: [{ ...fictionalEvent, id: 'another', startDate: '2026-01-01' }] });
    let checkpoint: EventDirectoryProgress | undefined;
    const progress = (value: EventDirectoryProgress) => { checkpoint = value; };
    const signal = new AbortController().signal;
    await expect(loadEventDirectory({ list }, signal, 'active', progress)).rejects.toBe(failure);
    expect(checkpoint?.events).toEqual([fictionalEvent]);
    expect(eventDirectoryFailure(failure)).toContain('incomplete');
    if (failure instanceof PrivateRequestError) expect(eventDirectoryFailure(failure)).toContain('Wait 12 seconds');
    const result = await loadEventDirectory({ list }, signal, 'active', progress, checkpoint);
    expect(result.events.map((event) => event.id)).toEqual(['another', fictionalEvent.id]);
    expect(list.mock.calls.map((call) => call[1])).toEqual([undefined, 'next', 'next']);
  });
  it('does not publish or fetch further pages after cancellation', async () => {
    const controller = new AbortController();
    const list = vi.fn<EventsClient['list']>().mockImplementation(() => { controller.abort(); return Promise.resolve({ events: [fictionalEvent], continuationToken: 'next' }); });
    const progress = vi.fn();
    await expect(loadEventDirectory({ list }, controller.signal, 'active', progress)).rejects.toThrow();
    expect(list).toHaveBeenCalledOnce();
    expect(progress).not.toHaveBeenCalled();
  });
  it('rejects repeated cursors rather than looping or declaring completion; newer repeated IDs replace stale projections', async () => {
    const list = vi.fn<EventsClient['list']>().mockResolvedValue({ events: [fictionalEvent], continuationToken: 'same' });
    await expect(loadEventDirectory({ list }, new AbortController().signal, 'active', vi.fn())).rejects.toThrow('repeated a cursor');
    expect(list).toHaveBeenCalledTimes(2);
    const pages: EventPage[] = [{ events: [fictionalEvent], continuationToken: 'one' },
      { events: [{ ...fictionalEvent, startDate: '2026-11-01' }] }];
    const repeated = vi.fn<EventsClient['list']>().mockImplementation(() => Promise.resolve(pages.shift() ?? { events: [] }));
    expect((await loadEventDirectory({ list: repeated }, new AbortController().signal, 'active', vi.fn())).events)
      .toEqual([{ ...fictionalEvent, startDate: '2026-11-01' }]);
  });
});
