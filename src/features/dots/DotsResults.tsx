import type { DotsGameDefinition, DotsResults as Results } from '../../domain/dots';
import { dotsSpecialCatalog } from '../../domain/dots';
import type { DotAward } from '../../domain/dot-context';

function awardExplanation(award: DotAward): string {
  if (award.kind === 'paree' || award.kind === 'murphy' || award.kind === 'pully-murphy') {
    return award.reason.endsWith(': failure.') ? 'Failed call · Opponents earn' : 'Successful call · Calling side earns';
  }
  if (award.kind === 'kp' || award.kind === 'blue-plate' || award.kind === 'long-drive') return 'Qualifying winner collects current and carried category awards';
  if (award.kind === 'king-of-the-hill') return 'Individual ownership of every eligible category award · No sharing or multiplier';
  return dotsSpecialCatalog.find((special) => special.kind === award.kind)?.description ?? 'Saved award';
}

export function DotsResults({ game, result }: { readonly game: DotsGameDefinition; readonly result: Results | undefined }) {
  const name = (id: string) => result?.players.find((player) => player.playerId === id)?.displayName ?? 'Golfer unavailable';
  const label = (kind: string) => dotsSpecialCatalog.find((special) => special.kind === kind)?.label ?? 'Special';
  return <section className="game-results" aria-label={`${game.name} results`}>
    <h3>{game.name}</h3><p>Separate earned specials · {game.mode === 'individual' ? 'Individual' : game.mode === 'fixed' ? 'Fixed partners' : 'Linked sides'}</p>
    {!result ? <p>Saved Dots results unavailable. Refresh to retry.</p> : <>
      <p>{result.status === 'complete' ? 'Complete saved results' : 'Provisional saved results'}</p>
      <div className="game-scroll" role="region" aria-label="Dots earned ledger" tabIndex={0}><table>
        <caption>Saved special dots · Includes individual round bonuses</caption><thead><tr><th scope="col">Golfer</th>
          <th scope="col">Earned dots</th><th scope="col">Holes</th></tr></thead>
        <tbody>{result.players.map((player) => <tr key={player.playerId}><th scope="row">{player.displayName}</th>
          <td>{player.totalPoints ?? '—'}</td><td>{player.holesScored}/{player.totalHoles} · {player.status}</td></tr>)}</tbody>
      </table></div>
      <details><summary>Saved award explanations and score evidence</summary>
        <p>Current saved awards are recalculated after corrections. This is not a historical audit view.</p>
        <ul>{result.awards.map((award) => <li key={award.id}>
          {award.number === null ? 'Round bonus' : `Hole ${String(award.number)}`} · {label(award.kind)} · {award.earnedBy ? name(award.earnedBy) : 'Derived award'}
          {' · '}{award.units} units × {award.count} × {award.multiplier} = {award.dots} dots each to {award.recipientIds.map(name).join(' + ')}
          {' · '}{awardExplanation(award)}
          {award.sourceHoles.length > 0 && ` · Source holes ${award.sourceHoles.join(', ')}`}
          {award.scores.length > 0 && <ul>{award.scores.map((score) => <li key={`${score.playerId}:${String(score.number)}`}>
            {name(score.playerId)} · Hole {score.number} · {score.strokes ?? 'No numeric score'} / par {score.par}</li>)}</ul>}
        </li>)}</ul>
        {result.awards.length === 0 && <p>No saved awards yet.</p>}
      </details>
      {result.unawarded.map((entry, index) => <p key={`${entry.kind}:${String(index)}`}>Unawarded {label(entry.kind)}: {entry.units} units · Holes {entry.sourceHoles.join(', ')}.
        No rollover or retroactive winner.</p>)}
      {result.holes.filter((hole) => hole.status !== 'complete').map((hole) => <p key={hole.number}>
        Hole {hole.number} · {hole.status === 'pending' ? 'Pending saved scores or declarations' : 'Required saved inputs unavailable'}</p>)}
      {result.issues.length > 0 && <p>Some saved inputs need review before all awards are available.</p>}
    </>}
  </section>;
}
