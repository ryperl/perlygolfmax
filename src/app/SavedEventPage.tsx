import { useEffect, useRef, useState } from 'react';
import { SessionExpiredError } from '../client/events';
import type { SetupClient } from '../client/setup';
import type { EventWorkspace } from '../domain/setup';
import { EventTripView } from '../features/event-trip';
import type { EventTab } from './navigation';

type SavedEventState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly workspace: EventWorkspace }
  | { readonly kind: 'error'; readonly message: string };

export function SavedEventPage({ client, eventId, view, onSessionExpired }: {
  readonly client: SetupClient;
  readonly eventId: string;
  readonly view: EventTab;
  readonly onSessionExpired: (message: string) => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{
    readonly client: SetupClient;
    readonly eventId: string;
    readonly refresh: number;
    readonly state: SavedEventState;
  } | null>(null);
  const state: SavedEventState = result?.client === client && result.eventId === eventId && result.refresh === refresh
    ? result.state : { kind: 'loading' };
  const expiryHandler = useRef(onSessionExpired);
  useEffect(() => { expiryHandler.current = onSessionExpired; }, [onSessionExpired]);
  useEffect(() => {
    const controller = new AbortController();
    void client.load(eventId, controller.signal).then((workspace) => {
      if (!controller.signal.aborted) setResult({ client, eventId, refresh, state: { kind: 'ready', workspace } });
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      const message = failure instanceof Error ? failure.message : 'Could not load this saved event. Try again.';
      setResult({ client, eventId, refresh, state: { kind: 'error', message } });
      if (failure instanceof SessionExpiredError) expiryHandler.current(message);
    });
    return () => { controller.abort(); };
  }, [client, eventId, refresh]);
  return <section>
    <div className="event-actions"><button disabled={state.kind === 'loading'} onClick={() => { setRefresh((value) => value + 1); }}>Refresh event</button></div>
    {state.kind === 'loading' && <p role="status">Loading saved event…</p>}
    {state.kind === 'error' && <div className="panel"><p role="alert">{state.message}</p><a href="#events">Choose another event</a></div>}
    {state.kind === 'ready' && <EventTripView workspace={state.workspace} view={view} />}
  </section>;
}
