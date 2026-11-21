import type { WolfGameDefinition, WolfResults as Results } from '../../domain/wolf';
import { WolfSoloProgress } from './WolfSoloProgress';

export function WolfResults({ game, result }: {
  readonly game: WolfGameDefinition;
  readonly result: Results | undefined;
}) {
  const name = (id: string) => result?.players.find((player) => player.playerId === id)?.displayName ?? 'Golfer unavailable';
  return <section className={`game-results wolf-results${game.version === 2 ? ' wolf-results-earned' : ''}`} aria-label={`${game.name} results`}>
    <h3>{game.name}</h3>
    <p>{game.basis === 'gross' ? 'Gross' : game.handicapRule === 'full-course-v1'
      ? 'Net · Full captured CH' : 'Net · SO off lowest in saved group'} · {game.version === 2 ? 'Saved earned dots' : 'Legacy transfer balance'} · Ties zero, no carry</p>
    {!result ? <p>Saved Wolf results unavailable. Refresh to retry.</p> : <>
      <p>{result.status}{game.version === 1 && ' · No dollar settlement'}</p>
      <WolfSoloProgress game={game} holes={result.holes} players={result.players} />
      <div className="game-scroll" role="region" aria-label="Wolf ledger" tabIndex={0}><table>
        <caption>{game.version === 2 ? 'Saved earned base-game dots · Not transfers' : 'Saved zero-sum dot ledger'}</caption>
        <thead><tr><th scope="col">Golfer</th>{game.version === 1 && <><th scope="col">Won</th><th scope="col">Lost</th></>}
          <th scope="col">{game.version === 2 ? 'Earned dots' : 'Dot balance'}</th><th scope="col">Holes</th></tr></thead>
        <tbody>{result.players.map((player) => <tr key={player.playerId}><th scope="row">{player.displayName}</th>
          {game.version === 1 && <><td>{player.dotsWon ?? '—'}</td><td>{player.dotsLost ?? '—'}</td></>}<td>{player.balance ?? '—'}</td>
          <td>{player.holesScored}/{player.totalHoles} · {player.status}</td></tr>)}</tbody>
      </table></div>
      {result.comeback && <p>{result.comeback.status === 'saved' ? 'Saved comeback Wolf'
        : result.comeback.status === 'available' ? 'Available comeback Wolf' : 'Comeback selection pending'}
        {result.comeback.receipt && `: ${name(result.comeback.receipt.wolfId)}`}
        {result.comeback.changed && ' · Earlier results changed; saved Wolf selection is retained.'}</p>}
    </>}
  </section>;
}
