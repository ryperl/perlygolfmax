import { useRef, useState } from 'react';
import type { GamePlayerResult, GameTeamResult, RoundGameDefinition, RoundGameResult } from '../../domain/games';
import { gameResultTotal, gameResultUnit, isTeamGameDefinition } from '../../domain/games';
import { gameScoringLabel, gameUnavailableMessage } from './game-presentation';

function progress(player: GamePlayerResult | GameTeamResult): string {
  return player.status === 'unavailable'
    ? 'Unavailable'
    : player.status === 'complete' ? 'Complete'
      : `${String(player.holesScored)}/${String(player.totalHoles)} holes · In progress`;
}

function handicap(value: number): string {
  return value < 0 ? `+${String(Math.abs(value))}` : String(value);
}

export function GameResults({ game, result, holeNumbers }: {
  readonly game: RoundGameDefinition;
  readonly result: RoundGameResult | undefined;
  readonly holeNumbers: readonly number[];
}) {
  const [nine, setNine] = useState<'front' | 'back'>('front');
  const [query, setQuery] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const scroll = useRef<HTMLDivElement | null>(null);
  const layout = [...holeNumbers].sort((left, right) => left - right);
  const front = layout.filter((number) => number <= 9);
  const back = layout.filter((number) => number > 9);
  const showBack = front.length === 0 || nine === 'back' && back.length > 0;
  const visible = showBack ? back : front;
  const label = showBack ? 'Back nine' : 'Front nine';
  const unavailable = new Map<string, string[]>();
  const teamGame = isTeamGameDefinition(game);
  const unit = gameResultUnit(game);
  const rows = teamGame ? result?.teams ?? [] : result?.players ?? [];
  const matching = rows.filter((player) => `${player.displayName} ${'playerIds' in player
    ? player.playerIds.map((id) => result?.players.find((member) => member.playerId === id)?.displayName ?? '').join(' ') : ''}`
    .toLowerCase().includes(query.trim().toLowerCase()));
  const pageSize = 12;
  const page = Math.min(pageIndex, Math.max(0, Math.ceil(matching.length / pageSize) - 1));
  for (const player of matching.slice(page * pageSize, (page + 1) * pageSize)) {
    if (player.status !== 'unavailable') continue;
    const reason = gameUnavailableMessage(player.strokeGame?.unavailableReason ?? player.unavailableReason);
    unavailable.set(reason, [...(unavailable.get(reason) ?? []), player.displayName]);
  }
  function showNine(value: 'front' | 'back') {
    setNine(value);
    if (scroll.current) scroll.current.scrollLeft = 0;
  }

  return (
    <section className="game-results" aria-label={`${game.name} results`}>
      <h3>{game.name}</h3>
      <p>{gameScoringLabel(game)}</p>
      {game.kind === 'ball-drop' ? <p className="game-hint">Lowest two-ball score relative to each golfer&apos;s par, from different golfers. All four saved dispositions are required. Totals are provisional while holes are pending.</p>
        : game.kind === 'skins' ? <p className="game-hint">Skins wait for every golfer&apos;s saved disposition. Pickup and DNF are ineligible; zero means a resolved hole without a win.
          {' '}{result?.unawardedSkins ?? 0} unawarded · {result?.pendingSkins ?? holeNumbers.length} pending. Final tied skins stay unawarded.</p>
          : teamGame && <p className="game-hint">Team-hole points wait for every teammate&apos;s saved individual points. Blank means pending; zero is a saved points score.</p>}
      {teamGame && result?.teamSetupRequired ? <p>Update team assignments. The saved teams no longer match this round&apos;s golfers. Edit this game to repair assignments.</p>
        : !result || rows.length === 0 ? <p>Results are unavailable.</p> : <>
        {rows.length > pageSize && <div>
          <label>Find {teamGame ? 'teams or golfers' : 'golfers'} in {game.name}<input type="search" value={query} onChange={(event) => {
            setQuery(event.target.value); setPageIndex(0);
          }} /></label>
          <p>{matching.length} of {rows.length} {teamGame ? 'teams' : 'golfers'} · Page {page + 1} of {Math.max(1, Math.ceil(matching.length / pageSize))}</p>
          <div className="game-actions" aria-label={`${game.name} result pages`}>
            <button type="button" disabled={page === 0} onClick={() => { setPageIndex(page - 1); }}>Previous results</button>
            <button type="button" disabled={(page + 1) * pageSize >= matching.length} onClick={() => { setPageIndex(page + 1); }}>Next results</button>
          </div>
        </div>}
        {matching.length === 0 && <p>No results match your search.</p>}
        {front.length > 0 && back.length > 0 && <div className="game-card-nines" role="group" aria-label={`${game.name} holes to display`}>
          <button type="button" aria-pressed={!showBack} onClick={() => { showNine('front'); }}>Front 9</button>
          <button type="button" aria-pressed={showBack} onClick={() => { showNine('back'); }}>Back 9</button>
        </div>}
        <div className="game-scroll game-card-scroll" role="region" aria-label={`${game.name} ${unit} scorecard`} tabIndex={0} ref={scroll}>
          <table>
            <caption>{label} · {unit === 'points' ? 'Points' : unit === 'skins' ? 'Skins awarded' : 'Strokes to par'}</caption>
            <thead><tr><th scope="col">{teamGame ? 'Team' : 'Player'}</th>
              {visible.map((number) => <th scope="col" key={number}>{number}</th>)}
              <th scope="col">Out</th><th scope="col">In</th><th scope="col">Total</th>
            </tr></thead>
            <tbody>{matching.slice(page * pageSize, (page + 1) * pageSize).map((player) => <tr key={'teamId' in player ? player.teamId : player.playerId}>
              <th scope="row"><span className="game-player-name">{player.displayName}</span>
                {'playerIds' in player && <small className="game-player-meta">{player.playerIds.map((id) =>
                  result.players.find((member) => member.playerId === id)?.displayName ?? 'Golfer unavailable').join(' · ')}</small>}
                {game.basis === 'net' && 'playingHandicap' in player && <small className="game-player-meta">Playing handicap {player.playingHandicap === null ? '—' : handicap(player.playingHandicap)}</small>}
                <small className="game-player-meta">{progress(player)}</small>
              </th>
              {visible.map((number) => {
                const outcome = player.strokeGame?.holes.find((hole) => hole.number === number);
                const points = player.strokeGame ? outcome?.value : player.holes.find((hole) => hole.number === number)?.points;
                const counting = outcome?.countingPlayerIds.map((id) => result.players.find((entry) => entry.playerId === id)?.displayName ?? 'Golfer unavailable').join(' + ');
                return <td key={number} aria-label={teamGame && player.status !== 'unavailable' && points == null ? 'Pending' : undefined}>{player.status === 'unavailable'
                  ? <span aria-label="Unavailable">—</span>
                  : <span title={counting || undefined}>{points ?? (teamGame ? null : <span aria-label="Pending">—</span>)}</span>}</td>;
              })}
              <td>{(player.strokeGame ? player.strokeGame.frontTotal : player.frontPoints) ?? '—'}</td><td>{(player.strokeGame ? player.strokeGame.backTotal : player.backPoints) ?? '—'}</td>
              <td>{gameResultTotal(player) ?? '—'}{player.status === 'in-progress' && gameResultTotal(player) !== null && ' (partial)'}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {[...unavailable].map(([reason, names]) => <p className="game-hint" key={reason}>{names.join(', ')}: {reason}</p>)}
      </>}
    </section>
  );
}
