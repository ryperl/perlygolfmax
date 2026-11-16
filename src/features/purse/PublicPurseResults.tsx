import { useRef, useState } from 'react';
import type { PublicPurseSummary } from '../../domain/public-purse';
import type { PlayerWinningsBreakdown } from '../../domain/winnings-breakdown';
import { formatMoney, moneyText } from './money';
import './purse.css';
import { PlayerWinningsDialog } from './PlayerWinningsDialog';
import { EventReviewBanner } from '../event-review';

function PurseSymbol({ kind }: { readonly kind: 'trophy' | 'course' | 'pending' | 'calculated' | 'unavailable' }) {
  const path = kind === 'trophy' ? 'M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 2v5m-4 3h8'
    : kind === 'course' ? 'M6 21V3l13 4-13 4M3 21h7'
      : kind === 'calculated' ? 'm6 12 4 4 8-8'
        : kind === 'pending' ? 'M12 7v5l3 2'
          : 'm8 8 8 8M16 8l-8 8';
  return <svg className="purse-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {(kind === 'pending' || kind === 'calculated' || kind === 'unavailable') && <circle cx="12" cy="12" r="9" />}
    <path d={path} />
  </svg>;
}

export function PublicPurseResults({ value, loadPlayer, onSessionExpired }: {
  readonly value: PublicPurseSummary;
  readonly loadPlayer?: ((playerId: string, signal: AbortSignal) => Promise<PlayerWinningsBreakdown>) | undefined;
  readonly onSessionExpired?: ((message: string) => void) | undefined;
}) {
  const [playerDetail, setPlayerDetail] = useState<PublicPurseSummary['players'][number]>();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const initialRound = value.rounds.find((round) => value.pools.some((pool) => pool.roundId === round.id));
  const [selected, setSelected] = useState(initialRound?.id ?? 'event');
  const choices = [...value.rounds, { id: 'event', label: 'Event-wide pools' }];
  const selection = choices.some((choice) => choice.id === selected) ? selected : initialRound?.id ?? 'event';
  const pools = value.pools.filter((pool) => pool.roundId === (selection === 'event' ? null : selection));
  const currency = value.currency;
  const players = [...value.players].sort((left, right) => left.amountMinor === null
    ? right.amountMinor === null ? 0 : 1 : right.amountMinor === null ? -1 : right.amountMinor - left.amountMinor);
  return <section className="purse-panel purse-public" aria-label="Event purse">
    {value.reviewNotices && <EventReviewBanner notices={value.reviewNotices} />}
    <header><p className="purse-hint">{value.eventName}</p><h2><PurseSymbol kind="trophy" />Event purse</h2></header>
    {currency === null ? <p>No purse configured.</p> : <>
      {value.needsReview && !value.reviewNotices?.length && <p role="status" className="purse-warning">Some pools need organizer review. Amounts show known awards only.</p>}
      <section aria-label="Course prize pools">
        <label><span className="purse-label"><PurseSymbol kind="course" />Course</span>
          <select value={selection} onChange={(event) => { setSelected(event.target.value); }}>
            {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
          </select>
        </label>
        <ul className="purse-public-pools">{pools.map((pool) => <li key={pool.id}>
          <div className="purse-pool-title"><strong>{pool.name}</strong>
            <span className="purse-pool-state" role="img" aria-label={pool.status === 'calculated' ? 'Results calculated' : pool.status === 'pending' ? 'Awaiting results' : 'Results unavailable'}>
              <PurseSymbol kind={pool.status} />
            </span>
          </div>
          {pool.potMinor !== null ? <p>{formatMoney(pool.potMinor, currency)} pot</p> : <p>
            {pool.prizes.map((prize, index) => <span key={prize.place}>{index > 0 && ' · '}#{prize.place} {formatMoney(prize.amountMinor, currency)}</span>)}
            {' · '}{pool.awardUnit === 'per-team' ? 'per team' : 'per golfer'}
          </p>}
        </li>)}</ul>
        {pools.length === 0 && <p>No purse pools configured for {selection === 'event' ? 'the event' : 'this course'}.</p>}
      </section>
      <section aria-label="Player winnings">
        <h3>Player winnings <span className="purse-hint">· All courses</span></h3>
        <p className="purse-hint">Awarded pools only · Not payments</p>
        <table><caption className="visually-hidden">Event winnings in {currency}</caption>
          <thead><tr><th scope="col">Player / pools won</th><th scope="col">Won <span className="purse-column-currency">({currency})</span></th></tr></thead>
          <tbody>{players.map((player) => <tr key={player.playerId}>
            <th scope="row">{loadPlayer ? <button className="purse-player-link" type="button" onClick={(event) => {
              trigger.current = event.currentTarget; setPlayerDetail(player);
            }}>{player.displayName}</button> : player.displayName}
              {player.poolIds.length > 0 && <ul className="purse-player-pools" aria-label="Pools won">{player.poolIds.map((poolId) =>
                <li key={poolId}>{value.pools.find((pool) => pool.id === poolId)?.name}</li>)}</ul>}
            </th>
            <td className="purse-winnings">{player.amountMinor === null ? 'Unavailable' : moneyText(player.amountMinor)}</td>
          </tr>)}</tbody>
        </table>
      </section>
    </>}
    {currency !== null && playerDetail && loadPlayer && <PlayerWinningsDialog key={playerDetail.playerId}
      eventId={value.eventId} player={playerDetail} currency={currency} load={loadPlayer}
      onSessionExpired={(message) => { onSessionExpired?.(message); }}
      onClose={() => { setPlayerDetail(undefined); trigger.current?.focus(); }} />}
  </section>;
}
