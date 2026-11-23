import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { QuickRoundClient } from '../../client/quick-round';
import { PrivateRequestError } from '../../client/private-request';
import { isPublicPlayerInput } from '../../contracts/quick-round';
import type { PublicPlayerInput, QuickPlayer } from '../../domain/quick-round';

export function PublicPlayerForm({ create, disabled, available = true, onCreated, onBlockingChange }: {
  readonly create: QuickRoundClient['createPlayer'];
  readonly disabled: boolean;
  readonly available?: boolean;
  readonly onCreated: (player: QuickPlayer) => void;
  readonly onBlockingChange: (blocked: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [index, setIndex] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [attempt, setAttempt] = useState<{ readonly id: string; readonly input: PublicPlayerInput }>();
  const [knownRejected, setKnownRejected] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const created = useRef(onCreated);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const title = useId();
  const dirty = open && (name !== '' || index !== '' || Boolean(attempt));
  const blocked = open;
  useLayoutEffect(() => { created.current = onCreated; }, [onCreated]);
  useEffect(() => { onBlockingChange(blocked); return () => { onBlockingChange(false); }; }, [blocked, onBlockingChange]);
  useEffect(() => { if (open) heading.current?.focus(); }, [open]);
  useEffect(() => () => { pending.current?.abort(); }, []);
  useEffect(() => {
    if (!dirty) return;
    const leaveMessage = 'Discard new-player entries and leave? An unconfirmed creation may already exist. Stay and retry to confirm it.';
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const previousHash = window.location.hash;
    const navigate = (event: HashChangeEvent) => {
      if (window.location.hash === previousHash) return;
      if (!window.confirm(leaveMessage)) {
        event.stopImmediatePropagation();
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${previousHash}`);
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('hashchange', navigate, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('hashchange', navigate, true);
    };
  }, [dirty]);

  function close() {
    setOpen(false); setName(''); setIndex(''); setAttempt(undefined); setKnownRejected(false); setError(''); setConfirmClose(false);
    trigger.current?.focus();
  }
  async function submit() {
    if (!create || !attempt && (disabled || !available) || pending.current) return;
    const input = { displayName: name.trim(), handicapIndexValue: index.trim() };
    if (!isPublicPlayerInput(input)) { setError('Enter a name and a valid Handicap Index, including 0 or explicit +.'); return; }
    const changed = attempt && (attempt.input.displayName !== input.displayName || attempt.input.handicapIndexValue !== input.handicapIndexValue);
    const current = !attempt || changed && knownRejected ? { id: crypto.randomUUID(), input } : attempt;
    setAttempt(current);
    const controller = new AbortController();
    pending.current = controller; setBusy(true); setError('');
    try {
      const player = await create(current.input, current.id, controller.signal);
      if (!controller.signal.aborted) { created.current(player); close(); }
    } catch (failure) {
      if (!controller.signal.aborted) {
        // Validation/quota rejection happens before creation; uncertain responses must retain the exact attempt.
        setKnownRejected((!attempt || knownRejected) && failure instanceof PrivateRequestError && [400, 413, 429].includes(failure.status));
        setError(failure instanceof PrivateRequestError && failure.status === 429
          ? 'Too many requests. Wait before retrying. Your entries are kept.'
          : 'Player creation is not confirmed. Your entries are kept. Retry before creating another player.');
      }
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return <div className="quick-new-player" hidden={!available && !open}>
    <button ref={trigger} type="button" hidden={!available} disabled={disabled || open || !create} onClick={() => { setOpen(true); }}>New player</button>
    {open && <section className="quick-new-player-form" role="dialog" aria-labelledby={title} aria-busy={busy}>
      <h3 ref={heading} id={title} tabIndex={-1}>New shared player</h3>
      <p>Manual GHIN entry, not verified. Creating a player does not save the round.</p>
      <form aria-label="Create shared player" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label>Name<input required maxLength={100} autoComplete="off" disabled={busy || Boolean(attempt) && !knownRejected} value={name}
          onChange={(event) => { setName(event.target.value); }} /></label>
        <label>GHIN Handicap Index (as entered)<input required autoComplete="off" pattern={'\\+?(0|[1-9][0-9]?)(\\.[0-9])?'}
          disabled={busy || Boolean(attempt) && !knownRejected} value={index} onChange={(event) => { setIndex(event.target.value); }} /></label>
        {error && <p role="alert">{error}</p>}
        {attempt && !busy && !knownRejected && <p>These entries are held while creation is unconfirmed. Retry to confirm the same player.</p>}
        <div className="quick-actions">
          <button type="submit" disabled={!create || !attempt && (disabled || !available) || busy}>{busy ? 'Creating…' : attempt ? 'Retry player creation' : 'Create player'}</button>
          <button type="button" disabled={busy} onClick={() => { if (dirty) setConfirmClose(true); else close(); }}>Cancel new player</button>
        </div>
      </form>
      {confirmClose && <div role="alert">
        <p>Discard these entries? An unconfirmed creation may already exist; discarding does not undo it.</p>
        <div className="quick-actions"><button type="button" onClick={() => { setConfirmClose(false); }}>Keep entries</button>
          <button type="button" onClick={close}>Discard entries</button></div>
      </div>}
    </section>}
  </div>;
}
