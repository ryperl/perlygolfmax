import type { DotSpecialReview, DotsGameDefinition, DotsResults as Results } from '../../domain/dots';
import { dotsSpecialCatalog } from '../../domain/dots';

export function DotSpecialReviewNotice({ reviews, players }: {
  readonly reviews: readonly DotSpecialReview[] | undefined;
  readonly players: readonly { readonly playerId: string; readonly displayName: string }[];
}) {
  if (!reviews?.length) return null;
  return <div className="game-review" role="status">
    <strong>Saved specials need review</strong>
    <p>These claims no longer qualify against current round inputs. Unrelated awards remain visible; related totals are provisional.</p>
    <ul>{reviews.map((review, index) => <li key={index}>
      Hole {review.number} · {dotsSpecialCatalog.find((special) => special.kind === review.kind)?.label ?? 'Special'}
      {review.playerId && ` · ${players.find((player) => player.playerId === review.playerId)?.displayName ?? 'Golfer unavailable'}`}
    </li>)}</ul>
  </div>;
}

export function DotsResults({ game, result }: { readonly game: DotsGameDefinition; readonly result: Results | undefined }) {
  const name = (id: string) => result?.players.find((player) => player.playerId === id)?.displayName ?? 'Golfer unavailable';
  const label = (kind: string) => dotsSpecialCatalog.find((special) => special.kind === kind)?.label ?? 'Special';
  const pending = result?.holes.filter((hole) => hole.status === 'pending').map((hole) => hole.number) ?? [];
  const unavailable = result?.holes.filter((hole) => hole.status === 'unavailable').map((hole) => hole.number) ?? [];
  return <section className="game-results dots-results" aria-label={`${game.name} results`}>
    <h3>{game.name}</h3><p>{game.mode === 'individual' ? game.playerIds.length === 1 ? 'Solo stats only' : 'Individual' : game.mode === 'fixed' ? 'Fixed partners'
      : game.mode === 'rotating' ? game.rotationHoles === 3 ? 'Modified Sixes · 3-hole partners' : 'Sixes · 6-hole partners' : 'Linked sides'}</p>
    {!result ? <p>Saved Dots results unavailable. Refresh to retry.</p> : <>
      {game.mode === 'fixed' && <p className="game-hint">{game.partnerIds.slice(0, 2).map(name).join(' + ')}
        {' vs '}{game.partnerIds.slice(2).map(name).join(' + ')} · Same partners all round</p>}
      <p>{result.status === 'complete' ? 'Complete saved results' : result.status === 'unavailable'
        ? 'Saved inputs need review · Totals unavailable' : 'Provisional saved results'}</p>
      <DotSpecialReviewNotice reviews={result.reviewRequired} players={result.players} />
      {game.mode === 'rotating' && <p>{result.rotation?.rotation
        ? `Cycle starts on hole ${String(result.rotation.firstHole)}${result.rotation.rotation.recordedLate ? ' · Order recovered after scoring started' : ''}`
        : 'Partner order pending. No sharing is inferred.'}</p>}
      <div className="game-scroll" role="region" aria-label="Dots earned ledger" tabIndex={0}><table>
        <caption>Saved special dots</caption><thead><tr><th scope="col">Golfer</th>
          <th scope="col">Earned dots</th><th scope="col">Holes</th></tr></thead>
        <tbody>{result.players.map((player) => <tr key={player.playerId}><th scope="row">{player.displayName}</th>
          <td>{player.totalPoints ?? '—'}</td><td>{player.holesScored}/{player.totalHoles}</td></tr>)}</tbody>
      </table></div>
      {result.unawarded.map((entry, index) => <p key={`${entry.kind}:${String(index)}`}>Unawarded {label(entry.kind)}: {entry.units} units · Holes {entry.sourceHoles.join(', ')}.
        No rollover or retroactive winner.</p>)}
      {pending.length > 0 && <details><summary>Pending holes ({pending.length})</summary>
        <p>Saved scores or declarations pending: {pending.join(', ')}.</p></details>}
      {unavailable.length > 0 && <p role="alert">Review saved inputs on {unavailable.length === 1 ? 'hole' : 'holes'} {unavailable.join(', ')}.</p>}
      {result.issues.length > 0 && <p>Some saved inputs need review before all awards are available.</p>}
    </>}
  </section>;
}
