import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PurseClient } from '../client/purse';
import { SessionExpiredError } from '../client/events';
import { PrivateRequestError } from '../client/private-request';
import type { EventPurseView } from '../domain/purse-settings';
import { PursePanel } from '../features/purse';

export function PursePage({ client, eventId, onSessionExpired }: {
  readonly client: PurseClient;
  readonly eventId: string;
  readonly onSessionExpired: (message: string) => void;
}) {
  const identity = useMemo(() => ({ client, eventId }), [client, eventId]);
  const active = useRef<object>(identity);
  const request = useRef<AbortController | null>(null);
  const expiry = useRef(onSessionExpired);
  const [result, setResult] = useState<{ readonly identity: object; readonly value?: EventPurseView; readonly error?: string }>();
  const [activity, setActivity] = useState<{ readonly identity: object; readonly busy: boolean }>();
  const [dirty, setDirty] = useState(false);
  const current = result?.identity === identity ? result : undefined;
  const busy = activity?.identity === identity && activity.busy;
  useLayoutEffect(() => { active.current = identity; }, [identity]);
  useEffect(() => { expiry.current = onSessionExpired; }, [onSessionExpired]);

  const failure = useCallback((error: unknown, preserve: boolean) => {
    if (active.current !== identity) return;
    const expired = error instanceof SessionExpiredError || error instanceof PrivateRequestError && error.status === 401;
    const denied = expired || error instanceof PrivateRequestError && [403, 404].includes(error.status);
    if (!preserve || denied) {
      setResult({ identity, error: error instanceof Error ? error.message : 'Prize data could not be loaded. Refresh to retry.' });
    }
    if (expired) expiry.current(error instanceof Error ? error.message : 'Your session expired. Sign in again.');
  }, [identity]);

  const load = useCallback(async (preserve = false): Promise<EventPurseView | null> => {
    if (request.current) return null;
    const controller = new AbortController();
    request.current = controller;
    setActivity({ identity, busy: true });
    try {
      const value = await client.load(eventId, controller.signal);
      if (controller.signal.aborted || active.current !== identity) return null;
      if (value.workspace.event.id !== eventId || value.workspace.event.role !== 'owner') {
        throw new PrivateRequestError(403, 'Prize plans and winnings are available to the event owner only.');
      }
      setResult({ identity, value });
      return value;
    } catch (error) {
      if (controller.signal.aborted || active.current !== identity) return null;
      failure(error, preserve);
      if (preserve) throw error;
      return null;
    } finally {
      if (request.current === controller) request.current = null;
      if (active.current === identity) setActivity({ identity, busy: false });
    }
  }, [client, eventId, identity, failure]);

  useEffect(() => {
    void load();
    return () => { request.current?.abort(); request.current = null; };
  }, [load]);

  return <section>
    <div className="event-actions">
      <a href={`#overview?event=${encodeURIComponent(eventId)}`}>Back to event overview</a>
      <button disabled={busy || dirty} onClick={() => { void load(); }}>Refresh prize results</button>
    </div>
    {!current && <p role="status">Loading prize plan and winnings…</p>}
    {current?.error && <div><p role="alert">{current.error}</p><a href="#events">Choose another event</a></div>}
    {current?.value && <PursePanel value={current.value} busy={busy} onDirtyChange={setDirty}
      onRefresh={() => load(true)} onSave={async (plan, resolutions, etag, requestId) => {
        if (request.current) return null;
        const controller = new AbortController();
        request.current = controller;
        setActivity({ identity, busy: true });
        try {
          const value = await client.save(eventId, plan, resolutions, etag, requestId, controller.signal);
          if (controller.signal.aborted || active.current !== identity) return null;
          if (value.current.workspace.event.id !== eventId || value.current.workspace.event.role !== 'owner') {
            throw new PrivateRequestError(403, 'The save response did not confirm this event owner context.');
          }
          setResult({ identity, value: value.current });
          return value;
        } catch (error) {
          if (controller.signal.aborted || active.current !== identity) return null;
          failure(error, true);
          throw error;
        } finally {
          if (request.current === controller) request.current = null;
          if (active.current === identity) setActivity({ identity, busy: false });
        }
      }} />}
  </section>;
}
