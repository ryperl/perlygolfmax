import type { InternalGameSettlement } from '../../domain/dot-settlement';
import { formatMoney } from '../../domain/money';

export function InternalSettlement({ settlement, gameNames = [] }: {
  readonly settlement: InternalGameSettlement;
  readonly gameNames?: readonly string[];
}) {
  const money = (minor: number | null) => minor === null ? 'Unavailable' : minor > 0 ? `Due ${formatMoney(minor, 'USD')}`
    : minor < 0 ? `Owes ${formatMoney(-minor, 'USD')}` : formatMoney(0, 'USD');
  const name = (id: string) => settlement.players.find((player) => player.playerId === id)?.displayName ?? 'Golfer unavailable';
  const pointsOnly = settlement.status === 'points-only';
  const sources = gameNames.join(' + ');
  return <section className="game-results" aria-label={`Group ${String(settlement.groupNumber)} ${sources ? `${sources} ` : ''}internal settlement`}>
    <h3>Group {settlement.groupNumber}{sources && ` · ${sources}`} · Earned dots and money</h3>
    {sources && <p>{gameNames.length > 1 ? 'One combined settlement for these explicitly linked games.'
      : 'Independent game settlement; other unlinked games settle separately.'}</p>}
    <p>{pointsOnly ? 'No money configured · Points-only' : settlement.status === 'complete' ? 'Planned settlement · Not paid'
      : settlement.status === 'unavailable' ? 'Settlement unavailable' : 'Provisional settlement · Not paid'}</p>
    <div className="game-scroll" role="region" aria-label="Combined earned dots and planned money" tabIndex={0}><table>
      <caption>One individual settlement · Base and special sources counted once</caption>
      <thead><tr><th scope="col">Golfer</th><th scope="col">Base dots</th><th scope="col">Special dots</th>
        <th scope="col">Total dots</th><th scope="col">Net due / owed</th></tr></thead>
      <tbody>{settlement.players.map((player) => <tr key={player.playerId}><th scope="row">{player.displayName}</th>
        <td>{player.baseDots ?? '—'}</td><td>{player.specialDots ?? '—'}</td><td>{player.totalDots ?? '—'}</td>
        <td>{pointsOnly ? 'Points-only' : money(player.netMinor)}</td></tr>)}</tbody>
    </table></div>
    {!pointsOnly && <p>Total to settle: {settlement.totalToSettleMinor === null ? 'Unavailable'
      : formatMoney(settlement.totalToSettleMinor, 'USD')}{settlement.status !== 'complete' && ' · Provisional'}</p>}
    {!pointsOnly && settlement.pairwise.length > 0 && <details><summary>Opponent-by-opponent explanation</summary>
      <p>These comparisons explain the same net settlement. Do not settle both the net and pairwise amounts.</p>
      <ul>{settlement.pairwise.map((pair, index) => <li key={index}>{name(pair.fromPlayerId)} owes {name(pair.toPlayerId)} {formatMoney(pair.amountMinor, 'USD')}</li>)}</ul>
    </details>}
  </section>;
}
