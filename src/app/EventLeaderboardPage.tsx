import { useEffect, useMemo, useRef, useState } from 'react';
import type { EventLeaderboardClient } from '../client/event-leaderboard';
import { EventChangedError, SessionExpiredError } from '../client/events';
import { PrivateRequestError } from '../client/private-request';
import type { EventLeaderboardView } from '../domain/event-leaderboard';
import { EventLeaderboard } from '../features/leaderboard';

export function EventLeaderboardPage({ client, eventId, onSessionExpired }: {
  readonly client: EventLeaderboardClient;
  readonly eventId: string;
  readonly onSessionExpired: (message: string) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const generation = useMemo(() => ({ client, eventId, attempt }), [client, eventId, attempt]);
  const [result, setResult] = useState<{
    readonly generation: object;
    readonly value?: EventLeaderboardView; readonly error?: string;
  } | null>(null);
  const current = result?.generation === generation ? result : null;
  const expiryHandler = useRef(onSessionExpired);
  useEffect(() => { expiryHandler.current = onSessionExpired; }, [onSessionExpired]);
  useEffect(() => {
    const controller = new AbortController();
    void client.load(eventId, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      if (value.workspace.event.id !== eventId || value.workspace.event.role !== 'owner' && value.workspace.canViewScores !== true) {
        setResult({ generation, error: 'Overall results are unavailable for this event access.' });
      } else setResult({ generation, value });
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      const expired = failure instanceof SessionExpiredError || failure instanceof PrivateRequestError && failure.status === 401;
      const error = failure instanceof EventChangedError || failure instanceof PrivateRequestError && failure.status === 409
        ? 'The event changed during this read. Refresh overall results to retry.'
        : failure instanceof PrivateRequestError && failure.status === 429
          ? `Too many requests. Retry after ${String(failure.retryAfterSeconds ?? 60)} seconds.`
          : failure instanceof Error ? failure.message : 'Overall results could not be loaded. Refresh to retry.';
      setResult({ generation, error });
      if (expired) expiryHandler.current(error);
    });
    return () => { controller.abort(); };
  }, [client, eventId, attempt, generation]);
  return <section>
    <button disabled={!current} onClick={() => { setAttempt((value) => value + 1); }}>Refresh overall results</button>
    {!current && <p role="status">Loading overall results…</p>}
    {current?.error && <div><p role="alert">{current.error}</p><a href="#events">Choose another event</a></div>}
    {current?.value && <EventLeaderboard value={current.value} />}
  </section>;
}
