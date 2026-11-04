import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { EventsView } from '../features/events';
import type { EventsState } from '../features/events';
import type { EventsClient } from '../client/events';
import { EventChangedError, SessionExpiredError } from '../client/events';
import type { EventStatus } from '../domain/events';
import type { EventSession } from '../client/identity';
import { configureEventServices } from './event-services';
import type { CatalogClient } from '../client/catalog';
import type { SetupClient } from '../client/setup';
import type { ScoresClient } from '../client/scoring';
import { CoursesCatalog, PlayersCatalog } from '../features/catalog';
import { EventWorkspaceView } from '../features/setup';
import { OwnerScoresView } from '../features/scoring';
import { eventTabHref, isEventTab, readEventRoute } from './navigation';
import { SavedEventPage } from './SavedEventPage';

const configuredServices = configureEventServices(import.meta.env);

export function ConfiguredEventsPage({ onSignedOut }: { readonly onSignedOut?: () => void }) {
  return <EventsPage {...configuredServices} onSignedOut={onSignedOut} />;
}

export interface EventServices {
  readonly session: EventSession;
  readonly events: EventsClient;
  readonly catalog: CatalogClient;
  readonly setup: SetupClient;
  readonly scores: ScoresClient;
}

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => { window.removeEventListener('hashchange', onChange); };
}
function getRoute() { return readEventRoute(window.location.hash); }

export function EventsPage({ services, configurationError, onSignedOut }: {
  readonly services: EventServices | undefined;
  readonly configurationError?: string;
  readonly onSignedOut?: (() => void) | undefined;
}) {
  const route = useSyncExternalStore(subscribe, getRoute);
  const [state, setState] = useState<EventsState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<EventStatus>('active');
  const request = useRef<AbortController | null>(null);
  const pendingCreate = useRef<{ readonly name: string; readonly id: string } | null>(null);
  const mounted = useRef(false);
  const running = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    request.current = controller;
    if (services) {
      void services.session.initialize().then(async (signedIn) => {
        if (!signedIn) return { kind: 'signed-out' } satisfies EventsState;
        const capabilities = await services.events.capabilities(controller.signal);
        const page = await services.events.list(controller.signal);
        return { kind: 'ready', capabilities, page } satisfies EventsState;
      }).then((result) => {
        if (!controller.signal.aborted) {
          setView('active');
          setState(result);
        }
      })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setState(error instanceof SessionExpiredError
              ? { kind: 'signed-out', message: error.message }
              : { kind: 'error', message: 'Could not connect to your event services. No saved data was loaded.' });
            if (error instanceof SessionExpiredError) onSignedOut?.();
          }
        });
    }
    return () => { mounted.current = false; controller.abort(); };
  }, [services, onSignedOut]);

  function expire(message: string) {
    setState({ kind: 'signed-out', message });
    onSignedOut?.();
  }

  async function run(operation: (service: EventServices, signal: AbortSignal) => Promise<void>) {
    if (!services || running.current) return false;
    running.current = true;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setNotice('');
    try {
      await operation(services, controller.signal);
      return mounted.current && !controller.signal.aborted;
    }
    catch (error) {
      if (mounted.current && !controller.signal.aborted) {
        if (error instanceof SessionExpiredError) expire(error.message);
        else if (error instanceof EventChangedError) setNotice(error.message);
        else setNotice('The operation failed. Nothing was confirmed saved. Refresh before retrying; an event creation retry uses the same request ID.');
      }
      return false;
    } finally {
      running.current = false;
      if (mounted.current && !controller.signal.aborted) setBusy(false);
    }
  }

  if (services && state.kind === 'ready' && route) {
    const [kind, eventId] = route.split(':');
    return <section>
      {(kind === 'courses' || kind === 'players') && <nav className="event-actions" aria-label="Saved event navigation"><a href="#events">Events</a>
        {state.capabilities.canManageCatalog && <><a href="#events?catalog=courses">Course catalog</a><a href="#events?catalog=players">Player catalog</a></>}
      </nav>}
      <button disabled={busy} onClick={() => { void run(async ({ session }) => {
        setState({ kind: 'signed-out' });
        onSignedOut?.();
        try { await session.signOut(); }
        catch { setNotice('Sign-out did not complete. The identity-provider session may still be active.'); }
      }); }}>Sign out</button>
      {route === 'invalid-score' ? <p role="alert">Invalid event or round identifier. No score request was made.</p>
        : route === 'invalid-event' ? <p role="alert">Invalid event identifier. Choose an event from Events.</p>
        : kind === 'select' && isEventTab(eventId) ? <section>
          <h1>Choose an event</h1>
          <p>Open a saved event to view its {eventId === 'group' ? 'group' : eventId}. No event is selected automatically.</p>
          <ul className="round-list">{state.page.events.map((event) => <li className="panel" key={event.id}>
            <a href={eventTabHref(eventId, event.id)}>{event.name}</a>
          </li>)}</ul>
          {state.page.events.length === 0 && <p>No events are available on this page.</p>}
          <a href="#events">Browse your events</a>
        </section>
        : isEventTab(kind) && eventId ? <SavedEventPage key={eventId} eventId={eventId} view={kind}
          client={services.setup} onSessionExpired={expire} />
        : route.startsWith('score:') ? <OwnerScoresView key={route} eventId={route.split(':')[1] ?? ''} roundId={route.split(':')[2] ?? ''}
          client={services.scores} onSessionExpired={expire} />
        : route.startsWith('event:') ? <EventWorkspaceView key={route} eventId={route.slice(6)}
        canManageCatalog={state.capabilities.canManageCatalog} setup={services.setup} catalog={services.catalog} />
        : state.capabilities.canManageCatalog
          ? route === 'courses' ? <CoursesCatalog client={services.catalog} /> : <PlayersCatalog client={services.catalog} />
          : <p role="alert">Catalog access is restricted to the bootstrapped organizer. Event ownership does not grant catalog access.</p>}
      <p role="status">{notice}</p>
    </section>;
  }

  return <EventsView
    state={services ? state : { kind: 'unconfigured', message: configurationError ?? 'Identity and API settings have not been supplied.' }}
    busy={busy} notice={notice} view={view}
    onSignIn={() => { void run(async ({ session }) => { await session.signIn(); }); }}
    onSignOut={() => { void run(async ({ session }) => {
      setState({ kind: 'signed-out' });
      onSignedOut?.();
      try { await session.signOut(); }
      catch {
        setNotice('Sign-out did not complete. The identity-provider session may still be active.');
      }
    }); }}
    onReload={() => { void run(async (service, signal) => {
      if (!await service.session.initialize()) {
        if (!signal.aborted) setState({ kind: 'signed-out' });
        return;
      }
      const capabilities = await service.events.capabilities(signal);
      const page = await service.events.list(signal, undefined, view);
      if (!signal.aborted) setState({ kind: 'ready', capabilities, page });
    }); }}
    onNextPage={() => { void run(async (service, signal) => {
      if (state.kind !== 'ready') return;
      const page = await service.events.list(signal, state.page.continuationToken, view);
      if (!signal.aborted) setState({ ...state, page });
    }); }}
    onCreate={(name) => {
      if (state.kind !== 'ready') return Promise.resolve(false);
      return run(async (service, signal) => {
        if (pendingCreate.current?.name !== name) pendingCreate.current = { name, id: crypto.randomUUID() };
        const saved = await service.events.create(name, pendingCreate.current.id, signal);
        if (!signal.aborted) {
          pendingCreate.current = null;
          setState({ ...state, page: { events: [
            ...(saved.status === view ? [saved] : []),
            ...state.page.events.filter((event) => event.id !== saved.id),
          ] } });
          setNotice(saved.status === 'archived' ? 'The previously saved event is now archived. Find it in Archived events.' : 'Event saved.');
        }
      });
    }}
    onViewChange={(status) => { void run(async (service, signal) => {
      if (state.kind !== 'ready') return;
      const page = await service.events.list(signal, undefined, status);
      if (!signal.aborted) {
        setView(status);
        setState({ ...state, page });
      }
    }); }}
    onStatusChange={(event, status) => { void run(async (service, signal) => {
      if (state.kind !== 'ready') return;
      await service.events.setStatus(event, status, signal);
      if (!signal.aborted) {
        setState({ ...state, page: {
          ...state.page, events: state.page.events.filter((item) => item.id !== event.id),
        } });
        setNotice(status === 'archived' ? 'Event archived. Its data was preserved.' : 'Event restored to Active events.');
      }
    }); }}
  />;
}
