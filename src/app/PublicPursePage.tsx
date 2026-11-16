import { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicPurseClient } from '../client/public-purse';
import { SessionExpiredError } from '../client/events';
import type { PublicPurseSummary } from '../domain/public-purse';
import { PublicPurseResults } from '../features/purse';

export function PublicPursePage({ client, eventId, onSessionExpired }: {
  readonly client: PublicPurseClient;
  readonly eventId: string;
  readonly onSessionExpired: (message: string) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const loadPlayer = useMemo(() => {
    const load = client.player;
    return load ? (playerId: string, signal: AbortSignal) => load(eventId, playerId, signal) : undefined;
  }, [client, eventId]);
  const identity = useMemo(() => ({ client, eventId }), [client, eventId]);
  const expiry = useRef(onSessionExpired);
  const [result, setResult] = useState<{ readonly identity: object; readonly value?: PublicPurseSummary; readonly error?: string }>();
  const [completed, setCompleted] = useState<{ readonly identity: object; readonly attempt: number }>();
  const current = result?.identity === identity ? result : undefined;
  const busy = completed?.identity !== identity || completed.attempt !== attempt;
  useEffect(() => { expiry.current = onSessionExpired; }, [onSessionExpired]);
  useEffect(() => {
    const controller = new AbortController();
    void client.load(eventId, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      if (value.eventId !== eventId) throw new Error('Prize results did not match this event. Refresh to retry.');
      setResult({ identity, value });
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      const message = failure instanceof Error ? failure.message : 'Prize results could not be loaded. Refresh to retry.';
      setResult({ identity, error: message });
      if (failure instanceof SessionExpiredError) expiry.current(message);
    }).finally(() => {
      if (!controller.signal.aborted) setCompleted({ identity, attempt });
    });
    return () => { controller.abort(); };
  }, [client, eventId, identity, attempt]);
  return <section>
    <div className="event-actions">
      <a href={`#overview?event=${encodeURIComponent(eventId)}`}>Back to event overview</a>
      <button disabled={busy} aria-busy={busy} onClick={() => { setAttempt((value) => value + 1); }}>Refresh prize results</button>
    </div>
    {!current && <p role="status">Loading winnings…</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {current?.value && <PublicPurseResults key={eventId} value={current.value}
      loadPlayer={loadPlayer} onSessionExpired={onSessionExpired} />}
  </section>;
}
