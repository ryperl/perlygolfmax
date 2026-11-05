import type { EventLeaderboardView, EventStandingCell, EventStandingReason, EventStandingStatus } from '../../domain/event-leaderboard';
import './leaderboard.css';

const reasons: Readonly<Record<EventStandingReason, string>> = {
  'missing-handicap-index': 'Captured Handicap Index missing',
  'invalid-handicap-index': 'Captured Handicap Index invalid',
  'missing-tee-ratings': 'Captured tee ratings missing',
  'missing-stroke-index': 'Hole stroke allocation missing',
  'missing-score-data': 'Saved scores unavailable',
  'not-configured': 'Select a saved game for this round in setup',
  'missing-game': 'Selected game is missing',
  'missing-round': 'Round scores unavailable',
  'team-setup-required': 'Complete this game’s team setup',
  'invalid-stroke-score': 'No valid stroke total: correct pickup, X7 or DNF',
  'arithmetic-range': 'Total outside supported range',
  'round-context-mismatch': 'Saved scores do not match round inputs',
  'stale-round-binding': 'Review a removed round’s game selection in setup',
};
const statuses: Readonly<Record<EventStandingStatus, string>> = {
  complete: 'Complete', 'in-progress': 'In progress', 'awaiting-scores': 'Awaiting scores',
  'not-configured': 'Pending setup', unavailable: 'Unavailable',
};
function signed(value: number) { return value > 0 ? `+${String(value)}` : String(value); }
function Result({ cell, stroke }: { readonly cell: Omit<EventStandingCell, 'roundId'>; readonly stroke: boolean }) {
  const valid = cell.status === 'complete' || cell.status === 'in-progress';
  return <>
    <strong>{!valid ? cell.reason === 'invalid-stroke-score' ? 'NR' : '—'
      : stroke ? cell.relativeToPar === null ? '—' : signed(cell.relativeToPar)
        : cell.subtotal === null ? '—' : signed(cell.subtotal)}</strong>
    <small>{statuses[cell.status]} · {cell.holesScored}/{cell.totalHoles} holes</small>
    {valid && stroke && cell.subtotal !== null && <small>{cell.subtotal} strokes</small>}
    {cell.reason && <small>{reasons[cell.reason]}</small>}
  </>;
}

export function EventLeaderboard({ value }: { readonly value: EventLeaderboardView }) {
  const { workspace, standings } = value;
  const competition = workspace.overallCompetition;
  if (workspace.event.status === 'archived' && workspace.event.role !== 'owner') return <p role="alert">Archived results are available to the event owner only.</p>;
  if (!competition || standings.status === 'disabled') return <section>
    <h1>Overall leaderboard not enabled</h1>
    <p>Round leaderboards are unchanged. An overall competition has not been configured.</p>
    {workspace.event.role === 'owner' && <a href={`#events?event=${encodeURIComponent(workspace.event.id)}`}>Open event setup</a>}
  </section>;
  const stroke = competition.kind === 'stroke-play';
  return <section className="overall-leaderboard">
    <a href={`#overview?event=${encodeURIComponent(workspace.event.id)}`}>Back to event overview</a>
    <h1>{workspace.event.name} — Overall leaderboard</h1>
    <p>{stroke ? `${competition.basis === 'gross' ? 'Gross' : `Net (${String(competition.handicapAllowancePercent)}% allowance)`} stroke play · lowest relative-to-par leads`
      : `Stableford · highest points leads · ${competition.credit === 'team' ? 'full team points credited to each member' : 'individual components credited'}`}</p>
    <p>Saved server results only. {standings.status === 'complete' ? 'All configured holes have results; this is not event finalization.'
      : standings.status === 'unavailable' ? 'Some standings are unavailable or pending setup. Available entries remain provisional; unresolved results are not ranked as zero.'
        : 'Provisional: progress differs. Pending and unavailable results are not ranked as zero.'}</p>
    {workspace.event.status === 'archived' && <p>Archived event — read-only results.</p>}
    {stroke && <p>Live relative-to-par uses completed numeric holes, not an incomplete raw stroke subtotal. Pickup, X7 or DNF is NR until corrected; blank holes remain pending.</p>}
    {standings.staleRoundIds.length > 0 && <p role="status">Review removed-round game selections in event setup.</p>}
    <div className="overall-table-scroll" role="region" aria-label="Overall results, scroll horizontally for every round" tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        event.currentTarget.scrollBy({ left: event.key === 'ArrowRight' ? 160 : -160 });
      }}>
      <table className="overall-table">
        <caption>Overall event standings · {standings.rounds.length} rounds · {stroke ? 'relative-to-par and stroke totals' : 'points'} with saved-hole progress</caption>
        <thead><tr><th scope="col">Player</th><th scope="col">Position</th>
          {standings.rounds.map((round) => <th scope="col" key={round.roundId}>{round.roundName}</th>)}
          <th scope="col">Cumulative result</th></tr></thead>
        <tbody>{standings.players.map((player) => <tr key={player.playerId}>
          <th scope="row">{player.displayName}</th><td>{player.rankLabel ?? 'Not ranked'}</td>
          {standings.rounds.map((round) => {
            const cell = player.cells.find((entry) => entry.roundId === round.roundId);
            return <td key={round.roundId}>{cell ? <Result cell={cell} stroke={stroke} /> : 'Round unavailable'}</td>;
          })}
          <td><Result cell={player} stroke={stroke} /></td>
        </tr>)}</tbody>
      </table>
    </div>
    {standings.players.length === 0 && <p>No participants in these saved standings.</p>}
  </section>;
}
