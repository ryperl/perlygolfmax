import { useState } from 'react';
import type { GamePlayerResult, GameTeamResult } from '../../domain/games';
import { gameResultDirection, gameResultTotal, gameResultUnit, isTeamGameDefinition, visibleGames } from '../../domain/games';
import { ChurchyResults } from '../churchy';
import type { RoundScores } from '../../domain/scoring';
import { scorePermissions } from '../../domain/scoring';
import { scorecardTee } from '../../domain/tees';
import { gameScoringLabel, gameUnavailableMessage } from '../games';
import { gameStandings } from './standings';
import './leaderboard.css';

function standingId(player: GamePlayerResult | GameTeamResult): string {
  return 'teamId' in player ? player.teamId : player.playerId;
}

function PlayerStanding({ player, position, tied = false, members, unit }: {
  readonly player: GamePlayerResult | GameTeamResult;
  readonly position?: number;
  readonly tied?: boolean;
  readonly members?: string | undefined;
  readonly unit: string;
}) {
  const points = position === undefined ? null : gameResultTotal(player);
  const detail = player.status === 'unavailable' ? gameUnavailableMessage(player.strokeGame?.unavailableReason ?? player.unavailableReason)
    : `${String(player.holesScored)}/${String(player.totalHoles)} holes · ${position === undefined ? 'Awaiting scores' : player.status === 'complete' ? 'Complete' : 'In progress'}`;
  return <li className="leaderboard-row">
    <span className="leaderboard-position" aria-label={position === undefined ? 'Unranked' : `${tied ? 'Tied position' : 'Position'} ${String(position)}`}>
      {position === undefined ? '—' : `${tied ? 'T' : ''}${String(position)}`}
    </span>
    <div className="leaderboard-player"><h4>{player.displayName}</h4>{members && <p>{members}</p>}<p>{detail}</p></div>
    <div className="leaderboard-points" aria-label={points === null ? `No ranked ${unit}` : `${String(points)} ${unit}`}>
      <strong>{points ?? '—'}</strong><small>{unit}</small>
    </div>
  </li>;
}

export function RoundLeaderboard({ round, busy, onManageGames }: {
  readonly round: RoundScores;
  readonly busy: boolean;
  readonly onManageGames: () => void;
}) {
  const [gameId, setGameId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const games = visibleGames(round.games?.configuration.games ?? [], round.churchyEnabled);
  const canManage = round.eventStatus === 'active' && scorePermissions(round).role === 'owner' && scorePermissions(round).canManageGames;
  const game = games.find((entry) => entry.id === gameId) ?? games[0];
  const result = game && round.games?.results.find((entry) => entry.gameId === game.id);
  const teamGame = game !== undefined && isTeamGameDefinition(game);
  const rows: readonly (GamePlayerResult | GameTeamResult)[] = (teamGame ? result?.teams : result?.players) ?? [];
  const standings = result && !result.teamSetupRequired && gameStandings(rows, gameResultDirection(game));
  const ranked = standings ? standings.ranked.filter((entry) => game.kind !== 'skins' || gameResultTotal(entry.player) !== 0) : [];
  const unit = game ? gameResultUnit(game) : 'points';
  function members(player: GamePlayerResult | GameTeamResult): string | undefined {
    function teeLabel(id: string) {
      const tee = scorecardTee(round, id);
      return `${tee?.name ?? round.teeName} / ${tee?.category ?? round.teeCategory}`;
    }
    return 'playerIds' in player ? player.playerIds.map((id) =>
      `${result?.players.find((member) => member.playerId === id)?.displayName ?? 'Golfer unavailable'}${(round.playerTees?.length ?? 0) > 0 ? ` (${teeLabel(id)})` : ''}`).join(' · ')
      : (round.playerTees?.length ?? 0) > 0 ? teeLabel(player.playerId) : undefined;
  }
  const ordered = standings ? [...ranked.map((entry) => entry.player), ...standings.awaiting, ...standings.unavailable] : [];
  const pageSize = 12;
  const matching = ordered.length <= pageSize ? ordered
    : ordered.filter((player) => `${player.displayName} ${members(player) ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const page = Math.min(pageIndex, Math.max(0, Math.ceil(matching.length / pageSize) - 1));
  const visible = new Set(matching.slice(page * pageSize, (page + 1) * pageSize).map(standingId));
  if (round.eventStatus === 'archived' && scorePermissions(round).role !== 'owner') return <p role="alert">Archived results are available to the event owner only.</p>;
  return <section className="round-leaderboard" aria-label="Round leaderboard">
    <header className="leaderboard-heading">
      <p>{round.eventName}</p><h2>Leaderboard · {round.roundName}</h2>
      <p>{round.courseName} · {(round.playerTees?.length ?? 0) > 0 ? 'Default tee: ' : ''}{round.teeName} / {round.teeCategory}
        {(round.playerTees?.length ?? 0) > 0 && ' · Personal tees assigned'}</p>
    </header>
    {!game ? <>
      <p>{round.eventStatus === 'archived' ? 'No games configured for this archived round.'
        : canManage ? 'No games configured for this round. Add a Stableford game to see its leaderboard.' : 'No games configured for this round.'}</p>
      {(canManage || round.eventStatus === 'archived' && scorePermissions(round).role === 'owner') && <button type="button" disabled={busy} onClick={onManageGames}>
        {round.eventStatus === 'archived' ? 'View games' : 'Configure a game'}
      </button>}
    </> : <>
      <label className="leaderboard-game">Leaderboard game<select value={game.id} disabled={busy} onChange={(event) => { setGameId(event.target.value); }}>
        {games.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {gameScoringLabel(entry)}</option>)}
      </select></label>
      <p className="leaderboard-format">{gameScoringLabel(game)}</p>
      {game.kind === 'churchy' ? <ChurchyResults game={game} result={result} /> : teamGame && result?.teamSetupRequired ? <>
        <p>Update team assignments. Team standings are unavailable until the teams match this round&apos;s golfers.</p>
        {canManage && <button type="button" disabled={busy} onClick={onManageGames}>Update team assignments</button>}
      </> : !result || !standings || rows.length === 0 ? <p>Leaderboard results are unavailable. Refresh the saved round to retry.</p> : <>
        <p className="leaderboard-qualifier">{standings.provisional
          ? `Provisional standings · ${unit === 'points' ? 'Points earned so far.' : 'Saved results so far; no winner declared.'} ${teamGame ? 'Teams' : 'Golfers'} may have played different numbers of holes.`
          : `Saved ${unit} · All game cards complete. This is not round finalization.`}</p>
        {ordered.length > pageSize && <div className="leaderboard-controls">
          <label>Find leaderboard golfers or teams<input type="search" value={query} onChange={(event) => {
            setQuery(event.target.value); setPageIndex(0);
          }} /></label>
          <p>{matching.length} of {ordered.length} entries · Positions reflect all saved results.</p>
          <nav aria-label="Leaderboard pages">
            <button type="button" disabled={page === 0} onClick={() => { setPageIndex(page - 1); }}>Previous standings</button>
            <span>Page {page + 1} of {Math.max(1, Math.ceil(matching.length / pageSize))}</span>
            <button type="button" disabled={(page + 1) * pageSize >= matching.length} onClick={() => { setPageIndex(page + 1); }}>Next standings</button>
          </nav>
          {matching.length === 0 && <p>No leaderboard entries match your search.</p>}
        </div>}
        {ranked.length === 0 ? <p>{game.kind === 'skins' && standings.ranked.length > 0 ? 'No skins awarded yet.' : 'No ranked scores yet.'}</p> :
          <section><h3>{teamGame ? 'Team standings' : 'Standings'}</h3><ol className="leaderboard-list" role="list" aria-label="Standings">
            {ranked.filter((entry) => visible.has(standingId(entry.player))).map((entry) => <PlayerStanding key={standingId(entry.player)} player={entry.player} unit={unit} members={members(entry.player)} position={entry.position} tied={entry.tied} />)}
          </ol></section>}
        {standings.awaiting.length > 0 && <section aria-label="Awaiting scores">
          <h3>Awaiting scores</h3><ul className="leaderboard-list" role="list">
            {standings.awaiting.filter((player) => visible.has(standingId(player))).map((player) => <PlayerStanding key={standingId(player)} player={player} unit={unit} members={members(player)} />)}
          </ul>
        </section>}
        {standings.unavailable.length > 0 && <section aria-label="Unavailable results">
          <h3>Unavailable results</h3><ul className="leaderboard-list" role="list">
            {standings.unavailable.filter((player) => visible.has(standingId(player))).map((player) => <PlayerStanding key={standingId(player)} player={player} unit={unit} members={members(player)} />)}
          </ul>
        </section>}
        <p className="leaderboard-hint">{game.kind === 'skins' ? 'Golfers with awarded skins. Pending or unavailable results shown separately.'
          : `All ${teamGame ? 'teams' : 'golfers'} in this round.`} Ties share a position; no tie-break is applied. Saved scores only.</p>
      </>}
    </>}
  </section>;
}
