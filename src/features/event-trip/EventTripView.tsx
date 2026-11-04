import type { EventWorkspace, RoundSnapshot } from '../../domain/setup';
import './event-trip.css';

interface EventTripViewProps {
  readonly workspace: EventWorkspace;
  readonly view: 'overview' | 'rounds' | 'group';
}

function setupLink(eventId: string) {
  return `#events?event=${encodeURIComponent(eventId)}`;
}

function ManualGroups({ round }: { readonly round: RoundSnapshot }) {
  const assigned = new Set(round.groups.flatMap((group) => group.playerIds));
  const unassigned = round.players.filter((player) => !assigned.has(player.playerId));

  return (
    <div className="event-trip-groups">
      <h4>Manual groups</h4>
      {round.groups.length === 0 ? <p>No manual groups saved for this round.</p> : (
        <ul className="event-trip-group-list">
          {round.groups.map((group) => (
            <li key={group.number}>
              <h5>Group {group.number}</h5>
              {group.playerIds.length === 0 ? <p>No players assigned.</p> : (
                <ul>
                  {group.playerIds.map((playerId) => (
                    <li key={playerId}>
                      {round.players.find((player) => player.playerId === playerId)?.displayName ?? 'Player unavailable'}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {round.players.length === 0 && <p>No players saved for this round.</p>}
      {unassigned.length > 0 && (
        <div>
          <h5>Not assigned to a group</h5>
          <ul>{unassigned.map((player) => <li key={player.playerId}>{player.displayName}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function SavedRounds({ workspace, showGroups }: {
  readonly workspace: EventWorkspace;
  readonly showGroups: boolean;
}) {
  return (
    <section className="event-trip-section" aria-label="Saved rounds">
      <h2>Saved rounds</h2>
      {workspace.rounds.length === 0 ? <p>No rounds saved for this event.</p> : (
        <ol className="event-trip-rounds">
          {workspace.rounds.map((round) => (
            <li className="panel event-trip-round" key={round.id}>
              <div className="event-trip-round-heading">
                <div>
                  <h3>{round.name}</h3>
                  <p>{round.course.name}</p>
                  <p><span>{round.teeProfile.name} tees</span> · {round.teeProfile.category}</p>
                </div>
                {workspace.event.role === 'owner' && (
                  <a
                    className="event-trip-scorecard"
                    href={`${setupLink(workspace.event.id)}&round=${encodeURIComponent(round.id)}`}
                    aria-label={`Open scorecard for ${round.name}`}
                  >Open scorecard <span aria-hidden="true">→</span></a>
                )}
              </div>
              {showGroups && (
                <>
                  <dl className="event-trip-tee">
                    <div><dt>Holes</dt><dd>{round.teeProfile.holeCount}</dd></div>
                    <div><dt>Yards</dt><dd>{round.teeProfile.totalYardage.toLocaleString('en-US')}</dd></div>
                    <div><dt>Par</dt><dd>{round.teeProfile.totalPar}</dd></div>
                  </dl>
                  <ManualGroups round={round} />
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function EventTripView({ workspace, view }: EventTripViewProps) {
  const { event } = workspace;
  const archived = event.status === 'archived';

  return (
    <div className="event-trip">
      <header className="panel event-trip-header">
        <p className="eyebrow">{view === 'overview' ? 'Your saved event' : event.name}</p>
        <h1>{view === 'overview' ? event.name : view === 'rounds' ? 'Rounds' : 'The Group'}</h1>
        <p className="event-trip-location">{workspace.location || 'No location saved.'}</p>
        {archived && <p className="event-trip-archive"><strong>Archived event · Read-only</strong></p>}
        {event.role === 'owner' && <nav className="event-trip-links" aria-label="Event setup">
            <a href={setupLink(event.id)}>{archived ? 'View event setup' : 'Configure event'}</a>
        </nav>}
      </header>
      {view === 'overview' && (
        <section className="event-trip-section" aria-label="Event at a glance">
          <dl className="event-trip-stats">
            <div><dt>Golfers on roster</dt><dd>{workspace.roster.length}</dd></div>
            <div><dt>Saved rounds</dt><dd>{workspace.rounds.length}</dd></div>
          </dl>
          {workspace.roster.length === 0 && <p>No golfers saved to this event roster.</p>}
        </section>
      )}
      {view === 'group' && (
        <section className="panel event-trip-section" aria-label="Event roster">
          <h2>Event roster</h2>
          <p>These are the golfers saved to this event, not a list of sign-in accounts or access permissions.</p>
          {workspace.roster.length === 0 ? <p>No golfers saved to this event roster.</p> : (
            <ul className="event-trip-roster">
              {workspace.roster.map((player) => <li key={player.playerId}>{player.displayName}</li>)}
            </ul>
          )}
        </section>
      )}
      <SavedRounds workspace={workspace} showGroups={view !== 'overview'} />
    </div>
  );
}
