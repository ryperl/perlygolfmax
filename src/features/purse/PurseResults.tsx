import { useState } from 'react';
import type { EventPurseView } from '../../domain/purse-settings';
import type { PurseCalculation, PursePlan } from '../../domain/purse';
import { formatMoney } from './money';
import { sourceChoices, sourceKey } from './purse-draft';

export interface PurseResultsProps {
  readonly value: EventPurseView;
  readonly plan: PursePlan;
  readonly calculation: PurseCalculation;
  readonly draft?: boolean;
}

export function PurseResults({ value, plan, calculation, draft = false }: PurseResultsProps) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const filtered = value.workspace.roster.filter((player) => player.displayName.toLowerCase().includes(query.toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 12));
  const currentPage = Math.min(page, pages - 1);
  const money = (minor: number | null) => formatMoney(minor, plan.currency);
  const metrics = [
    ['Planned budget', calculation.plannedBudgetMinor], ['Scheduled awards', calculation.scheduledMinor],
    ['Calculated allocation', calculation.allocatedMinor], ['Projected allocation', calculation.projectedMinor],
    ['Reserved', calculation.reservedMinor], ['Unallocated', calculation.unallocatedMinor],
    ['Tie remainder', calculation.tieRemainderMinor], ['Member remainder', calculation.memberRemainderMinor],
    ['Remaining unscheduled budget', calculation.remainingMinor], ['Over budget', calculation.overBudgetMinor],
  ] as const;
  return <section className="purse-results" aria-label={draft ? 'Unsaved purse projection' : 'Saved purse results'}>
    <h3>{draft ? 'Unsaved draft preview' : 'Individual winnings'} · {calculation.status}</h3>
    <p>Calculated and projected awards are not payments, transfers, or finalization. Partial or future outcomes are projected.</p>
    <p>{plan.funding.kind === 'fixed' ? `Fixed planned budget: ${money(plan.funding.budgetMinor)}`
      : `Planned buy-in: ${money(plan.funding.buyInMinor)} × ${String(value.workspace.roster.length)} current event golfers`}.</p>
    {calculation.status === 'unavailable' && <p role="status">Some awards are unavailable. Known partial shares remain shown; an unavailable total is not zero.</p>}
    {calculation.overBudgetMinor !== null && calculation.overBudgetMinor > 0 && <p className="purse-warning" role="status">
      Scheduled awards exceed the planned budget by {money(calculation.overBudgetMinor)}. No budget increase or automatic scaling has been applied.
    </p>}
    <dl className="purse-metrics">{metrics.map(([label, amount]) => <div key={label}><dt>{label}</dt><dd>{money(amount)}</dd></div>)}</dl>
    <p className="purse-hint">Budget is planned funding, not collected money. Scheduled = calculated + projected + unallocated.
      Unallocated includes reserved awards and indivisible tie/member cents. Remaining is unscheduled budget; overcommitment is separate.
      Unavailable inputs can prevent this complete reconciliation.</p>
    <div className="purse-pool-results">{plan.pools.map((pool) => {
      const result = calculation.pools.find((entry) => entry.poolId === pool.id);
      return <details key={pool.id}><summary>{pool.name} · {result?.status ?? 'unavailable'}</summary>
        <p>Source: {sourceChoices(value).find((choice) => choice.key === sourceKey(pool.source))?.label ?? 'Unavailable saved source'}.</p>
        <p>{pool.source.kind === 'manual' ? 'Manual pot, equally split among selected golfers'
          : pool.awardUnit === 'per-team' ? 'Each place is a team pot, split equally among its members'
            : 'Each place amount is per golfer, including each member when the entrant is a team'}.</p>
        {'prizes' in pool ? <>
          <ul>{pool.prizes.map((prize) => <li key={prize.place}>Place {prize.place}: {money(prize.amountMinor)}</li>)}</ul>
          <p>{pool.tiePolicy === 'pooled' ? 'Pooled occupied-place ties' : 'Organizer-resolved award ties; not a leaderboard tie-break'}.</p>
        </> : <p>Total pot: {money(pool.amountMinor)}. Recipients: {pool.recipientIds.map((id) =>
          value.workspace.roster.find((player) => player.playerId === id)?.displayName ?? 'Unavailable golfer').join(', ') || 'None selected'}.</p>}
        {result && <>
          <p>Scheduled: {money(result.scheduledMinor)} · Calculated: {money(result.allocatedMinor)} · Projected: {money(result.projectedMinor)}
            {' · '}Reserved: {money(result.reservedMinor)} · Unallocated: {money(result.unallocatedMinor)}</p>
          {result.reasons.map((reason) => <p key={reason}>{reason.replaceAll('-', ' ')}</p>)}
          {result.issues.map((issue, index) => <p key={`${issue.code}:${String(index)}`}>Unavailable: {issue.code.replaceAll('-', ' ')}</p>)}
        </>}
      </details>;
    })}</div>
    <label>Find winnings golfer<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label>
    <div className="purse-actions" aria-label="Winnings pages">
      <button type="button" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); }}>Previous winnings golfers</button>
      <span>Page {currentPage + 1} of {pages} · {filtered.length} golfers</span>
      <button type="button" disabled={currentPage + 1 >= pages} onClick={() => { setPage(currentPage + 1); }}>Next winnings golfers</button>
    </div>
    <div className="purse-scroll" role="region" aria-label="Individual winnings table" tabIndex={0}>
      <table><caption>Known individual shares across every award pool · {plan.currency}</caption>
        <thead><tr><th scope="col">Golfer</th><th scope="col">Calculated</th><th scope="col">Projected</th><th scope="col">Cumulative winnings</th><th scope="col">Per-pool breakdown</th></tr></thead>
        <tbody>{filtered.slice(currentPage * 12, currentPage * 12 + 12).map((player) => {
          const winnings = calculation.players.find((entry) => entry.playerId === player.playerId);
          return <tr key={player.playerId}><th scope="row">{player.displayName}</th>
            <td>{money(winnings?.allocatedMinor ?? null)}</td><td>{money(winnings?.projectedMinor ?? null)}</td>
            <td>{money(winnings?.totalMinor ?? null)}</td>
            <td><ul>{plan.pools.map((pool) => {
              const result = calculation.pools.find((entry) => entry.poolId === pool.id);
              const shares = result?.shares.filter((share) => share.playerId === player.playerId) ?? [];
              const exact = shares.reduce((sum, share) => sum + BigInt(share.amountMinor), 0n);
              const known = exact <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(exact) : null;
              return <li key={pool.id}>{pool.name}: {money(result?.status === 'unavailable' && shares.length === 0 ? null : known)}
                {' · '}{result?.status ?? 'unavailable'}
                {pool.awardUnit === 'per-team' && ' · team pot member share'}</li>;
            })}</ul></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {filtered.length === 0 && <p>No golfers match this search.</p>}
  </section>;
}
