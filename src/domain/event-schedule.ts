import type { EventSummary } from './events.js';

function compareDates(left?: string, right?: string): number {
  const first = left || '9999-99-99';
  const second = right || '9999-99-99';
  return first < second ? -1 : first > second ? 1 : 0;
}

export function sortEventsByStartDate(events: readonly EventSummary[]): readonly EventSummary[] {
  return [...events].sort((left, right) => {
    const date = compareDates(left.startDate, right.startDate);
    return date || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  });
}

export function sortRoundsByStartDate<T extends { readonly startDate?: string }>(rounds: readonly T[]): readonly T[] {
  return [...rounds].sort((left, right) => compareDates(left.startDate, right.startDate));
}

export function eventStartDateLabel(date: string): string {
  const [year = '', month = '', day = ''] = date.split('-');
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[Number(month) - 1] ?? ''} ${String(Number(day))}, ${year}`;
}

export function numericEventDateLabel(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}`;
}
