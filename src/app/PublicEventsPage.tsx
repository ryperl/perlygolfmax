import { lazy, Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { PublicServices } from '../client/public-events';
import { createPublicServices } from '../client/public-events';
import { SessionExpiredError } from '../client/events';
import { readPublicApiUrl } from '../client/config';
import type { EventPage } from '../domain/events';
import type { EventWorkspace } from '../domain/setup';
import type { ScoreLocation } from '../domain/score-location';
import { groupStartingHole } from '../domain/round-navigation';
import { OwnerScoresView } from '../features/scoring';
import { eventTabHref, isEventTab, readEventRoute } from './navigation';
import type { EventTab } from './navigation';
import { SavedEventPage } from './SavedEventPage';
import { EventLeaderboardPage } from './EventLeaderboardPage';
import { clearScoreLocation, loadScoreLocation, readScoreLocation, saveScoreLocation, scoreLocationHref } from './score-resume';
const PursePage = lazy(async () => ({ default: (await import('./PursePage')).PursePage }));

function configuration(): { readonly services?: PublicServices; readonly error?: string } {
  try {
    const url = readPublicApiUrl(import.meta.env);
    return url ? { services: createPublicServices(url) } : {};
  } catch {
    return { error: 'Public event service configuration is invalid. No saved data was loaded.' };
  }
}
const configured = configuration();
function subscribe(change: () => void) {
  window.addEventListener('hashchange', change);
  return () => { window.removeEventListener('hashchange', change); };
}
function route() { return readEventRoute(window.location.hash); }

export function PublicEventsPage({ services: override }: { readonly services?: PublicServices | undefined }) {
  const services = override ?? configured.services;
  const current = useSyncExternalStore(subscribe, route);
  const [unavailable, setUnavailable] = useState<{ readonly route: string; readonly message: string }>();
  const ended = useCallback((message: string) => {
    const saved = loadScoreLocation();
    const [, eventId, roundId] = current.split(':');
    const warning = saved.location && saved.location.eventId === eventId && (!roundId || saved.location.roundId === roundId)
      ? clearScoreLocation() : saved.error;
    setUnavailable({ route: current, message: warning ? `${message} ${warning}` : message });
  }, [current]);
  if (!services) return <section><h1>Events</h1><h2>Event services are not configured</h2>
    <p>{configured.error ?? 'Public scoring is not connected in this build. The fictional Preview remains separate.'}</p></section>;
  if (unavailable?.route === current) return <section><p role="alert">{unavailable.message}</p><a href="#events?choose=1">Choose an active event</a></section>;
  const [kind, eventId, roundId] = current.split(':');
  if (kind === 'score' && eventId && roundId) return <PublicRoundPage key={`${eventId}:${roundId}`}
    services={services} eventId={eventId} roundId={roundId} onUnavailable={ended} />;
  if (kind === 'leaderboard' && eventId) return <EventLeaderboardPage client={services.leaderboard} eventId={eventId} onSessionExpired={ended} />;
  if (kind === 'purse' && eventId) return <Suspense fallback={<p role="status">Loading winnings…</p>}>
    <PursePage client={services.purse} eventId={eventId} onSessionExpired={ended} />
  </Suspense>;
  if (isEventTab(kind) && eventId) return <SavedEventPage client={services.setup} scores={services.scores}
    eventId={eventId} view={kind} onSessionExpired={ended} />;
  if (kind === 'event' && eventId) return <SavedEventPage client={services.setup} scores={services.scores}
    eventId={eventId} view="overview" onSessionExpired={ended} />;
  if (kind?.startsWith('invalid')) return <section><p role="alert">This event or round link is invalid.</p><a href="#events?choose=1">Choose an event</a></section>;
  return <PublicEventDirectory key={current} services={services} selection={kind === 'select' && isEventTab(eventId) ? eventId : undefined} />;
}

function PublicEventDirectory({ services, selection }: { readonly services: PublicServices; readonly selection?: EventTab | undefined }) {
  const [cursor, setCursor] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const generation = useMemo(() => ({ services, cursor, attempt }), [services, cursor, attempt]);
  const [result, setResult] = useState<{ readonly generation: object; readonly page?: EventPage; readonly error?: string }>();
  const page = result?.generation === generation ? result.page : undefined;
  const error = result?.generation === generation ? result.error : undefined;
  useEffect(() => {
    const controller = new AbortController();
    void services.events.list(controller.signal, cursor).then((value) => {
      if (!controller.signal.aborted) setResult({ generation, page: value });
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setResult({ generation, error: failure instanceof Error ? failure.message : 'Events could not be loaded. Try again.' });
    });
    return () => { controller.abort(); };
  }, [services, cursor, generation]);
  return <section><p className="eyebrow">Golf scoreboard</p><h1>{selection ? 'Choose an event' : 'Events'}</h1>
    <p>No account needed. Open an active event to enter scores, view standings and see winnings.
      Anyone visiting can update scores; organizer management stays protected.</p>
    <button disabled={!page && !error} onClick={() => { setCursor(undefined); setAttempt((value) => value + 1); }}>Refresh events</button>
    {!page && !error && <p role="status">Loading active events…</p>}
    {error && <p role="alert">{error}</p>}
    {page?.events.length === 0 && <p>No active events on this page.</p>}
    {page && <ul className="round-list" aria-label="Active events">{page.events.map((event) => <li className="panel" key={event.id}>
      <h2>{event.name}</h2><a href={eventTabHref(selection ?? 'overview', event.id)}>Open {event.name}</a>
    </li>)}</ul>}
    {page?.continuationToken && <button onClick={() => { setCursor(page.continuationToken); }}>Next page</button>}
  </section>;
}

function PublicRoundPage({ services, eventId, roundId, onUnavailable }: {
  readonly services: PublicServices; readonly eventId: string; readonly roundId: string;
  readonly onUnavailable: (message: string) => void;
}) {
  const [workspace, setWorkspace] = useState<EventWorkspace>();
  const [error, setError] = useState('');
  const [storageNotice, setStorageNotice] = useState('');
  const initial = useMemo(() => {
    const explicit = readScoreLocation(window.location.hash);
    if (explicit?.eventId === eventId && explicit.roundId === roundId) return { location: explicit };
    const saved = loadScoreLocation();
    return { location: saved.location?.eventId === eventId && saved.location.roundId === roundId ? saved.location : null,
      error: saved.error };
  }, [eventId, roundId]);
  useEffect(() => {
    const controller = new AbortController();
    void services.setup.load(eventId, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      if (!value.rounds.some((round) => round.id === roundId)) {
        onUnavailable('This round is no longer available. Choose an active round.'); return;
      }
      setWorkspace(value);
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      if (failure instanceof SessionExpiredError) onUnavailable(failure.message);
      else setError(failure instanceof Error ? failure.message : 'Could not load this round. Try again when connected.');
    });
    return () => { controller.abort(); };
  }, [services, eventId, roundId, onUnavailable]);
  const remember = useCallback((location: ScoreLocation) => {
    const saved = { version: 1 as const, eventId, roundId, ...location };
    const notice = saveScoreLocation(saved);
    setStorageNotice(notice ?? '');
    window.history.replaceState(null, '', `${window.location.pathname}${scoreLocationHref(saved)}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, [eventId, roundId]);
  const selected = workspace?.rounds.find((round) => round.id === roundId);
  const defaultLocation: ScoreLocation | undefined = selected?.groups[0] && selected.teeProfile.holes[0]
    ? { groupNumber: selected.groups[0].number, holeNumber: groupStartingHole(selected.groups[0], selected.teeProfile.holes) ?? selected.teeProfile.holes[0].number, view: 'entry' } : undefined;
  return <section>
    {(storageNotice || initial.error) && <p role="status">{storageNotice || initial.error}</p>}
    {error && <p role="alert">{error}</p>}
    {!workspace && !error && <p role="status">Loading saved round…</p>}
    {workspace && <>
      <OwnerScoresView client={services.scores} eventId={eventId} roundId={roundId}
        roundTools={<>
          <p className="score-hint">Save &amp; Next Hole and wait for Saved before closing the app. Reopening restores your place and loads fresh scores. An internet connection is required.</p>
          <label>Saved round<select value={roundId} onChange={(event) => {
            window.location.hash = `#events?event=${eventId}&round=${event.target.value}`;
          }}>{workspace.rounds.map((round) => <option key={round.id} value={round.id}>{round.name}</option>)}</select></label>
        </>}
        initialLocation={initial.location ?? defaultLocation} onLocationChange={remember} onSessionExpired={onUnavailable} />
    </>}
  </section>;
}
