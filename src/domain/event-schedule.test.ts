import { describe, expect, it } from 'vitest';
import type { EventSummary } from './events';
import { eventStartDateLabel, sortEventsByStartDate, sortRoundsByStartDate } from './event-schedule';
const fictionalEvent: EventSummary = { id: 'fictional', name: 'Fictional Event', createdAt: '2026-01-01', etag: 'v1', role: 'owner', status: 'active' };

describe('calendar scheduling order', () => {
  it('orders all dated events before undated, including past events, with deterministic ID ties', () => {
    const events = [
      { ...fictionalEvent, id: 'b', startDate: '2026-11-01' },
      { ...fictionalEvent, id: 'z' },
      { ...fictionalEvent, id: 'a', startDate: '2026-11-01' },
      { ...fictionalEvent, id: 'c', startDate: '2024-02-29' },
      { ...fictionalEvent, id: 'd', startDate: '9999-12-31' },
    ];
    expect(sortEventsByStartDate(events).map((event) => event.id)).toEqual(['c', 'a', 'b', 'd', 'z']);
    expect(events[0]?.id).toBe('b');
  });
  it('preserves configured round order for same-date and undated rounds without mutating inputs', () => {
    const rounds = [{ id: 'z', startDate: '2026-11-02' }, { id: 'b', startDate: '' },
      { id: 'a', startDate: '2026-11-01' }, { id: 'y', startDate: '2026-11-02' }, { id: 'c' }];
    expect(sortRoundsByStartDate(rounds).map((round) => round.id)).toEqual(['a', 'z', 'y', 'b', 'c']);
    expect(rounds.map((round) => round.id)).toEqual(['z', 'b', 'a', 'y', 'c']);
  });
  it('formats literal calendar components, including leap days and early years, without timezone conversion', () => {
    expect(eventStartDateLabel('2024-02-29')).toBe('February 29, 2024');
    expect(eventStartDateLabel('0001-01-01')).toBe('January 1, 0001');
  });
});
