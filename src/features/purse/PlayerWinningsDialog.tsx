import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { PlayerWinningsBreakdown, WinningsPart } from '../../domain/winnings-breakdown';
import type { PurseCurrency } from '../../domain/purse';
import type { PublicPurseSummary } from '../../domain/public-purse';
import { SessionExpiredError } from '../../client/events';
import { formatMoney } from './money';

function explanation(part: WinningsPart, currency: PurseCurrency): string {
  switch (part.kind) {
    case 'place': return `Place ${String(part.tiePolicy === 'organizer' ? part.awardPlace : part.rank)}`
      + (part.tiedEntrants > 1 ? ` · ${String(part.tiedEntrants)} tied, ${part.tiePolicy === 'pooled' ? 'pooled prizes' : 'organizer resolved'}` : '')
      + (part.teamName ? ` · ${part.teamName}, ${String(part.memberCount)} members` : '');
    case 'kp': return `Hole ${String(part.holeNumber)} · ${String(Math.floor(part.distanceInches / 12))} ft ${String(part.distanceInches % 12)} in`
      + (part.resolution === 'selected' ? ' · organizer-selected tied winner' : part.splitCount > 1 ? ` · split ${String(part.splitCount)} ways` : '');
    case 'event-skins': return `${String(part.skins)} skins × ${formatMoney(part.perSkinMinor, currency)}`;
    case 'manual': return `Designated award · ${String(part.recipientCount)} ${part.recipientCount === 1 ? 'recipient' : 'equal recipients'}`;
  }
}

export function PlayerWinningsDialog({ eventId, player, currency, load, onClose, onSessionExpired }: {
  readonly eventId: string;
  readonly player: PublicPurseSummary['players'][number];
  readonly currency: PurseCurrency;
  readonly load: (playerId: string, signal: AbortSignal) => Promise<PlayerWinningsBreakdown>;
  readonly onClose: () => void;
  readonly onSessionExpired: (message: string) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ readonly attempt: number; readonly value?: PlayerWinningsBreakdown; readonly error?: string }>();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const expiry = useRef(onSessionExpired);
  const id = useId();
  const current = result?.attempt === attempt ? result : undefined;
  useLayoutEffect(() => { dialog.current?.showModal(); heading.current?.focus(); }, []);
  useEffect(() => { expiry.current = onSessionExpired; }, [onSessionExpired]);
  useEffect(() => {
    const controller = new AbortController();
    void load(player.playerId, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      if (value.eventId !== eventId || value.playerId !== player.playerId) throw new Error('Winnings did not match this player and event.');
      setResult({ attempt, value });
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      const error = failure instanceof Error ? failure.message : 'Player winnings could not be loaded.';
      setResult({ attempt, error });
      if (failure instanceof SessionExpiredError) expiry.current(error);
    });
    return () => { controller.abort(); };
  }, [eventId, player.playerId, load, attempt]);
  const value = current?.value;
  function close() { dialog.current?.close(); onClose(); }
  return <dialog ref={dialog} className="purse-winnings-dialog" aria-labelledby={`${id}-title`} onCancel={(event) => {
    event.preventDefault(); close();
  }}>
    <header><h2 id={`${id}-title`} tabIndex={-1} ref={heading}>{player.displayName} · Winnings</h2>
      <button type="button" onClick={close}>Close winnings</button></header>
    {!current && <p role="status">Loading winnings breakdown…</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {value && <>
      {(value.amountMinor !== player.amountMinor || value.currency !== currency || value.displayName !== player.displayName
        || value.awards.length !== player.poolIds.length || value.awards.some((award) => !player.poolIds.includes(award.poolId)))
        && <p role="status">Newer winnings are shown. Refresh the purse to update the player sheet.</p>}
      <p className="purse-winnings">{value.currency === null ? 'No purse configured'
        : value.amountMinor === null ? 'Total unavailable' : formatMoney(value.amountMinor, value.currency)}</p>
      {value.needsReview && <p role="status">Some award details need organizer review.</p>}
      {value.currency !== null && value.awards.length > 0 && <div className="purse-scroll purse-award-details"
        role="region" aria-label="Winnings breakdown details" tabIndex={0}>
        <table className="purse-award-table">
          <caption className="visually-hidden">Allocated winnings by pool</caption>
          <thead><tr><th scope="col">Award / detail</th><th scope="col">Won</th></tr></thead>
          {value.awards.map((award) => <tbody key={award.poolId}>
            <tr className="purse-award-pool"><th scope="rowgroup" colSpan={2}>{award.poolName}
              {award.roundName && <small>{award.roundName}</small>}
            </th></tr>
            {award.parts.map((part, index) => <tr key={index}>
              <th scope="row">{explanation(part, value.currency ?? currency)}</th>
              <td>{formatMoney(part.amountMinor, value.currency ?? currency)}</td>
            </tr>)}
            {(award.parts.length !== 1 || award.parts[0]?.amountMinor !== award.amountMinor) && <tr className="purse-award-subtotal">
              <th scope="row">Pool subtotal</th><td>{formatMoney(award.amountMinor, value.currency ?? currency)}</td>
            </tr>}
          </tbody>)}
        </table>
      </div>}
      {value.awards.length === 0 && value.amountMinor === 0 && <p>No allocated winnings.</p>}
      {(value.pendingPools > 0 || value.unavailablePools > 0) && <p className="purse-hint">
        {value.pendingPools} pending pools · {value.unavailablePools} unavailable. Not included above.</p>}
      <p className="purse-hint">Latest saved awards, not payment history. Rounding remainders stay unallocated.</p>
    </>}
    <button type="button" disabled={!current} onClick={() => { setAttempt((previous) => previous + 1); }}>Refresh winnings</button>
  </dialog>;
}
