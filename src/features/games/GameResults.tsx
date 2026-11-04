import { useRef, useState } from 'react';
import type { GamePlayerResult, RoundGameDefinition, RoundGameResult } from '../../domain/games';
import { sameGameDefinitions } from '../../domain/games';
import { stablefordPoints } from '../../domain/stableford';
import { gameUnavailableMessage } from './game-presentation';

function progress(player: GamePlayerResult): string {
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
  const scroll = useRef<HTMLDivElement | null>(null);
  const custom = !sameGameDefinitions([game], [{ ...game, points: stablefordPoints(game.preset) }]);
  const layout = [...holeNumbers].sort((left, right) => left - right);
  const front = layout.filter((number) => number <= 9);
  const back = layout.filter((number) => number > 9);
  const showBack = front.length === 0 || nine === 'back' && back.length > 0;
  const visible = showBack ? back : front;
  const label = showBack ? 'Back nine' : 'Front nine';
  const unavailable = new Map<string, string[]>();
  for (const player of result?.players ?? []) {
    if (player.status !== 'unavailable') continue;
    const reason = gameUnavailableMessage(player.unavailableReason);
    unavailable.set(reason, [...(unavailable.get(reason) ?? []), player.displayName]);
  }
  function showNine(value: 'front' | 'back') {
    setNine(value);
    if (scroll.current) scroll.current.scrollLeft = 0;
  }

  return (
    <section className="game-results" aria-label={`${game.name} results`}>
      <h3>{game.name}</h3>
      <p><span>{game.basis === 'gross' ? 'Gross' : `Net · ${String(game.handicapAllowancePercent)}% allowance`}</span>
        {' · '}<span>{custom ? 'Custom points' : game.preset === 'standard' ? 'Standard Stableford' : 'Modified Stableford'}</span></p>
      {!result || result.players.length === 0 ? <p>Results are unavailable.</p> : <>
        {front.length > 0 && back.length > 0 && <div className="game-card-nines" role="group" aria-label={`${game.name} holes to display`}>
          <button type="button" aria-pressed={!showBack} onClick={() => { showNine('front'); }}>Front 9</button>
          <button type="button" aria-pressed={showBack} onClick={() => { showNine('back'); }}>Back 9</button>
        </div>}
        <div className="game-scroll game-card-scroll" role="region" aria-label={`${game.name} points scorecard`} tabIndex={0} ref={scroll}>
          <table>
            <caption>{label} · Points</caption>
            <thead><tr><th scope="col">Player</th>
              {visible.map((number) => <th scope="col" key={number}>{number}</th>)}
              <th scope="col">Out</th><th scope="col">In</th><th scope="col">Total</th>
            </tr></thead>
            <tbody>{result.players.map((player) => <tr key={player.playerId}>
              <th scope="row"><span className="game-player-name">{player.displayName}</span>
                {game.basis === 'net' && <small className="game-player-meta">Playing handicap {player.playingHandicap === null ? '—' : handicap(player.playingHandicap)}</small>}
                <small className="game-player-meta">{progress(player)}</small>
              </th>
              {visible.map((number) => {
                const points = player.holes.find((hole) => hole.number === number)?.points;
                return <td key={number}>{player.status === 'unavailable'
                  ? <span aria-label="Unavailable">—</span>
                  : points ?? <span aria-label="Pending">—</span>}</td>;
              })}
              <td>{player.frontPoints ?? '—'}</td><td>{player.backPoints ?? '—'}</td>
              <td>{player.totalPoints ?? '—'}{player.status === 'in-progress' && player.totalPoints !== null && ' (partial)'}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {[...unavailable].map(([reason, names]) => <p className="game-hint" key={reason}>{names.join(', ')}: {reason}</p>)}
      </>}
    </section>
  );
}
