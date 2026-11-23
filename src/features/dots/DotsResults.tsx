import type { DotSpecialReview, DotsGameDefinition, DotsResults as Results } from '../../domain/dots';
import { dotsSpecialCatalog } from '../../domain/dots';
import type { DotsHighLowResults } from '../../domain/dots-high-low';
import type { GamePlayerResult } from '../../domain/games';

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

export function DotsResults({ game, result, highLow, players }: {
  readonly game: DotsGameDefinition; readonly result: Results | undefined;
  readonly highLow?: DotsHighLowResults | undefined;
  readonly players?: readonly GamePlayerResult[] | undefined;
}) {
  const name = (id: string) => result?.players.find((player) => player.playerId === id)?.displayName ?? 'Golfer unavailable';
  const label = (kind: string) => dotsSpecialCatalog.find((special) => special.kind === kind)?.label ?? 'Special';
  const pending = result?.holes.filter((hole) => hole.status === 'pending').map((hole) => hole.number) ?? [];
  const unavailable = result?.holes.filter((hole) => hole.status === 'unavailable').map((hole) => hole.number) ?? [];
  const roundBonuses = result?.awards.filter((award) => award.number === null) ?? [];
  const status = !game.highLow ? result?.status : !highLow || highLow.status === 'unavailable' || result?.status === 'unavailable'
    || players?.some((player) => player.status === 'unavailable')
    ? 'unavailable' : highLow.status === 'complete' && result?.status === 'complete' ? 'complete' : 'in-progress';
  return <section className="game-results dots-results" aria-label={`${game.name} results`}>
    <h3>{game.name}</h3><p>{game.mode === 'individual' ? game.playerIds.length === 1 ? 'Solo stats only' : 'Individual' : game.mode === 'fixed' ? 'Fixed partners'
      : game.mode === 'rotating' ? game.rotationHoles === 3 ? 'Modified Sixes · 3-hole partners' : 'Sixes · 6-hole partners' : 'Linked sides'}</p>
    {!result ? <p>Saved Dots results unavailable. Refresh to retry.</p> : <>
      {game.mode === 'fixed' && <p className="game-hint">{game.partnerIds.slice(0, 2).map(name).join(' + ')}
        {' vs '}{game.partnerIds.slice(2).map(name).join(' + ')} · Same partners all round</p>}
      <p>{status === 'complete' ? 'Complete saved results' : status === 'unavailable'
        ? 'Saved inputs need review · Totals unavailable' : 'Provisional saved results'}</p>
      <DotSpecialReviewNotice reviews={result.reviewRequired} players={result.players} />
      {game.mode === 'rotating' && <p>{result.rotation?.rotation
        ? `Cycle starts on hole ${String(result.rotation.firstHole)}${result.rotation.rotation.recordedLate ? ' · Order recovered after scoring started' : ''}`
        : 'Partner order pending. No sharing is inferred.'}</p>}
      <div className="game-scroll" role="region" aria-label="Dots earned ledger" tabIndex={0}><table>
        <caption>{game.highLow ? 'Saved High/Low and special dots' : 'Saved special dots'}</caption><thead><tr><th scope="col">Golfer</th>
          {game.highLow && <><th scope="col">{game.highLow.version === 2 ? 'High/Low + auto Sweep' : 'High/Low'}</th><th scope="col">Specials</th></>}
          <th scope="col">Earned dots</th><th scope="col">Holes</th></tr></thead>
        <tbody>{result.players.map((player) => <tr key={player.playerId}><th scope="row">{player.displayName}</th>
          {game.highLow && <><td>{highLow?.players.find((entry) => entry.playerId === player.playerId)?.totalPoints ?? '—'}</td>
            <td>{player.totalPoints ?? '—'}</td></>}
          <td>{game.highLow ? players?.find((entry) => entry.playerId === player.playerId)?.totalPoints ?? '—' : player.totalPoints ?? '—'}</td>
          <td>{(game.highLow ? players?.find((entry) => entry.playerId === player.playerId)?.holesScored : player.holesScored) ?? 0}/{player.totalHoles}</td></tr>)}</tbody>
      </table></div>
      {roundBonuses.length > 0 && <section aria-label="Individual round bonuses">
        <p>These round-only bonuses are already included in Specials, not in any hole score:</p>
        {roundBonuses.map((award) => <p key={award.id}>{award.recipientIds.map(name).join(', ')}
          {' · '}{award.kind === 'king-of-the-hill' ? 'King of the Hill' : label(award.kind)} +{award.dots}</p>)}
      </section>}
      {game.highLow && <details><summary>Net High/Low holes</summary>
        <p>{game.highLow.handicapRule === 'group-low-v1' ? 'SO off the lowest player in your saved group.' : 'Full Course Handicap.'}
          {' '}One dot per winning teammate for each contest; ties push. Specials use gross scores.</p>
        {game.highLow.version === 2 && <p>Automatic High/Low Sweep adds one per teammate for winning both contests.
          Manual Sweep and Category Sweep remain separate.</p>}
        {!highLow ? <p>Saved High/Low results unavailable. Refresh to retry.</p>
          : highLow.holes.map((hole) => <p key={hole.number}>Hole {hole.number} · {hole.sides.map((side) => side.map(name).join(' + ')).join(' vs ')}
            {' · '}{hole.contests.map((contest) => `${contest.kind === 'high' ? 'High' : 'Low'}: ${
              contest.status === 'won' ? contest.winnerIds.map(name).join(' + ') : contest.status === 'tied' ? 'Push'
                : contest.status === 'pending' ? 'Pending scores or order' : 'Unavailable'}`).join(' · ')}
            {game.highLow?.version === 2 && ` · High/Low Sweep: ${highLow.awards.filter((award) =>
              award.number === hole.number && award.kind === 'high-low-sweep').map((award) =>
              `${award.recipientIds.map(name).join(' + ')} +${String(award.dots)} each`).join(', ')
              || (hole.status === 'complete' ? 'None' : hole.status === 'pending' ? 'Pending' : 'Unavailable')}`}</p>)}
      </details>}
      {result.unawarded.map((entry, index) => <p key={`${entry.kind}:${String(index)}`}>Unawarded {label(entry.kind)}: {entry.units} units · Holes {entry.sourceHoles.join(', ')}.
        No rollover or retroactive winner.</p>)}
      {pending.length > 0 && <details><summary>Pending holes ({pending.length})</summary>
        <p>Saved scores or declarations pending: {pending.join(', ')}.</p></details>}
      {unavailable.length > 0 && <p role="alert">Review saved inputs on {unavailable.length === 1 ? 'hole' : 'holes'} {unavailable.join(', ')}.</p>}
      {result.issues.length > 0 && <p>Some saved inputs need review before all awards are available.</p>}
    </>}
  </section>;
}
