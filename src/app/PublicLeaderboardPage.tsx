import { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicLeaderboardClient } from '../client/public-leaderboard';
import { SessionExpiredError } from '../client/events';
import type { PublicLeaderboardSummary } from '../domain/public-leaderboard';
import { EventLeaderboard } from '../features/leaderboard';
import { EventSkinsPanel } from '../features/event-skins';
import { EventReviewBanner } from '../features/event-review';

export function PublicLeaderboardPage({ client, eventId, eventSkins, onSessionExpired }: {
  readonly client: PublicLeaderboardClient;
  readonly eventId: string;
  readonly eventSkins: boolean;
  readonly onSessionExpired: (message: string) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const kind = eventSkins ? 'event-skins' : 'overall';
  const loadDetails = useMemo(() => {
    const load = client.details;
    return load ? (signal: AbortSignal) => load(eventId, signal) : undefined;
  }, [client, eventId]);
  const generation = useMemo(() => ({ client, eventId, kind, attempt }), [client, eventId, kind, attempt]);
  const expiry = useRef(onSessionExpired);
  const [result, setResult] = useState<{ readonly generation: object; readonly value?: PublicLeaderboardSummary; readonly error?: string }>();
  const current = result?.generation === generation ? result : undefined;
  useEffect(() => { expiry.current = onSessionExpired; }, [onSessionExpired]);
  useEffect(() => {
    const controller = new AbortController();
    void client.load(eventId, controller.signal, kind).then((value) => {
      if (controller.signal.aborted) return;
      if (value.workspace.event.id !== eventId || value.kind !== kind) throw new Error('Results did not match this event view. Refresh to retry.');
      setResult({ generation, value });
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      const message = failure instanceof Error ? failure.message : 'Results could not be loaded. Refresh to retry.';
      setResult({ generation, error: message });
      if (failure instanceof SessionExpiredError) expiry.current(message);
    });
    return () => { controller.abort(); };
  }, [client, eventId, kind, generation]);
  return <section>
    {current?.value?.reviewNotices && <EventReviewBanner notices={current.value.reviewNotices} />}
    <div className="event-actions">
      {eventSkins && <a href={`#overview?event=${encodeURIComponent(eventId)}`}>Back to event overview</a>}
      <button disabled={!current} onClick={() => { setAttempt((value) => value + 1); }}>Refresh {eventSkins ? 'event skins' : 'overall results'}</button>
    </div>
    {!current && <p role="status">Loading {eventSkins ? 'event skins' : 'overall results'}…</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {current?.value?.kind === 'overall' && <EventLeaderboard value={current.value} />}
    {current?.value?.kind === 'event-skins' && <EventSkinsPanel key={eventId} value={current.value}
      loadDetails={loadDetails} onSessionExpired={onSessionExpired} />}
  </section>;
}
