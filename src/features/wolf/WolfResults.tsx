import type { WolfGameDefinition, WolfResults as Results } from '../../domain/wolf';
import { WolfSoloProgress } from './WolfSoloProgress';

export function WolfResults({ game, result }: {
  readonly game: WolfGameDefinition;
  readonly result: Results | undefined;
}) {
  const name = (id: string) => result?.players.find((player) => player.playerId === id)?.displayName ?? 'Golfer unavailable';
  return <section className="game-results" aria-label={`${game.name} results`}>
    <h3>{game.name}</h3>
    <p>{game.basis === 'gross' ? 'Gross' : 'Net · 100% captured CH off lowest four'} · {game.version === 2 ? 'Saved earned dots' : 'Legacy transfer balance'} · Ties zero, no carry</p>
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
      <details><summary>Saved hole choices and winners</summary><ol>{result.holes.map((hole) => <li key={hole.number}>
        Hole {hole.number} · Wolf: {hole.wolfId ? name(hole.wolfId) : 'Unavailable'} · {hole.mode === 'pig' ? 'PIG'
          : hole.mode === 'blind' ? 'Blind Wolf' : hole.mode === 'partner' ? `Partner: ${hole.wolfSide.filter((id) => id !== hole.wolfId).map(name).join(' + ')}` : 'Choice pending'}
        {' · '}{hole.status === 'won' ? `${(hole.winner === 'wolf' ? hole.wolfSide : hole.opponents).map(name).join(' + ')} won`
          : hole.status === 'tied' ? 'Halved · 0 dots' : hole.status}
        {hole.source === 'explicit' && ' · Explicit match outcome'}
        {hole.recordedLate && ' · Choice recorded after scores'}
        {game.version === 2 && hole.contests && <ul>{hole.contests.map((contest) => <li key={contest.kind}>
          {contest.kind === 'high' ? 'High' : 'Low'} · {contest.status}
          {contest.winner && ` · ${(contest.winner === 'wolf' ? hole.wolfSide : hole.opponents).map(name).join(' + ')}`}
          {' · '}{contest.wolfScore ?? '—'} vs {contest.opponentScore ?? '—'}
        </li>)}</ul>}
      </li>)}</ol></details>
    </>}
  </section>;
}
