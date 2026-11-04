import { useId, useRef } from 'react';
import type { GamePlayerResult, RoundGameDefinition, RoundGameResult } from '../../domain/games';
import { sameGameDefinitions } from '../../domain/games';
import { stablefordPoints } from '../../domain/stableford';
import { gameUnavailableMessage } from './game-presentation';

function progress(player: GamePlayerResult): string {
  return player.status === 'unavailable'
    ? gameUnavailableMessage(player.unavailableReason)
    : player.status === 'complete' ? 'Complete'
      : `${String(player.holesScored)}/${String(player.totalHoles)} holes · In progress`;
}

function handicap(value: number): string {
  return value < 0 ? `+${String(Math.abs(value))}` : String(value);
}

export function GameResults({ game, result }: {
  readonly game: RoundGameDefinition;
  readonly result: RoundGameResult | undefined;
}) {
  const id = useId();
  const custom = !sameGameDefinitions([game], [{ ...game, points: stablefordPoints(game.preset) }]);
  const details = useRef(new Map<string, HTMLDetailsElement>());

  function showHolePoints(playerId: string) {
    const disclosure = details.current.get(playerId);
    if (!disclosure) return;
    disclosure.open = true;
    disclosure.querySelector('summary')?.focus();
  }

  return (
    <section className="game-results" aria-label={`${game.name} results`}>
      <h3>{game.name}</h3>
      <p><span>{game.basis === 'gross' ? 'Gross' : `Net · ${String(game.handicapAllowancePercent)}% allowance`}</span>
        {' · '}<span>{custom ? 'Custom points' : game.preset === 'standard' ? 'Standard Stableford' : 'GolfLink Modified'}</span></p>
      {!result || result.players.length === 0 ? <p>Results are unavailable.</p> : <>
        <div className="game-scroll" role="region" aria-label={`${game.name} points totals`} tabIndex={0}>
          <table>
            <caption>Points in player order</caption>
            <thead><tr><th scope="col">Player</th>{game.basis === 'net' && <th scope="col">Playing handicap</th>}
              <th scope="col">Front</th><th scope="col">Back</th><th scope="col">Total</th><th scope="col">Progress</th>
            </tr></thead>
            <tbody>{result.players.map((player, index) => <tr key={player.playerId}>
              <th scope="row"><button type="button" aria-controls={`${id}-player-${String(index)}`}
                onClick={() => { showHolePoints(player.playerId); }}>{player.displayName}</button></th>
              {game.basis === 'net' && <td>{player.playingHandicap === null ? '—' : handicap(player.playingHandicap)}</td>}
              <td>{player.frontPoints ?? '—'}</td><td>{player.backPoints ?? '—'}</td>
              <td>{player.totalPoints ?? '—'}{player.status === 'in-progress' && player.totalPoints !== null && ' (partial)'}</td>
              <td>{progress(player)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {result.players.map((player, index) => <details key={player.playerId} id={`${id}-player-${String(index)}`}
          ref={(element) => {
            if (element) details.current.set(player.playerId, element);
            else details.current.delete(player.playerId);
          }}>
          <summary>{player.displayName} · Hole points</summary>
          {player.status === 'unavailable' ? <p>{progress(player)}</p> :
            <div className="game-scroll" role="region" aria-label={`${game.name}, ${player.displayName}, hole points`} tabIndex={0}>
              <table>
                <caption>{player.displayName} · Points by hole</caption>
                <thead><tr><th scope="col">Hole</th>{player.holes.map((hole) => <th scope="col" key={hole.number}>{hole.number}</th>)}</tr></thead>
                <tbody><tr><th scope="row">Points</th>{player.holes.map((hole) =>
                  <td key={hole.number}>{hole.points ?? <span aria-label="Pending">—</span>}</td>)}</tr></tbody>
              </table>
            </div>}
        </details>)}
      </>}
    </section>
  );
}
