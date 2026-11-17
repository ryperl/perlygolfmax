import type { WolfGameDefinition, WolfResults as Results } from '../../domain/wolf';

export function WolfResults({ game, result }: {
  readonly game: WolfGameDefinition;
  readonly result: Results | undefined;
}) {
  const name = (id: string) => result?.players.find((player) => player.playerId === id)?.displayName ?? 'Golfer unavailable';
  return <section className="game-results" aria-label={`${game.name} results`}>
    <h3>{game.name}</h3>
    <p>{game.basis === 'gross' ? 'Gross' : 'Net · 100% captured CH off lowest four'} · Saved dot balance · Ties zero, no carry</p>
    {!result ? <p>Saved Wolf results unavailable. Refresh to retry.</p> : <>
      <p>{result.status} · No dollar settlement</p>
      <div className="game-scroll" role="region" aria-label="Wolf ledger" tabIndex={0}><table>
        <caption>Saved zero-sum dot ledger</caption>
        <thead><tr><th scope="col">Golfer</th><th scope="col">Won</th><th scope="col">Lost</th><th scope="col">Dot balance</th><th scope="col">Holes</th></tr></thead>
        <tbody>{result.players.map((player) => <tr key={player.playerId}><th scope="row">{player.displayName}</th>
          <td>{player.dotsWon ?? '—'}</td><td>{player.dotsLost ?? '—'}</td><td>{player.balance ?? '—'}</td>
          <td>{player.holesScored}/{player.totalHoles} · {player.status}</td></tr>)}</tbody>
      </table></div>
      <details><summary>Saved hole choices and winners</summary><ol>{result.holes.map((hole) => <li key={hole.number}>
        Hole {hole.number} · Wolf: {hole.wolfId ? name(hole.wolfId) : 'Unavailable'} · {hole.mode === 'pig' ? 'PIG'
          : hole.mode === 'blind' ? 'Blind Wolf' : hole.mode === 'partner' ? `Partner: ${hole.wolfSide.filter((id) => id !== hole.wolfId).map(name).join(' + ')}` : 'Choice pending'}
        {' · '}{hole.status === 'won' ? `${(hole.winner === 'wolf' ? hole.wolfSide : hole.opponents).map(name).join(' + ')} won`
          : hole.status === 'tied' ? 'Halved · 0 dots' : hole.status}
        {hole.source === 'explicit' && ' · Explicit match outcome'}
        {hole.recordedLate && ' · Choice recorded after scores'}
      </li>)}</ol></details>
    </>}
  </section>;
}
