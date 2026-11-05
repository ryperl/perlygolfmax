import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
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
import type { EventLeaderboardClient } from '../client/event-leaderboard';
import { CoursesCatalog, PlayersCatalog } from '../features/catalog';
import { EventWorkspaceView } from '../features/setup';
import { OwnerScoresView } from '../features/scoring';
import { eventTabHref, isEventTab, readEventRoute } from './navigation';
import { SavedEventPage } from './SavedEventPage';
import { EventLeaderboardPage } from './EventLeaderboardPage';
import type { PurseClient } from '../client/purse';
import type { AdmissionsClient } from '../client/admission';
import { clearInvitationReturn } from '../client/invitation-return';
const PursePage = lazy(async () => ({ default: (await import('./PursePage')).PursePage }));
const JoinEventPage = lazy(async () => ({ default: (await import('./JoinEventPage')).JoinEventPage }));
const PlayerAccessPage = lazy(async () => ({ default: (await import('./PlayerAccessPage')).PlayerAccessPage }));

const configuredServices = configureEventServices(import.meta.env);

interface AccountPlacement {
  readonly onSignedOut?: (() => void) | undefined;
  readonly accountHost?: HTMLElement | null;
  readonly preview?: boolean;
}

export function ConfiguredEventsPage(props: AccountPlacement) {
  return <EventsPage {...configuredServices} {...props} />;
}

export interface EventServices {
  readonly session: EventSession;
  readonly events: EventsClient;
  readonly catalog: CatalogClient;
  readonly setup: SetupClient;
  readonly scores: ScoresClient;
  readonly leaderboard?: EventLeaderboardClient;
  readonly purse?: PurseClient;
  readonly admissions?: AdmissionsClient;
}

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => { window.removeEventListener('hashchange', onChange); };
}
function getRoute() { return readEventRoute(window.location.hash); }

export function EventsPage({ services, configurationError, onSignedOut, accountHost, preview = false }: {
  readonly services: EventServices | undefined;
  readonly configurationError?: string;
} & AccountPlacement) {
  const route = useSyncExternalStore(subscribe, getRoute);
  const privateScope = useMemo(() => ({ services, preview }), [services, preview]);
  const [loadedScope, setLoadedScope] = useState<object>();
  const [admissionRevision, setAdmissionRevision] = useState(0);
  const [state, setState] = useState<EventsState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<EventStatus>('active');
  const [identity, setIdentity] = useState<{ readonly services: EventServices; readonly signedIn: boolean }>();
  const [identityFailure, setIdentityFailure] = useState<EventServices>();
  const [accountNotice, setAccountNotice] = useState('');
  const request = useRef<AbortController | null>(null);
  const pendingCreate = useRef<{ readonly name: string; readonly id: string } | null>(null);
  const mounted = useRef(false);
  const running = useRef(false);
  const signedOutHandler = useRef(onSignedOut);
  useEffect(() => { signedOutHandler.current = onSignedOut; }, [onSignedOut]);

  useEffect(() => {
    mounted.current = true;
    setIdentityFailure(undefined);
    setAccountNotice('');
    const controller = new AbortController();
    request.current = controller;
    running.current = false;
    pendingCreate.current = null;
    if (services) {
      void services.session.initialize().then((signedIn) => {
        if (!controller.signal.aborted) {
          setIdentity({ services, signedIn });
          setBusy(false);
          setNotice('');
          setAccountNotice('');
          setView('active');
          setState(signedIn ? { kind: 'loading' } : { kind: 'signed-out' });
        }
      })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setBusy(false);
            setState(error instanceof SessionExpiredError
              ? { kind: 'signed-out', message: error.message }
              : { kind: 'error', message: 'Could not connect to your event services. No saved data was loaded.' });
            if (error instanceof SessionExpiredError) {
              setIdentity({ services, signedIn: false });
              setAccountNotice(error.message);
              signedOutHandler.current?.();
            } else {
              setIdentityFailure(services);
              setAccountNotice('Could not check your account. Try again.');
            }
          }
        });
    }
    return () => { mounted.current = false; controller.abort(); request.current?.abort(); };
  }, [services]);

  useEffect(() => {
    if (!services || identity?.services !== services || !identity.signedIn || preview) return;
    setView('active');
    setState({ kind: 'loading' });
    const controller = new AbortController();
    request.current = controller;
    void services.events.capabilities(controller.signal).then(async (capabilities) => {
      controller.signal.throwIfAborted();
      const page = await services.events.list(controller.signal);
      if (!controller.signal.aborted) {
        setLoadedScope(privateScope);
        setState({ kind: 'ready', capabilities, page });
      }
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof SessionExpiredError) {
        setIdentity({ services, signedIn: false });
        setState({ kind: 'signed-out', message: error.message });
        setAccountNotice(error.message);
        signedOutHandler.current?.();
      } else setState({ kind: 'error', message: 'Could not connect to your event services. No saved data was loaded.' });
    });
    return () => { controller.abort(); };
  }, [services, identity, preview, privateScope, admissionRevision]);

  function expire(message: string) {
    if (services) setIdentity({ services, signedIn: false });
    setState({ kind: 'signed-out', message });
    setAccountNotice(message);
    signedOutHandler.current?.();
  }

  async function run(operation: (service: EventServices, signal: AbortSignal) => Promise<void>) {
    if (!services || running.current) return false;
    running.current = true;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setNotice('');
    setAccountNotice('');
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
      if (mounted.current && !controller.signal.aborted) {
        running.current = false;
        setBusy(false);
      }
    }
  }

  function signOut() {
    void run(async ({ session }, signal) => {
      if (services) setIdentity({ services, signedIn: false });
      setState({ kind: 'signed-out' });
      signedOutHandler.current?.();
      try { await session.signOut(); }
      catch {
        if (!signal.aborted) setAccountNotice('Sign-out did not complete. The identity-provider session may still be active.');
      }
    });
  }

  const signedIn = services && identity?.services === services && identity.signedIn;
  const checkingAccount = services && identity?.services !== services;
  const retryAccount = services && identityFailure === services;
  const account = <div className="account-control">
    <button disabled={!services || busy || (checkingAccount && !retryAccount)}
      onClick={signedIn ? signOut : () => {
        void run(async (service, signal) => {
          try {
            if (checkingAccount) {
              const signedIn = await service.session.initialize();
              if (!signal.aborted) {
                setIdentity({ services: service, signedIn });
                setState(signedIn ? { kind: 'loading' } : { kind: 'signed-out' });
              }
            } else await service.session.signIn();
          }
          catch (error) {
            if (error instanceof SessionExpiredError) throw error;
            if (!signal.aborted) {
              if (checkingAccount) setIdentityFailure(service);
              setAccountNotice(checkingAccount ? 'Could not check your account. Try again.' : 'Sign-in did not complete. Please try again.');
            }
          }
        });
      }}>{signedIn ? 'Sign out' : checkingAccount ? retryAccount ? 'Retry account' : 'Checking account…' : 'Sign in'}</button>
    {!services && <span className="account-hint">Sign-in unavailable</span>}
    {accountNotice && <p role="status">{accountNotice}</p>}
  </div>;
  const accountControl = accountHost ? createPortal(account, accountHost) : account;

  if (preview) return accountControl;

  if (services && (route.startsWith('join:') || route === 'invalid-invitation')) {
    const [, eventId, inviteId, token] = route.split(':');
    return <>{accountControl}
      {route === 'invalid-invitation' || !eventId || !inviteId
        ? <p role="alert">This invitation link is invalid. Ask the organizer for a new private link.</p>
        : services.admissions ? <Suspense fallback={<p role="status">Loading invitation…</p>}>
          <JoinEventPage key={`${eventId}:${inviteId}`} client={services.admissions} eventId={eventId}
            inviteId={inviteId} token={token} signedIn={Boolean(signedIn)} onSessionExpired={expire}
            onClaimed={(claimed) => {
              if (claimed !== inviteId) throw new Error('The invitation response did not confirm this link.');
              window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#join?${new URLSearchParams({ event: eventId, claim: inviteId }).toString()}`);
              clearInvitationReturn();
              window.dispatchEvent(new HashChangeEvent('hashchange'));
            }} onApproved={() => { setState({ kind: 'loading' }); setAdmissionRevision((value) => value + 1); }} />
        </Suspense> : <p role="alert">Player invitations are unavailable in this connection.</p>}
    </>;
  }

  if (services && identity?.services !== services && !retryAccount) {
    return <>{accountControl}<p role="status">Loading your events...</p></>;
  }
  if (services && state.kind === 'ready' && loadedScope !== privateScope) {
    return <>{accountControl}<p role="status">Loading your events...</p></>;
  }
  if (services && state.kind === 'ready' && route) {
    const [kind, eventId] = route.split(':');
    return <>{accountControl}<section>
      {(kind === 'courses' || kind === 'players') && <nav className="event-actions" aria-label="Saved event navigation"><a href="#events">Events</a>
        {state.capabilities.canManageCatalog && <><a href="#events?catalog=courses">Course catalog</a><a href="#events?catalog=players">Player catalog</a></>}
      </nav>}
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
        : kind === 'access' && eventId ? services.admissions
          ? <Suspense fallback={<p role="status">Loading player access…</p>}>
            <PlayerAccessPage key={eventId} eventId={eventId} client={services.admissions} onSessionExpired={expire} />
          </Suspense> : <p role="alert">Player invitations are unavailable in this connection.</p>
        : kind === 'purse' && eventId ? services.purse
          ? <Suspense fallback={<p role="status">Loading prize view…</p>}>
            <PursePage key={eventId} eventId={eventId} client={services.purse} onSessionExpired={expire} />
          </Suspense>
          : <p role="alert">Prize plans are unavailable in this connection. No prize data was loaded.</p>
        : kind === 'leaderboard' && eventId ? services.leaderboard
          ? <EventLeaderboardPage key={eventId} eventId={eventId} client={services.leaderboard} onSessionExpired={expire} />
          : <p role="alert">Overall results are unavailable in this connection. No scores were loaded.</p>
        : isEventTab(kind) && eventId ? <SavedEventPage key={eventId} eventId={eventId} view={kind}
          client={services.setup} scores={services.scores} onSessionExpired={expire} />
        : route.startsWith('score:') ? <OwnerScoresView key={route} eventId={route.split(':')[1] ?? ''} roundId={route.split(':')[2] ?? ''}
          client={services.scores} onSessionExpired={expire} />
        : route.startsWith('event:') ? <EventWorkspaceView key={route} eventId={route.slice(6)}
        canManageCatalog={state.capabilities.canManageCatalog} setup={services.setup} catalog={services.catalog}
        scores={services.scores} onSessionExpired={expire} />
        : state.capabilities.canManageCatalog
          ? route === 'courses' ? <CoursesCatalog client={services.catalog} /> : <PlayersCatalog client={services.catalog} />
          : <p role="alert">Catalog access is restricted to the bootstrapped organizer. Event ownership does not grant catalog access.</p>}
      <p role="status">{notice}</p>
    </section></>;
  }

  return <>{accountControl}<EventsView
    state={services ? state : { kind: 'unconfigured', message: configurationError ?? 'Identity and API settings have not been supplied.' }}
    busy={busy} notice={notice} view={view}
    onReload={() => { void run(async (service, signal) => {
      const signedIn = await service.session.initialize();
      signal.throwIfAborted();
      if (!signedIn) {
        setIdentity({ services: service, signedIn: false });
        setState({ kind: 'signed-out' });
        signedOutHandler.current?.();
        return;
      }
      if (identity?.services !== service || !identity.signedIn) {
        setIdentity({ services: service, signedIn: true });
        setState({ kind: 'loading' });
        return;
      }
      const capabilities = await service.events.capabilities(signal);
      const page = await service.events.list(signal, undefined, view);
      if (!signal.aborted) {
        setState({ kind: 'ready', capabilities, page });
      }
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
  /></>;
}
