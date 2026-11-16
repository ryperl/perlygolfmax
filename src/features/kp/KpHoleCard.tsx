import { useState } from 'react';
import type { ReactNode } from 'react';
import type { KpHoleResult, KpPayout } from '../../domain/kp';
import type { RoundScores } from '../../domain/scoring';
import { formatMoney } from '../purse';
import { kpEntryLabel } from './kp-presentation';

export function KpHoleCard({ round, hole, payout, children }: {
  readonly round: RoundScores;
  readonly hole: KpHoleResult;
  readonly payout: KpPayout | null;
  readonly children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const closed = round.kp?.status === 'closed';
  const shares = payout?.shares.filter((share) => share.holeNumber === hole.number) ?? [];
  const amount = payout?.holes.find((entry) => entry.number === hole.number)?.amountMinor;
  const tied = hole.closestPlayerIds.length > 1;
  const resolved = closed && tied && shares.length > 0;
  const featuredIds = resolved ? shares.map((share) => share.playerId) : hole.closestPlayerIds;
  const contenders = [...hole.contenders].sort((left, right) => left.inches - right.inches);
  const ranks = new Map<number, number>();
  for (const [index, entry] of contenders.entries()) {
    if (!ranks.has(entry.inches)) ranks.set(entry.inches, index + 1);
  }
  const distance = contenders.find((entry) => featuredIds.includes(entry.playerId))?.inches;
  const names = new Map(round.cards.map((card) => [card.playerId, card.displayName]));
  const playerName = (id: string) => names.get(id) ?? 'Unavailable golfer';
  const pot = round.kpPot;
  const needsReview = closed && tied && !resolved && amount !== undefined;
  const status = distance === undefined ? closed ? 'No measurement' : 'Pending'
    : !closed ? tied ? 'Tied leaders' : 'Leading'
      : resolved ? shares.length > 1 ? 'Tie resolved · Split' : 'Tie resolved · Selected'
        : needsReview ? 'Tie · Review needed' : tied ? 'Tied closest' : 'Closest';
  const unmeasured = round.cards.filter((card) =>
    card.holes.find((entry) => entry.number === hole.number)?.score.kp?.kind === 'no-measurement');
  return <article className="kp-ticket" aria-label={`KP hole ${String(hole.number)} results`}>
    <div className="kp-ticket-main">
      <div className="kp-ticket-pin" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" focusable="false">
          <path d="M7 21V3l12 4-12 4M3 21h9" />
        </svg><strong>{hole.number}</strong>
      </div>
      <div className="kp-ticket-body">
        <header className="kp-ticket-heading"><h3>Hole {hole.number}</h3>
          <span className="kp-ticket-state" data-review={needsReview || undefined}>{status}</span>
        </header>
        <div className="kp-ticket-result">
          <h4>{distance === undefined ? closed ? 'No qualifying measurement' : 'No measurement yet' : featuredIds.map(playerName).join(' / ')}</h4>
          {distance !== undefined && <p className="kp-ticket-distance" aria-label={`${String(Math.floor(distance / 12))} feet ${String(distance % 12)} inches`}>
            {Math.floor(distance / 12)}<small> ft </small>{distance % 12}<small> in</small>
          </p>}
        </div>
        {distance === 0 && <p className="kp-ticket-note">Hole-in-one</p>}
        {pot && shares.length > 0 && <div className="kp-ticket-awards" aria-label={`Hole ${String(hole.number)} awards`}>
          <p>{payout?.status === 'final' ? 'Allocated award' : 'Projected award'}</p>
          <dl>{shares.map((share) => <div key={share.playerId}>
            <dt className={shares.length === 1 ? 'visually-hidden' : undefined}>{playerName(share.playerId)}</dt>
            <dd>{formatMoney(share.amountMinor, pot.currency)}</dd>
          </div>)}</dl>
        </div>}
        {needsReview && <p className="kp-ticket-note">Resolve the closest-distance tie.</p>}
        {payout?.status === 'unavailable' && distance !== undefined && <p className="kp-ticket-note">Award unavailable · organizer review needed.</p>}
      </div>
    </div>
    {contenders.length > 0 && <details className="kp-ticket-details" onToggle={(event) => { setExpanded(event.currentTarget.open); }}>
      <summary><span>{expanded ? 'Hide contenders' : 'View contenders'} <span className="kp-contender-count">({contenders.length})</span></span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <table className="kp-contenders">
        <caption className="visually-hidden">Hole {hole.number} measured contenders</caption>
        <thead><tr><th scope="col">Golfer</th><th scope="col">Distance</th></tr></thead>
        <tbody>{contenders.map((entry) => <tr key={entry.playerId} data-closest={hole.closestPlayerIds.includes(entry.playerId) || undefined}>
          <th scope="row"><span className="kp-contender-rank">{ranks.get(entry.inches)}</span>{playerName(entry.playerId)}</th>
          <td>{Math.floor(entry.inches / 12)} ft {entry.inches % 12} in</td>
        </tr>)}</tbody>
      </table>
    </details>}
    {unmeasured.length > 0 && <details className="kp-ticket-unmeasured"><summary>No measurement ({unmeasured.length})</summary>
      <ul>{unmeasured.map((card) => <li key={card.playerId}>{card.displayName}: {kpEntryLabel({ kind: 'no-measurement' })}</li>)}</ul>
    </details>}
    {children && (resolved ? <details className="kp-ticket-resolution">
      <summary>Change tie resolution</summary><div className="kp-ticket-management">{children}</div>
    </details> : <div className="kp-ticket-management">{children}</div>)}
  </article>;
}
