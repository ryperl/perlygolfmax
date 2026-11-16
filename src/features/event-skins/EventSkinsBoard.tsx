import type { EventSkinsDisplay } from '../../domain/public-leaderboard';
import type { Ref } from 'react';
import './event-skins.css';

export function EventSkinsBoard({ value, onDetails, detailsTrigger }: {
  readonly value: EventSkinsDisplay; readonly onDetails?: () => void; readonly detailsTrigger?: Ref<HTMLButtonElement>;
}) {
  const { workspace, eventSkins: results } = value;
  if (workspace.eventSkinsSupported !== true) return <p>Event-wide skins is not supported by this API.</p>;
  if (!workspace.eventSkins) return <section><h1>Event-wide skins</h1><p>Event skins is not configured.</p>
    <p>The organizer can enable this independent competition without changing round games or the primary overall competition.</p></section>;
  if (!results) return <p role="alert">Event skins results are unavailable. Refresh to retry.</p>;
  const visible = results.players.filter((player) => player.skins > 0 || results.status !== 'complete');
  return <section className="event-skins-board">
    <h1>{workspace.event.name} · Event-wide skins</h1>
    <details><summary>Skins rules</summary><p>Net strokes first, using 100% captured Course Handicap and each golfer’s tee.
      Only when net ties, actual gross birdie or better has priority, then the lower qualifying gross score.
      Gross par ties stay tied. No carryovers; every hole competes only within its round.</p></details>
    <p role="status">{results.status === 'complete' ? 'All hole outcomes known'
      : results.status === 'unavailable' ? 'Unavailable inputs — known wins retained, totals not complete' : 'Provisional standings'}
      {` · ${String(results.awardedSkins)} skins awarded · ${String(results.totalHoles - results.pendingHoles - results.unavailableHoles)}/${String(results.totalHoles)} holes decided`}
      {` · ${String(results.pendingHoles)} pending · ${String(results.unavailableHoles)} unavailable`}</p>
    {visible.length === 0 && <p>No skins won. Any configured pot stays unallocated; no automatic redistribution.</p>}
    <ol className="event-skins-players" aria-label="Event skins standings">{visible.map((player) => <li key={player.playerId}>
      <h2>{player.rank === null ? '' : `${results.players.filter((entry) => entry.rank === player.rank).length > 1 ? 'T' : ''}${String(player.rank)}. `}{player.displayName}</h2>
      <p>{player.skins} {results.status !== 'complete' && 'known '}{player.skins === 1 ? 'skin' : 'skins'}
        {results.status === 'unavailable' && ' · complete total unavailable'}</p>
      <dl>{player.cells.filter((cell) => cell.skins > 0).map((cell) => <div key={cell.roundId}>
        <dt>{workspace.rounds.find((round) => round.id === cell.roundId)?.name}</dt>
        <dd>{results.holes.filter((hole) => hole.roundId === cell.roundId && hole.winnerId === player.playerId)
          .map((hole) => `Hole ${String(hole.number)}`).join(' · ')}</dd>
      </div>)}</dl>
    </li>)}</ol>
    <div><button ref={detailsTrigger} type="button" disabled={!onDetails} onClick={onDetails}>View skins details</button></div>
    {workspace.purseConfigured && <a href={`#purse?event=${encodeURIComponent(workspace.event.id)}`}>View planned purse and winnings</a>}
  </section>;
}
