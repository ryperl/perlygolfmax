import { useEffect, useRef, useSyncExternalStore } from 'react';
import { demoTrip } from '../demo/trip';
import { GroupView, RoundsView, TripOverview } from '../features/trip';
import { navigation, readPage } from './navigation';

function subscribeToNavigation(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => { window.removeEventListener('hashchange', onChange); };
}

function getPage() {
  return readPage(window.location.hash);
}

export function App() {
  const page = useSyncExternalStore(subscribeToNavigation, getPage);
  const mainRef = useRef<HTMLElement>(null);
  const previousPage = useRef(page);

  useEffect(() => {
    const label = navigation.find((item) => item.id === page)?.label ?? 'Overview';
    document.title = `${label} | Perly Golf Max`;
    if (previousPage.current !== page) {
      mainRef.current?.focus();
      previousPage.current = page;
    }
  }, [page]);

  return (
    <div className="app">
      <a className="skip-link" href="#main-content" onClick={(event) => {
        event.preventDefault();
        mainRef.current?.focus();
      }}>Skip to content</a>
      <header className="site-header">
        <a className="brand" href="#overview" aria-label="Perly Golf Max home">
          <span className="brand-mark" aria-hidden="true">P<span>↗</span></span>
          <span>PERLY <span className="brand-secondary">GOLF MAX</span></span>
        </a>
        <span className="edition">The trip companion</span>
      </header>
      <div className="demo-banner"><span className="demo-dot" aria-hidden="true" /><strong>Demo clubhouse</strong><span>Fictional data. Nothing here is saved or synced.</span></div>
      <nav className="navigation" aria-label="Main navigation">
        {navigation.map((item) => (
          <a href={`#${item.id}`} key={item.id} aria-current={page === item.id ? 'page' : undefined}>{item.label}</a>
        ))}
        <span className="navigation-note">12 golfers / 5 rounds</span>
      </nav>
      <main id="main-content" ref={mainRef} tabIndex={-1}>
        {page === 'overview' && <TripOverview trip={demoTrip} />}
        {page === 'rounds' && <RoundsView rounds={demoTrip.rounds} />}
        {page === 'group' && <GroupView golfers={demoTrip.golfers} />}
      </main>
      <footer className="site-footer"><span>PERLY GOLF MAX</span><p>Built for the trip. Still finding its swing.</p><span>Foundation preview</span></footer>
    </div>
  );
}
