import { useId, useState } from 'react';
import type { EventPurseView } from '../../domain/purse-settings';
import { purseCurrencies } from '../../domain/purse';
import type { PursePlan, PurseTieResolution } from '../../domain/purse';
import type { PoolDraft, PurseDraft, SourceChoice } from './purse-draft';
import { newPool, selectSource, sourceChoices, sourceKey } from './purse-draft';
import type { AwardTie } from './purse-ties';
import { currentTies, matchesTie } from './purse-ties';

interface RecipientProps {
  readonly value: EventPurseView;
  readonly pool: PoolDraft;
  readonly onChange: (pool: PoolDraft) => void;
}

function Recipients({ value, pool, onChange }: RecipientProps) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const roster = value.workspace.roster;
  const filtered = roster.filter((player) => player.displayName.toLowerCase().includes(query.toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 12));
  const currentPage = Math.min(page, pages - 1);
  const selected = pool.recipientIds.map((id) => roster.find((player) => player.playerId === id)?.displayName ?? 'Unavailable golfer');
  return <div className="purse-recipients">
    <p>{pool.recipientIds.length} recipients selected: {selected.join(', ') || 'None; the entire pot remains reserved.'}</p>
    <label>Find recipients for {pool.name || 'new pool'}<input type="search" value={query} onChange={(event) => {
      setQuery(event.target.value); setPage(0);
    }} /></label>
    <div className="purse-checks">{filtered.slice(currentPage * 12, currentPage * 12 + 12).map((player) =>
      <label key={player.playerId}><input type="checkbox" checked={pool.recipientIds.includes(player.playerId)}
        onChange={(event) => { onChange({ ...pool, recipientIds: event.target.checked
          ? [...pool.recipientIds, player.playerId] : pool.recipientIds.filter((id) => id !== player.playerId) }); }} />{player.displayName}</label>)}</div>
    <div className="purse-actions">
      <button type="button" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); }}>Previous recipients</button>
      <span>Page {currentPage + 1} of {pages} · {filtered.length} golfers</span>
      <button type="button" disabled={currentPage + 1 >= pages} onClick={() => { setPage(currentPage + 1); }}>Next recipients</button>
    </div>
    {pool.recipientIds.some((id) => !roster.some((player) => player.playerId === id)) && <button type="button"
      onClick={() => { onChange({ ...pool, recipientIds: pool.recipientIds.filter((id) => roster.some((player) => player.playerId === id)) }); }}>
      Remove unavailable recipients
    </button>}
  </div>;
}

function TieOrder({ tie, current, onApply }: {
  readonly tie: AwardTie; readonly current: PurseTieResolution | undefined;
  readonly onApply: (resolution: PurseTieResolution) => void;
}) {
  const [order, setOrder] = useState<readonly string[]>(current?.orderedEntrantIds ?? tie.entrants.map(() => ''));
  const valid = order.length === tie.entrants.length && new Set(order).size === tie.entrants.length
    && order.every((id) => tie.entrants.some((entrant) => entrant.id === id));
  return <fieldset><legend>Tied place {tie.rank} · choose award order</legend>
    <p>{tie.entrants.map((entrant) => entrant.name).join(', ')}. This decides this pool only, not the leaderboard.</p>
    {tie.entrants.map((entrant, index) => <label key={entrant.id}>Award position {tie.rank + index}
      <select value={order[index] ?? ''} onChange={(event) => {
        setOrder(order.map((id, offset) => offset === index ? event.target.value : id));
      }}><option value="">Choose tied entrant</option>{tie.entrants.map((option) =>
        <option key={option.id} value={option.id}>{option.name}</option>)}</select>
    </label>)}
    <button type="button" disabled={!valid} onClick={() => {
      if (valid) onApply({ poolId: tie.poolId, rank: tie.rank, orderedEntrantIds: order });
    }}>Use this award order</button>
  </fieldset>;
}

export interface PurseSettingsProps {
  readonly value: EventPurseView;
  readonly draft: PurseDraft;
  readonly plan: PursePlan | null;
  readonly resolutions: readonly PurseTieResolution[];
  readonly disabled: boolean;
  readonly onChange: (draft: PurseDraft) => void;
  readonly onResolutions: (resolutions: readonly PurseTieResolution[]) => void;
}

export function PurseSettings({ value, draft, plan, resolutions, disabled, onChange, onResolutions }: PurseSettingsProps) {
  const id = useId();
  const choices = sourceChoices(value);
  const ties = plan ? currentTies(plan, value) : [];
  function changePool(next: PoolDraft) {
    onChange({ ...draft, pools: draft.pools.map((pool) => pool.id === next.id ? next : pool) });
  }
  function sourceOptions(pool: PoolDraft): readonly SourceChoice[] {
    return choices.some((choice) => choice.key === sourceKey(pool.source)) ? choices : [
      { key: sourceKey(pool.source), label: 'Unavailable saved source — choose a replacement', source: pool.source, team: pool.awardUnit === 'per-team' },
      ...choices,
    ];
  }
  return <fieldset className="purse-settings" disabled={disabled}>
    <legend>Unsaved purse settings</legend>
    <p>Changes below are a draft until saved. Removing a pool changes purse configuration only; it never deletes live scores.</p>
    <div className="purse-fields">
      <label>Currency<select value={draft.currency} onChange={(event) => { onChange({ ...draft, currency: event.target.value }); }}>
        {purseCurrencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
      </select></label>
      <label>Planned funding<select value={draft.funding} onChange={(event) => { onChange({ ...draft, funding: event.target.value }); }}>
        <option value="fixed">Fixed planned budget</option><option value="buy-in">Buy-in × current event roster</option>
      </select></label>
      <label>{draft.funding === 'fixed' ? 'Planned budget amount' : 'Planned buy-in per golfer'}
        <input inputMode="decimal" value={draft.amount} onChange={(event) => { onChange({ ...draft, amount: event.target.value }); }} />
      </label>
    </div>
    <p className="purse-hint">Two decimal places maximum. No currency conversion. Changing currency relabels amounts; it does not convert them.
      {draft.funding === 'buy-in' && ` Buy-in uses all ${String(value.workspace.roster.length)} current event golfers, not collected payments.`}</p>
    {!value.workspace.overallCompetition && <p>Overall awards are unavailable until an overall competition is configured.</p>}
    {draft.pools.map((pool, index) => {
      const options = sourceOptions(pool);
      const team = choices.find((choice) => choice.key === sourceKey(pool.source))?.team ?? pool.awardUnit === 'per-team';
      const poolTies = ties.filter((tie) => tie.poolId === pool.id);
      const decisions = resolutions.filter((entry) => entry.poolId === pool.id);
      return <details className="purse-pool-editor" key={pool.id} open>
        <summary>Pool {index + 1}: {pool.name || 'New award pool'}</summary>
        <div className="purse-fields">
          <label htmlFor={`${id}-${pool.id}-name`}>Pool {index + 1} name</label>
          <input id={`${id}-${pool.id}-name`} maxLength={100} value={pool.name}
            onChange={(event) => { changePool({ ...pool, name: event.target.value }); }} />
          <label>Pool {index + 1} source<select value={sourceKey(pool.source)} onChange={(event) => {
            const choice = choices.find((entry) => entry.key === event.target.value);
            if (choice) changePool(selectSource(pool, choice));
          }}>{options.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
            {!value.workspace.overallCompetition && pool.source.kind !== 'overall' && <option value="overall" disabled>Overall competition (not configured)</option>}
          </select></label>
        </div>
        {pool.source.kind === 'manual' ? <>
          <label>Pool {index + 1} total pot amount<input inputMode="decimal" value={pool.amount}
            onChange={(event) => { changePool({ ...pool, amount: event.target.value }); }} /></label>
          <p>One pot, equally split among the explicitly selected roster recipients. Indivisible cents stay unallocated.</p>
          <Recipients pool={pool} value={value} onChange={changePool} />
        </> : <>
          {team ? <label>Pool {index + 1} award amount unit<select value={pool.awardUnit} onChange={(event) => {
            changePool({ ...pool, awardUnit: event.target.value });
          }}><option value="per-team">Per team · pot split among all team members</option>
            <option value="per-golfer">Per golfer · each team member receives this amount</option></select></label>
            : <p>Each place amount is per golfer.</p>}
          <label>Pool {index + 1} tie policy<select value={pool.tiePolicy} onChange={(event) => {
            changePool({ ...pool, tiePolicy: event.target.value });
          }}><option value="pooled">Pool occupied-place prizes and split equally</option>
            <option value="organizer">Organizer decides tied entrant award order</option></select></label>
          <p className="purse-hint">Default: tied second splits the second + third place pot. Remainder cents are unallocated, never awarded by roster order.</p>
          {pool.prizes.map((prize, prizeIndex) => <div className="purse-prize" key={prizeIndex}>
            <label>Pool {index + 1} prize {prizeIndex + 1} place<input inputMode="numeric" value={prize.place}
              onChange={(event) => { changePool({ ...pool, prizes: pool.prizes.map((entry, offset) =>
                offset === prizeIndex ? { ...entry, place: event.target.value } : entry) }); }} /></label>
            <label>Pool {index + 1} prize {prizeIndex + 1} amount<input inputMode="decimal" value={prize.amount}
              onChange={(event) => { changePool({ ...pool, prizes: pool.prizes.map((entry, offset) =>
                offset === prizeIndex ? { ...entry, amount: event.target.value } : entry) }); }} /></label>
            <button type="button" onClick={() => { changePool({ ...pool, prizes: pool.prizes.filter((_, offset) => offset !== prizeIndex) }); }}>
              Remove prize {prizeIndex + 1} from pool {index + 1}
            </button>
          </div>)}
          <button type="button" onClick={() => { changePool({ ...pool, prizes: [...pool.prizes, { place: '', amount: '0.00' }] }); }}>
            Add place prize to pool {index + 1}
          </button>
          {poolTies.map((tie) => {
            const current = decisions.find((entry) => matchesTie(entry, tie));
            return <TieOrder key={`${String(tie.rank)}:${tie.entrants.map((entry) => entry.id).join(':')}:${current?.orderedEntrantIds.join(':') ?? ''}`}
              tie={tie} current={current} onApply={(decision) => { onResolutions([
                ...resolutions.filter((entry) => entry.poolId !== decision.poolId || entry.rank !== decision.rank), decision,
              ]); }} />;
          })}
        </>}
        {decisions.map((decision, decisionIndex) => {
          const valid = poolTies.some((tie) => matchesTie(decision, tie));
          const friendly = decision.orderedEntrantIds.map((entrantId) =>
            poolTies.flatMap((tie) => tie.entrants).find((entrant) => entrant.id === entrantId)?.name
              ?? value.workspace.roster.find((player) => player.playerId === entrantId)?.displayName
              ?? 'Former or unavailable entrant');
          return <div className={valid ? '' : 'purse-warning'} key={`${String(decision.rank)}:${String(decisionIndex)}`}>
            <p>{valid ? 'Current' : 'Stale or unavailable'} award decision · place {decision.rank}: {friendly.join(' → ')}.
              {!valid && ' Remove this decision, then re-resolve the current tied set. Scores may have changed.'}</p>
            <button type="button" onClick={() => { onResolutions(resolutions.filter((entry) => entry !== decision)); }}>
              Remove {valid ? 'current' : 'stale'} decision for pool {index + 1} place {decision.rank}
            </button>
          </div>;
        })}
        <button type="button" onClick={() => {
          onChange({ ...draft, pools: draft.pools.filter((entry) => entry.id !== pool.id) });
          onResolutions(resolutions.filter((entry) => entry.poolId !== pool.id));
        }}>Remove pool {index + 1}</button>
      </details>;
    })}
    {resolutions.some((decision) => !draft.pools.some((pool) => pool.id === decision.poolId)) && <div className="purse-warning">
      <p>Stale decisions refer to removed pools.</p>
      <button type="button" onClick={() => { onResolutions(resolutions.filter((entry) => draft.pools.some((pool) => pool.id === entry.poolId))); }}>
        Remove decisions for missing pools
      </button>
    </div>}
    <button type="button" onClick={() => { onChange({ ...draft, pools: [...draft.pools, newPool(crypto.randomUUID())] }); }}>Add award pool</button>
  </fieldset>;
}
