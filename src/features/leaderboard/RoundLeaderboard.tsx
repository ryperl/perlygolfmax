import { useState } from 'react';
import type { GamePlayerResult } from '../../domain/games';
import type { RoundScores } from '../../domain/scoring';
import { gameScoringLabel, gameUnavailableMessage } from '../games';
import { gameStandings } from './standings';
import './leaderboard.css';

function PlayerStanding({ player, position, tied = false }: {
  readonly player: GamePlayerResult;
  readonly position?: number;
  readonly tied?: boolean;
}) {
  const points = position === undefined ? null : player.totalPoints;
  const detail = player.status === 'unavailable' ? gameUnavailableMessage(player.unavailableReason)
    : `${String(player.holesScored)}/${String(player.totalHoles)} holes · ${position === undefined ? 'Awaiting scores' : player.status === 'complete' ? 'Complete' : 'In progress'}`;
  return <li className="leaderboard-row">
    <span className="leaderboard-position" aria-label={position === undefined ? 'Unranked' : `${tied ? 'Tied position' : 'Position'} ${String(position)}`}>
      {position === undefined ? '—' : `${tied ? 'T' : ''}${String(position)}`}
    </span>
    <div className="leaderboard-player"><h4>{player.displayName}</h4><p>{detail}</p></div>
    <div className="leaderboard-points" aria-label={points === null ? 'No ranked points' : `${String(points)} points`}>
      <strong>{points ?? '—'}</strong><small>points</small>
    </div>
  </li>;
}

export function RoundLeaderboard({ round, busy, onManageGames }: {
  readonly round: RoundScores;
  readonly busy: boolean;
  readonly onManageGames: () => void;
}) {
  const [gameId, setGameId] = useState<string | null>(null);
  const games = round.games?.configuration.games ?? [];
  const game = games.find((entry) => entry.id === gameId) ?? games[0];
  const result = game && round.games?.results.find((entry) => entry.gameId === game.id);
  const standings = result && gameStandings(result.players);
  return <section className="round-leaderboard" aria-label="Round leaderboard">
    <header className="leaderboard-heading">
      <p>{round.eventName}</p><h2>Leaderboard · {round.roundName}</h2>
      <p>{round.courseName} · {round.teeName} / {round.teeCategory}</p>
    </header>
    {!game ? <>
      <p>{round.eventStatus === 'archived' ? 'No games configured for this archived round.'
        : 'No games configured for this round. Add an individual Stableford game to see its leaderboard.'}</p>
      <button type="button" disabled={busy} onClick={onManageGames}>
        {round.eventStatus === 'archived' ? 'View games' : 'Configure a game'}
      </button>
    </> : <>
      <label className="leaderboard-game">Leaderboard game<select value={game.id} disabled={busy} onChange={(event) => { setGameId(event.target.value); }}>
        {games.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.basis === 'gross' ? 'Gross' : `Net ${String(entry.handicapAllowancePercent)}%`}</option>)}
      </select></label>
      <p className="leaderboard-format">{gameScoringLabel(game)} · {game.basis === 'gross' ? 'Gross' : `Net · ${String(game.handicapAllowancePercent)}% allowance`}</p>
      {!result || !standings || result.players.length === 0 ? <p>Leaderboard results are unavailable. Refresh the saved round to retry.</p> : <>
        <p className="leaderboard-qualifier">{standings.provisional
          ? 'Provisional standings · Points earned so far. Golfers may have played different numbers of holes.'
          : 'Saved points · All game cards complete. This is not round finalization.'}</p>
        {standings.ranked.length === 0 ? <p>No ranked scores yet.</p> :
          <section><h3>Standings</h3><ol className="leaderboard-list" role="list" aria-label="Standings">
            {standings.ranked.map((entry) => <PlayerStanding key={entry.player.playerId} player={entry.player} position={entry.position} tied={entry.tied} />)}
          </ol></section>}
        {standings.awaiting.length > 0 && <section aria-label="Awaiting scores">
          <h3>Awaiting scores</h3><ul className="leaderboard-list" role="list">
            {standings.awaiting.map((player) => <PlayerStanding key={player.playerId} player={player} />)}
          </ul>
        </section>}
        {standings.unavailable.length > 0 && <section aria-label="Unavailable results">
          <h3>Unavailable results</h3><ul className="leaderboard-list" role="list">
            {standings.unavailable.map((player) => <PlayerStanding key={player.playerId} player={player} />)}
          </ul>
        </section>}
        <p className="leaderboard-hint">All golfers in this round. Ties share a position; no tie-break is applied. Saved scores only.</p>
      </>}
    </>}
  </section>;
}
