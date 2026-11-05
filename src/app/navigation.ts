import { isUuid } from '../contracts/events';

export const navigation = [
  { id: 'events', label: 'Events' },
  { id: 'overview', label: 'Overview' },
  { id: 'rounds', label: 'Rounds' },
  { id: 'group', label: 'The group' },
] as const;

export type EventTab = 'overview' | 'rounds' | 'group';
export type Page = (typeof navigation)[number]['id'] | 'preview' | 'leaderboard';

export function isEventTab(value: string | undefined): value is EventTab {
  return value === 'overview' || value === 'rounds' || value === 'group';
}

export function readPage(hash: string, search = ''): Page {
  if (new URLSearchParams(search).get('event-auth') === '1' && (!hash || /^#(?:code|error)=/.test(hash))) return 'events';
  const id = hash.replace(/^#/, '').split('?')[0];
  return id === 'preview' || id === 'leaderboard' ? id : navigation.find((page) => page.id === id)?.id ?? 'events';
}

export function readPreviewTab(hash: string): EventTab {
  const view = new URLSearchParams(hash.split('?')[1] ?? '').get('view') ?? undefined;
  return isEventTab(view) ? view : 'overview';
}

export function readSelectedEvent(hash: string): string | null {
  const page = hash.slice(1).split('?')[0];
  if (page !== 'events' && page !== 'leaderboard' && !isEventTab(page)) return null;
  const values = new URLSearchParams(hash.split('?')[1] ?? '').getAll('event');
  return values.length === 1 && isUuid(values[0]) ? values[0] : null;
}

export function eventTabHref(tab: EventTab, eventId: string | null): string {
  return `#${tab}${eventId ? `?event=${encodeURIComponent(eventId)}` : ''}`;
}

export function readEventRoute(hash: string): string {
  const page = hash.slice(1).split('?')[0];
  if (page !== 'events' && page !== 'leaderboard' && !isEventTab(page)) return '';
  const query = new URLSearchParams(hash.split('?')[1] ?? '');
  const event = query.get('event');
  const round = query.get('round');
  if (round !== null) return page === 'events' && query.getAll('event').length === 1 && query.getAll('round').length === 1
    && event && isUuid(event) && isUuid(round) ? `score:${event}:${round}` : 'invalid-score';
  if (event !== null) {
    if (query.getAll('event').length !== 1 || !isUuid(event)) return 'invalid-event';
    return `${page === 'events' ? 'event' : page}:${event}`;
  }
  if (isEventTab(page)) return `select:${page}`;
  if (page === 'leaderboard') return 'invalid-event';
  const catalog = query.get('catalog');
  return catalog === 'courses' || catalog === 'players' ? catalog : '';
}
