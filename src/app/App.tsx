import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { demoTrip } from '../demo/trip';
import { GroupView, RoundsView, TripOverview } from '../features/trip';
import { eventTabHref, isOrganizerRoute, navigation, readEventRoute, readPage, readPreviewTab, readSelectedEvent } from './navigation';
import type { PublicServices } from '../client/public-events';
import { isUuid } from '../contracts/events';
import { loadScoreLocation, scoreLocationHref } from './score-resume';
const EventsPage = lazy(async () => {
  const module = await import('./EventsPage');
  return { default: module.ConfiguredEventsPage };
});
const PublicEventsPage = lazy(async () => ({ default: (await import('./PublicEventsPage')).PublicEventsPage }));

function subscribeToNavigation(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => { window.removeEventListener('hashchange', onChange); };
}

function getHash() { return window.location.hash; }

function legacyPublicRoute(hash: string): string | null {
  const page = hash.slice(1).split('?')[0];
  if (page !== 'tester' && page !== 'join') return null;
  const values = new URLSearchParams(hash.split('?')[1] ?? '').getAll('event');
  return values.length === 1 && isUuid(values[0]) ? `#overview?event=${values[0]}` : '#events?choose=1';
}

function initialNavigation() {
  const saved = loadScoreLocation();
  const legacy = legacyPublicRoute(getHash());
  if (legacy) {
    const eventId = readSelectedEvent(legacy);
    const destination = saved.location?.eventId === eventId ? scoreLocationHref(saved.location) : legacy;
    window.history.replaceState(null, '', `${window.location.pathname}${destination}`);
  } else if ((!getHash() || getHash() === '#' || getHash() === '#events')
    && !isOrganizerRoute(getHash(), window.location.search) && saved.location) {
    window.history.replaceState(null, '', `${window.location.pathname}${scoreLocationHref(saved.location)}`);
  }
  return { eventId: readSelectedEvent(getHash()), error: saved.error };
}

export function App({ publicServices }: { readonly publicServices?: PublicServices | undefined } = {}) {
  const [initial] = useState(initialNavigation);
  const [selectedEvent, setSelectedEvent] = useState(initial.eventId);
  const subscribe = useCallback((onChange: () => void) => subscribeToNavigation(() => {
    const eventId = readSelectedEvent(getHash());
    if (eventId) setSelectedEvent(eventId);
    onChange();
  }), []);
  const hash = useSyncExternalStore(subscribe, getHash);
  const page = readPage(hash, window.location.search);
  const organizer = isOrganizerRoute(hash, window.location.search);
  const activePage = readEventRoute(hash).startsWith('score:') ? 'rounds' : page === 'organizer' ? 'events' : page;
  const routeIdentity = `${page}:${readEventRoute(hash)}`;
  const eventInRoute = readSelectedEvent(hash);
  const activeEvent = eventInRoute ?? selectedEvent;
  const previewTab = readPreviewTab(hash);
  const mainRef = useRef<HTMLElement>(null);
  const previousPage = useRef(routeIdentity);
  const [accountHost, setAccountHost] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const destination = legacyPublicRoute(hash);
    if (!destination) return;
    window.history.replaceState(null, '', `${window.location.pathname}${destination}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, [hash]);
  useEffect(() => {
    const label = page === 'organizer' ? 'Organizer tools' : activePage === 'preview' ? 'Preview' : activePage === 'leaderboard' ? 'Overall leaderboard'
      : activePage === 'purse' ? 'Purse and winnings' : activePage === 'access' ? 'Player access'
        : activePage === 'join' ? 'Join event' : activePage === 'tester' ? 'Tester score entry'
          : navigation.find((item) => item.id === activePage)?.label ?? 'Events';
    document.title = `${label} | Perly Golf Max`;
    if (previousPage.current !== routeIdentity) {
      mainRef.current?.focus();
      previousPage.current = routeIdentity;
    }
  }, [hash, activePage, page, routeIdentity]);
  const clearSelection = useCallback(() => {
    setSelectedEvent(null);
    window.location.hash = '#events?choose=1';
  }, []);

  return (
    <div className="app">
      <a className="skip-link" href="#main-content" onClick={(event) => {
        event.preventDefault();
        mainRef.current?.focus();
      }}>Skip to content</a>
      <header className="site-header" aria-label="Site header">
        <a className="brand" href="#events?choose=1" aria-label="Perly Golf Max home">
          <span className="brand-mark" aria-hidden="true">P<span>↗</span></span>
          <span>PERLY <span className="brand-secondary">GOLF MAX</span></span>
        </a>
        <div className="header-account" ref={setAccountHost}>
          <span className="edition">The trip companion</span>
          <a href={organizer ? '#events?choose=1' : '#organizer'}>{organizer ? 'Public scoreboard' : 'Organizer tools'}</a>
        </div>
      </header>
      {page === 'preview' && <div className="demo-banner"><span className="demo-dot" aria-hidden="true" /><strong>Demo clubhouse</strong><span>Fictional data. Nothing here is saved or synced.</span></div>}
      {page !== 'tester' && <nav className="navigation" aria-label="Main navigation">
        {navigation.map((item) => (
          <a href={item.id === 'events' ? '#events?choose=1' : eventTabHref(item.id, activeEvent)} key={item.id} aria-current={activePage === item.id ? 'page' : undefined}>{item.label}</a>
        ))}
      </nav>}
      <main id="main-content" ref={mainRef} tabIndex={-1}>
        {initial.error && <p role="status">{initial.error}</p>}
        <Suspense fallback={page === 'preview' ? null : <p role="status">Loading event screen...</p>}>
          {organizer ? <EventsPage onSignedOut={clearSelection} accountHost={accountHost} />
            : page !== 'preview' ? <PublicEventsPage services={publicServices} /> : null}
        </Suspense>
        {page === 'preview' && <>
          <nav className="event-actions" aria-label="Fictional preview">
            <a href="#preview" aria-current={previewTab === 'overview' ? 'page' : undefined}>Demo overview</a>
            <a href="#preview?view=rounds" aria-current={previewTab === 'rounds' ? 'page' : undefined}>Demo rounds</a>
            <a href="#preview?view=group" aria-current={previewTab === 'group' ? 'page' : undefined}>Demo group</a>
          </nav>
          {previewTab === 'overview' && <TripOverview trip={demoTrip} />}
          {previewTab === 'rounds' && <RoundsView rounds={demoTrip.rounds} />}
          {previewTab === 'group' && <GroupView golfers={demoTrip.golfers} />}
        </>}
      </main>
      <footer className="site-footer"><span>PERLY GOLF MAX</span><p>Built for the trip. Still finding its swing.</p><a href="#preview">Preview</a></footer>
    </div>
  );
}
