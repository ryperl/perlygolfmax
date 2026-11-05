import type { EventCapabilities, EventPage, EventStatus, EventSummary } from '../../domain/events';

export type EventsState =
  | { readonly kind: 'unconfigured'; readonly message: string }
  | { readonly kind: 'signed-out'; readonly message?: string }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly page: EventPage; readonly capabilities: EventCapabilities };

interface EventsViewProps {
  readonly state: EventsState;
  readonly busy: boolean;
  readonly notice: string;
  readonly view: EventStatus;
  readonly onReload: () => void;
  readonly onNextPage: () => void;
  readonly onCreate: (name: string) => Promise<boolean>;
  readonly onViewChange: (status: EventStatus) => void;
  readonly onStatusChange: (event: EventSummary, status: EventStatus) => void;
}

export function EventsView({ state, busy, notice, view, onReload, onNextPage, onCreate, onViewChange, onStatusChange }: EventsViewProps) {
  return <section>
    <p className="eyebrow">Your private clubhouse</p>
    <h1>Events</h1>
    <p className="page-description">Admitted players can view all active events. Score entry is limited to their assigned playing group; organizer settings stay protected. The fictional preview is separate.</p>
    {state.kind === 'unconfigured' && <div className="panel"><h2>Event services are not configured</h2><p>{state.message}</p><p>No sign-in or saved-event connection is active. Fictional content is available separately under Preview.</p></div>}
    {state.kind === 'signed-out' && <div className="panel"><h2>Sign in with an email code</h2><p>Use Sign in above. No Microsoft account is needed. Signing in does not grant event access.</p>{state.message && <p role="status">{state.message}</p>}</div>}
    {state.kind === 'loading' && <p role="status">Loading your events...</p>}
    {state.kind === 'error' && <div className="panel"><p role="alert">{state.message}</p><button disabled={busy} onClick={onReload}>Try again</button></div>}
    {state.kind === 'ready' && <>
      <div className="event-actions"><button disabled={busy} onClick={onReload}>Refresh events</button></div>
      {state.capabilities.canManageCatalog && <nav className="event-actions" aria-label="Catalog navigation"><a href="#events?catalog=courses">Course catalog</a><a href="#events?catalog=players">Player catalog</a></nav>}
      <div className="event-actions" role="group" aria-label="Event lists">
        <button disabled={busy} aria-pressed={view === 'active'} onClick={() => { onViewChange('active'); }}>Active events</button>
        <button disabled={busy} aria-pressed={view === 'archived'} onClick={() => { onViewChange('archived'); }}>Archived events</button>
      </div>
      {view === 'archived' && <p>Archived events are visible only to their owners. Their data is preserved and can be restored.</p>}
      {state.page.events.length === 0 ? <p>{view === 'archived' ? 'No archived events you own on this page.' : 'No events on this page. Signing in alone does not add you to an event.'}</p>
        : <ul className="round-list" aria-label="Your events">{state.page.events.map((event) => <li className="panel" key={event.id}>
          <h2>{event.name}</h2><p>{event.role === 'owner' ? 'Event owner' : event.role === 'viewer' ? 'Read-only viewer' : 'Event member'} / Private</p>
          <div className="event-card-actions" role="group" aria-label={`Actions for ${event.name}`}>
            <a href={`#overview?event=${encodeURIComponent(event.id)}`}>Open {event.name}</a>
            {event.role === 'owner' && <button disabled={busy} onClick={() => {
              onStatusChange(event, event.status === 'active' ? 'archived' : 'active');
            }} aria-label={`${event.status === 'active' ? 'Archive' : 'Restore'} ${event.name}`}>{event.status === 'active' ? 'Archive event' : 'Restore event'}</button>}
          </div>
        </li>)}</ul>}
      {state.page.continuationToken && <button disabled={busy} onClick={onNextPage}>Next page</button>}
      {view === 'active' && state.capabilities.canCreateEvents && <form className="panel event-form" onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const value = new FormData(form).get('name');
        if (typeof value === 'string') {
          void onCreate(value).then((saved) => { if (saved) form.reset(); });
        }
      }}>
        <h2>Create an event</h2>
        <label htmlFor="event-name">Event name</label>
        <input id="event-name" name="name" required maxLength={100} disabled={busy} />
        <button disabled={busy} type="submit">Create event</button>
      </form>}
      <p className="boundary-note">Open an event to see its Overview, Rounds and The Group. Approved players can score their assigned playing group. Setup and management require ownership; signing in alone does not grant admission or catalog permissions.</p>
    </>}
    <p role="status">{busy ? 'Working...' : notice}</p>
  </section>;
}
