import { useState } from 'react';
import type { EventSkinsPlayer } from '../../domain/event-skins';
import type { EventSkinsDisplay } from '../../domain/public-leaderboard';
import { RoundAccent, roundToneFor } from '../round-theme';

export function EventSkinsPlayerCard({ player, rounds, results, tied }: {
  readonly player: EventSkinsPlayer;
  readonly rounds: EventSkinsDisplay['workspace']['rounds'];
  readonly results: NonNullable<EventSkinsDisplay['eventSkins']>;
  readonly tied: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const known = results.status !== 'complete';
  const wins = results.holes.filter((hole) => hole.winnerId === player.playerId);
  const winningRounds = rounds.filter((round) => player.cells.some((cell) => cell.roundId === round.id && cell.skins > 0));
  const position = player.rank === null ? null : `${tied ? 'T' : ''}${String(player.rank)}`;
  return <article className="skins-player-ticket" aria-label={`Skins for ${player.displayName}`}>
    <header className="skins-ticket-heading">
      <div className="skins-position">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true" focusable="false">
          <path d="M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 2v5m-4 3h8" />
        </svg>
        {position !== null && <span aria-label={`Position ${position}`}>{position}</span>}
      </div>
      <div className="skins-golfer"><h2>{player.displayName}</h2>
        {winningRounds.length > 0 && <p>{winningRounds.length} winning {winningRounds.length === 1 ? 'round' : 'rounds'}</p>}
      </div>
      <p className="skins-ticket-total"><strong>{player.skins}</strong>{' '}
        <small>{known && 'known '}{player.skins === 1 ? 'skin' : 'skins'}</small>
      </p>
    </header>
    {results.status === 'unavailable' && <p className="skins-ticket-note">Complete total unavailable</p>}
    {known && player.skins === 0 && results.status !== 'unavailable' && <p className="skins-ticket-note">Awaiting remaining holes</p>}
    {player.skins > 0 && <details className="skins-ticket-details" onToggle={(event) => { setExpanded(event.currentTarget.open); }}>
      <summary aria-label={`${expanded ? 'Hide' : 'View'} winning holes for ${player.displayName} (${String(player.skins)})`}>
        <span>{expanded ? 'Hide winning holes' : 'View winning holes'} <span className="skins-win-count">({player.skins})</span></span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" /></svg>
      </summary>
      <dl className="skins-round-wins">{winningRounds.map((round) => <RoundAccent key={round.id} className="skins-winning-round" tone={roundToneFor(round.id, rounds)}>
        <dt>{round.name}</dt>
        <dd><ul className="skins-hole-chips" aria-label={`Won holes at ${round.name}`}>{wins.filter((hole) => hole.roundId === round.id)
          .sort((left, right) => left.number - right.number).map((hole) => <li key={hole.number}>Hole {hole.number}</li>)}</ul></dd>
      </RoundAccent>)}</dl>
    </details>}
  </article>;
}
