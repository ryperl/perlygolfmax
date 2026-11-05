import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { demoTrip } from '../demo/trip';
import { GroupView, RoundsView, TripOverview } from '../features/trip';
import { eventTabHref, navigation, readEventRoute, readPage, readPreviewTab, readSelectedEvent } from './navigation';
const EventsPage = lazy(async () => {
  const module = await import('./EventsPage');
  return { default: module.ConfiguredEventsPage };
});

function subscribeToNavigation(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => { window.removeEventListener('hashchange', onChange); };
}

function getHash() { return window.location.hash; }

export function App() {
  const [selectedEvent, setSelectedEvent] = useState(() => readSelectedEvent(getHash()));
  const subscribe = useCallback((onChange: () => void) => subscribeToNavigation(() => {
    const eventId = readSelectedEvent(getHash());
    if (eventId) setSelectedEvent(eventId);
    onChange();
  }), []);
  const hash = useSyncExternalStore(subscribe, getHash);
  const page = readPage(hash, window.location.search);
  const activePage = readEventRoute(hash).startsWith('score:') ? 'rounds' : page;
  const eventInRoute = readSelectedEvent(hash);
  const activeEvent = eventInRoute ?? selectedEvent;
  const previewTab = readPreviewTab(hash);
  const mainRef = useRef<HTMLElement>(null);
  const previousPage = useRef(hash);
  const [accountHost, setAccountHost] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const label = activePage === 'preview' ? 'Preview' : activePage === 'leaderboard' ? 'Overall leaderboard'
      : activePage === 'purse' ? 'Purse and winnings' : activePage === 'access' ? 'Player access'
        : activePage === 'join' ? 'Join event' : activePage === 'tester' ? 'Tester score entry'
          : navigation.find((item) => item.id === activePage)?.label ?? 'Events';
    document.title = `${label} | Perly Golf Max`;
    if (previousPage.current !== hash) {
      mainRef.current?.focus();
      previousPage.current = hash;
    }
  }, [hash, activePage]);
  const clearSelection = useCallback(() => {
    setSelectedEvent(null);
    window.location.hash = '#events';
  }, []);

  return (
    <div className="app">
      <a className="skip-link" href="#main-content" onClick={(event) => {
        event.preventDefault();
        mainRef.current?.focus();
      }}>Skip to content</a>
      <header className="site-header" aria-label="Site header">
        <a className="brand" href="#events" aria-label="Perly Golf Max home">
          <span className="brand-mark" aria-hidden="true">P<span>↗</span></span>
          <span>PERLY <span className="brand-secondary">GOLF MAX</span></span>
        </a>
        <div className="header-account" ref={setAccountHost}>
          <span className="edition">The trip companion</span>
        </div>
      </header>
      {page === 'preview' && <div className="demo-banner"><span className="demo-dot" aria-hidden="true" /><strong>Demo clubhouse</strong><span>Fictional data. Nothing here is saved or synced.</span></div>}
      {page !== 'tester' && <nav className="navigation" aria-label="Main navigation">
        {navigation.map((item) => (
          <a href={item.id === 'events' ? '#events' : eventTabHref(item.id, activeEvent)} key={item.id} aria-current={activePage === item.id ? 'page' : undefined}>{item.label}</a>
        ))}
      </nav>}
      <main id="main-content" ref={mainRef} tabIndex={-1}>
        {/* Keep account state mounted on Preview without loading private event data. */}
        <Suspense fallback={page === 'preview' ? null : <p role="status">Loading event screen...</p>}>
          <EventsPage onSignedOut={clearSelection} accountHost={accountHost} preview={page === 'preview'} />
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
