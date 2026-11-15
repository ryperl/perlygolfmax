import { useRef, useState } from 'react';
import type { KpDecision, KpEntry, KpSelection } from '../../domain/kp';
import { calculateKp, calculateKpPayout, kpContext } from '../../domain/kp';
import type { RoundScores } from '../../domain/scoring';
import { scorePermissions } from '../../domain/scoring';
import { KpEntryButton } from './KpEntryButton';
import { kpEntryLabel } from './kp-presentation';
import { formatMoney } from '../purse';

export function KpPanel({ round, busy, dirty, groupNumber, holeNumber, onGroup, onHole, onEdit, draftFor,
  onSave, onDiscard, onManage, onPendingChange, onReview, onUseSaved }: {
  readonly round: RoundScores;
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly groupNumber: number;
  readonly holeNumber: number;
  readonly onGroup: (number: number) => void;
  readonly onHole: (number: number) => void;
  readonly onEdit: (playerId: string, value: KpEntry | null) => void;
  readonly draftFor: (playerId: string) => {
    readonly value: KpEntry | null | undefined;
    readonly savedValue: KpEntry | null | undefined;
    readonly dirty: boolean;
    readonly conflict: boolean;
    readonly canReview: boolean;
  };
  readonly onSave: () => void;
  readonly onDiscard: () => void;
  readonly onManage: (selection: KpSelection, etag: string | null, requestId: string) => Promise<void>;
  readonly onPendingChange: (pending: boolean) => void;
  readonly onReview: (playerId: string) => void;
  readonly onUseSaved: (playerId: string) => void;
}) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const attempt = useRef<{ readonly selection: KpSelection; readonly etag: string | null; readonly id: string } | null>(null);
  const permission = scorePermissions(round);
  const owner = permission.role === 'owner' && round.eventStatus === 'active';
  const results = calculateKp(round);
  const eligible = round.layout.filter((hole) => hole.par === 3);
  const payout = round.kpPot ? calculateKpPayout(round, round.kpPot.amountMinor) : null;
  const money = (amount: number) => round.kpPot ? formatMoney(amount, round.kpPot.currency) : 'Unavailable';
  async function manage(selection?: KpSelection) {
    if (busy || pending || dirty) return;
    if (!attempt.current && selection) attempt.current = { selection, etag: round.kp?.etag ?? null, id: crypto.randomUUID() };
    const request = attempt.current;
    if (!request) return;
    onPendingChange(true);
    setPending(true);
    setError('');
    try { await onManage(request.selection, request.etag, request.id); attempt.current = null; onPendingChange(false); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'KP settings were not confirmed. Refresh and retry.'); }
    finally { setPending(false); }
  }
  const locked = busy || pending || dirty || attempt.current !== null;
  const group = round.groups.find((entry) => entry.number === groupNumber);
  return <section className="kp-panel" aria-label="KP Competition">
    <h2>KP Competition</h2>
    <p>Closest on-green ball on each saved default-tee par 3. Enter only contenders; blank and No measurement are not zero or missed greens.</p>
    {round.kpEnabled !== true ? <p role="status">KP requires a newer API. Entry is unavailable.</p> : !eligible.length
      ? <p role="status">No par 3 holes in the saved default tee. KP is not configurable.</p>
      : !round.kp ? <>{owner && <button disabled={locked} onClick={() => { void manage({
        version: 1, context: kpContext(round.layout, round.cards.map((card) => card.playerId), round.kpCaptureIdentity), status: 'open', decisions: [],
      }); }}>Configure KP Competition</button>}<p>KP is not configured. The organizer can enable it without unlocking ordinary scores.</p></>
        : results.status === 'unavailable' ? <p role="alert">Saved KP layout or roster is stale. No entries or payouts can be changed until organizer review.</p>
          : <>
            <p role="status">{round.kp.status === 'open' ? 'Entries open · provisional results; absent entries are unknown.'
              : 'KP entries closed · ordinary golf scoring remains open.'}</p>
            <p>{round.kpPot ? `Round pot: ${money(round.kpPot.amountMinor)}. ${payout?.status === 'final' ? 'Fully allocated planned awards.' : 'Pending organizer review / closure; reserved amounts are not paid.'}`
              : 'No KP pot configured. Organizer: add a KP source in the event Purse editor (default unsaved input 100.00). No money has been added.'}</p>
            {owner && <button disabled={locked} onClick={() => { if (round.kp) void manage({
              version: 1, context: round.kp.context, status: round.kp.status === 'open' ? 'closed' : 'open',
              decisions: [],
            }); }}>{round.kp.status === 'open' ? 'Close KP entries' : 'Reopen KP entries'}</button>}
            <div className="kp-actions">
              <label>KP group<select disabled={busy || dirty} value={groupNumber} onChange={(event) => { onGroup(Number(event.target.value)); }}>
                {round.groups.map((entry) => <option key={entry.number} value={entry.number}>Group {entry.number}</option>)}
              </select></label>
              <label>KP hole<select disabled={busy || dirty} value={eligible.some((hole) => hole.number === holeNumber) ? holeNumber : ''}
                onChange={(event) => { onHole(Number(event.target.value)); }}>
                <option value="" disabled>Select a par 3</option>
                {eligible.map((hole) => <option key={hole.number} value={hole.number}>Hole {hole.number}</option>)}
              </select></label>
            </div>
            {eligible.some((hole) => hole.number === holeNumber) && <article aria-label="KP entry group">
              <h3>Hole {holeNumber} · Group {groupNumber}</h3>
              {group?.playerIds.map((playerId) => {
                const card = round.cards.find((entry) => entry.playerId === playerId);
                const draft = draftFor(playerId);
                return card && <div key={playerId}><KpEntryButton name={card.displayName} value={draft.value} draft={draft.dirty}
                  disabled={busy || round.kp?.status !== 'open' || !permission.writePlayerIds.includes(playerId)}
                  onChange={(value) => { onEdit(playerId, value); }} />
                  {draft.conflict && <>
                    <p role="alert">Hole changed. Saved KP: {kpEntryLabel(draft.savedValue)} · Intended KP: {kpEntryLabel(draft.value)}.
                      Refresh saved round before reviewing. A distance-only review preserves the current saved strokes.</p>
                    <button disabled={busy || !draft.canReview} onClick={() => { onReview(playerId); }}>Review KP for {card.displayName}</button>
                    <button disabled={busy} onClick={() => { onUseSaved(playerId); }}>Use saved hole for {card.displayName}</button>
                  </>}
                </div>;
              })}
              <div className="kp-actions">
                <button disabled={busy || !dirty || round.kp.status !== 'open'} onClick={onSave}>Save KP entries</button>
                <button disabled={busy || !dirty} onClick={onDiscard}>Discard all round drafts</button>
              </div>
              {dirty && <p role="status">Unsaved round drafts. Save acknowledges score and KP together; nothing is stored offline.</p>}
            </article>}
            {results.holes.map((hole) => {
              const amount = payout?.holes.find((entry) => entry.number === hole.number)?.amountMinor;
              return <article key={hole.number} aria-label={`KP hole ${String(hole.number)} results`}>
                <h3>Hole {hole.number}</h3>
                <p>{hole.closestPlayerIds.length ? `Closest: ${hole.closestPlayerIds.map((id) => round.cards.find((card) => card.playerId === id)?.displayName ?? 'Unavailable golfer').join(' / ')}${hole.closestPlayerIds.length > 1
                  ? payout?.shares.some((share) => share.holeNumber === hole.number) ? ' · tie resolved for planned awards' : ' · tied, organizer decision required' : ''}`
                  : round.kp?.status === 'closed' ? 'No qualifying measurement · excluded from daily pot shares.' : 'No measurement yet · pending.'}</p>
                <ul>{round.cards.flatMap((card) => {
                  const entry = card.holes.find((item) => item.number === hole.number)?.score.kp;
                  return entry ? [<li key={card.playerId}>{card.displayName}: {kpEntryLabel(entry)}</li>] : [];
                })}</ul>
                {amount !== undefined && <p>Winning hole share: {money(amount)} · planned, not paid</p>}
                {owner && round.kp?.status === 'closed' && hole.closestPlayerIds.length > 1 && amount !== undefined && <KpTie
                  key={`${hole.proof}:${String(amount)}`} ids={hole.closestPlayerIds} round={round} amount={amount}
                  disabled={locked} onResolve={(kind, playerIds, extraCentPlayerIds) => {
                    if (!round.kp) return;
                    const decision: KpDecision = { holeNumber: hole.number, proof: hole.proof, kind, playerIds, holeAmountMinor: amount, extraCentPlayerIds };
                    void manage({ version: 1, context: round.kp.context, status: 'closed',
                      decisions: [...round.kp.decisions.filter((entry) => entry.holeNumber !== hole.number
                        && results.holes.some((current) => current.number === entry.holeNumber && current.proof === entry.proof
                          && payout?.holes.some((prize) => prize.number === entry.holeNumber && prize.amountMinor === entry.holeAmountMinor))), decision] });
                  }} />}
                {payout?.shares.filter((share) => share.holeNumber === hole.number).map((share) =>
                  <p key={share.playerId}>{round.cards.find((card) => card.playerId === share.playerId)?.displayName}: {money(share.amountMinor)} planned award</p>)}
              </article>;
            })}
          </>}
    {error && <><p role="alert">{error}</p><p>Discarding intent does not undo a request that may already have committed. Refresh to review saved state.</p>
      <button disabled={pending || busy || dirty} onClick={() => { void manage(); }}>Retry same KP request</button>
      <button disabled={pending || busy} onClick={() => { attempt.current = null; setError(''); onPendingChange(false); }}>Discard unconfirmed KP management intent</button></>}
  </section>;
}

function KpTie({ ids, round, amount, disabled, onResolve }: {
  readonly ids: readonly string[];
  readonly round: RoundScores;
  readonly amount: number;
  readonly disabled: boolean;
  readonly onResolve: (kind: 'winner' | 'split', ids: readonly string[], extras: readonly string[]) => void;
}) {
  const [winner, setWinner] = useState('');
  const [extras, setExtras] = useState<readonly string[]>([]);
  const remainder = amount % ids.length;
  return <fieldset disabled={disabled}><legend>Resolve exact closest-distance tie</legend>
    <label>Chosen winner<select value={winner} onChange={(event) => { setWinner(event.target.value); }}>
      <option value="">Select a tied golfer</option>{ids.map((id) => <option key={id} value={id}>{round.cards.find((card) => card.playerId === id)?.displayName}</option>)}
    </select></label>
    <button disabled={disabled || !winner} onClick={() => { onResolve('winner', [winner], []); }}>Award chosen winner</button>
    <p>Or split equally. Explicitly choose {remainder} extra-cent recipient(s).</p>
    {ids.map((id) => <label className="kp-check" key={id}><input type="checkbox" checked={extras.includes(id)} onChange={(event) => {
      setExtras(event.target.checked ? [...extras, id] : extras.filter((entry) => entry !== id));
    }} />Extra cent: {round.cards.find((card) => card.playerId === id)?.displayName}</label>)}
    <button disabled={disabled || extras.length !== remainder} onClick={() => { onResolve('split', ids, extras); }}>Split tied hole prize</button>
  </fieldset>;
}
