import type { EventPage, EventStatus, EventSummary } from '../domain/events';
import { sortEventsByStartDate } from '../domain/event-schedule';
import type { EventsClient } from './events';
import { PrivateRequestError } from './private-request';

export interface EventDirectoryProgress {
  readonly events: readonly EventSummary[];
  readonly cursor?: string;
  readonly cursors: readonly string[];
}

export async function loadEventDirectory(
  client: Pick<EventsClient, 'list'>,
  signal: AbortSignal,
  status: EventStatus,
  onProgress: (progress: EventDirectoryProgress) => void,
  resume?: EventDirectoryProgress,
): Promise<EventPage> {
  let progress: EventDirectoryProgress = resume ?? { events: [], cursors: [] };
  for (;;) {
    signal.throwIfAborted();
    const page = await client.list(signal, progress.cursor, status);
    signal.throwIfAborted();
    const cursor = page.continuationToken;
    if (cursor && progress.cursors.includes(cursor)) throw new Error('Event pagination repeated a cursor. Refresh the directory to restart safely.');
    const events = new Map(progress.events.map((event) => [event.id, event]));
    page.events.forEach((event) => { events.set(event.id, event); });
    progress = { events: [...events.values()], ...(cursor ? { cursor } : {}),
      cursors: cursor ? [...progress.cursors, cursor] : progress.cursors };
    onProgress(progress);
    if (!cursor) return { events: sortEventsByStartDate(progress.events) };
  }
}

export function eventDirectoryFailure(error: unknown): string {
  const wait = error instanceof PrivateRequestError && error.status === 429
    ? ` Wait ${String(error.retryAfterSeconds ?? 60)} seconds before retrying.` : '';
  return `The event directory is incomplete; date order is not yet available. Loaded pages were retained. Try again to resume, or refresh to restart.${wait}`;
}
