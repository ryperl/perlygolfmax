import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CatalogClient, ManualIndexInput } from '../../client/catalog';
import type { SetupClient } from '../../client/setup';
import type { PlayerProfile } from '../../domain/catalog';
import type { EventHandicapRefreshResult } from '../../domain/player-handicap-update';
import { isHandicapIndex } from '../../contracts/catalog';
import { defaultManualIndex } from '../../client/manual-index';
import { SessionExpiredError } from '../../client/events';
import { PrivateRequestError } from '../../client/private-request';
import './catalog.css';

interface Props {
  readonly client: CatalogClient;
  readonly setup: Pick<SetupClient, 'load'>;
  readonly eventId: string;
  readonly playerId: string;
  readonly displayName: string;
  readonly onSaved: (result: EventHandicapRefreshResult) => void;
  readonly onClose: () => void;
  readonly onSessionExpired: (message: string) => void;
}

interface PendingUpdate {
  readonly input: ManualIndexInput;
  readonly observationId: string;
  readonly eventRequestId: string;
  readonly player: PlayerProfile;
  readonly eventRevision: string;
  catalogConfirmed: boolean;
  reviewRequired?: true;
}

export function PlayerHandicapDialog(props: Props) {
  const [scope, setScope] = useState({ client: props.client, setup: props.setup, generation: 0 });
  if (scope.client !== props.client || scope.setup !== props.setup) {
    setScope({ client: props.client, setup: props.setup, generation: scope.generation + 1 });
  }
  return <PlayerHandicapController key={`${props.eventId}:${props.playerId}:${String(scope.generation)}`} {...props} />;
}

function PlayerHandicapController({ client, setup, eventId, playerId, displayName, onSaved, onClose, onSessionExpired }: Props) {
  const [player, setPlayer] = useState<PlayerProfile>();
  const [revision, setRevision] = useState('');
  const [value, setValue] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [catalogConfirmed, setCatalogConfirmed] = useState(false);
  const pending = useRef<PendingUpdate | null>(null);
  const request = useRef<AbortController | null>(null);
  const live = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const expiry = useRef(onSessionExpired);
  const id = useId();
  useLayoutEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { expiry.current = onSessionExpired; }, [onSessionExpired]);
  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    request.current = controller;
    void Promise.all([client.player(playerId, controller.signal), setup.load(eventId, controller.signal)])
      .then(([profile, workspace]) => {
        if (controller.signal.aborted) return;
        if (profile.id !== playerId || workspace.event.id !== eventId
          || workspace.event.status !== 'active' || !workspace.roster.some((entry) => entry.playerId === playerId)) {
          throw new Error('This player is no longer available for an active-event update.');
        }
        setPlayer(profile); setRevision(workspace.etag);
        if (attempt === 0) setValue(profile.currentIndex?.value ?? '');
        else setNotice(`Current saved HI: ${profile.currentIndex?.value ?? 'Unknown'}. Your entry is retained; review before saving.`);
        const previous = pending.current;
        if (attempt > 0 && previous?.catalogConfirmed
          && profile.currentIndex?.id === previous.observationId
          && profile.currentIndex.value === previous.input.value
          && profile.currentIndex.effectiveDate === previous.input.effectiveDate
          && profile.currentIndex.source === previous.input.source) {
          pending.current = { input: previous.input, observationId: previous.observationId,
            eventRequestId: crypto.randomUUID(), player: profile, eventRevision: workspace.etag, catalogConfirmed: true };
          setCatalogConfirmed(true);
        } else {
          pending.current = null; setCatalogConfirmed(false);
        }
      }).catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        const message = failure instanceof Error ? failure.message : 'Could not load this player.';
        setError(message);
        if (failure instanceof SessionExpiredError
          || failure instanceof PrivateRequestError && [401, 403, 404].includes(failure.status)) {
          setPlayer(undefined); setValue(''); pending.current = null;
          expiry.current(message);
        }
      }).finally(() => {
        if (!controller.signal.aborted) { request.current = null; setBusy(false); }
      });
    return () => { live.current = false; controller.abort(); request.current?.abort(); };
  }, [client, setup, eventId, playerId, attempt]);
  useEffect(() => {
    if (!busy && player) { input.current?.focus(); input.current?.select(); }
  }, [busy, player]);
  useEffect(() => {
    if (!busy && !pending.current) return;
    function beforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); }
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('beforeunload', beforeUnload); };
  }, [busy]);
  function close() {
    if (busy) return;
    dialog.current?.close(); onClose();
  }
  async function save() {
    if (busy || request.current || !player || !revision || pending.current?.reviewRequired) return;
    if (!isHandicapIndex(value.trim())) { setError('Enter a valid Handicap Index, including + for a plus index.'); return; }
    if (!pending.current) pending.current = { input: defaultManualIndex(value), player,
      observationId: crypto.randomUUID(), eventRequestId: crypto.randomUUID(),
      eventRevision: revision, catalogConfirmed: false };
    const operation = pending.current;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(''); setNotice('');
    try {
      if (!operation.catalogConfirmed) {
        const updated = await client.recordIndex(operation.player, operation.input, operation.observationId, controller.signal);
        controller.signal.throwIfAborted();
        operation.catalogConfirmed = true;
        setCatalogConfirmed(true);
        if (updated.currentIndex?.id !== operation.observationId
          || updated.currentIndex.value !== operation.input.value
          || updated.currentIndex.effectiveDate !== operation.input.effectiveDate
          || updated.currentIndex.source !== operation.input.source) {
          operation.reviewRequired = true;
          throw new Error('A different current index was returned. Reload and review before updating any round.');
        }
      }
      const result = await client.refreshEventIndex(eventId, playerId, operation.observationId,
        operation.eventRevision, operation.eventRequestId, controller.signal);
      if (!live.current || controller.signal.aborted) return;
      pending.current = null;
      dialog.current?.close(); onSaved(result);
    } catch (failure) {
      if (!live.current || controller.signal.aborted) return;
      const message = failure instanceof Error ? failure.message : 'The update was not confirmed.';
      const outcome = operation.catalogConfirmed
        ? 'Player HI saved; updates to unfinished rounds were not confirmed.'
        : 'Player HI update was not confirmed.';
      setError(`${outcome} ${message}`);
      if (failure instanceof SessionExpiredError
        || failure instanceof PrivateRequestError && [401, 403, 404].includes(failure.status)) {
        setPlayer(undefined); setValue(''); pending.current = null;
        expiry.current(`${outcome} ${message}`);
      }
    } finally {
      if (live.current && !controller.signal.aborted) { request.current = null; setBusy(false); }
    }
  }
  return <dialog ref={dialog} className="player-handicap-dialog" aria-labelledby={`${id}-heading`}
    onCancel={(event) => { event.preventDefault(); close(); }}>
    <h2 id={`${id}-heading`}>{displayName} · Handicap Index</h2>
    <p className="catalog-hint">Updates current HI and unfinished rounds in this event. Completed rounds keep their saved HI.</p>
    <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label>Handicap Index<input ref={input} value={value} required autoComplete="off"
        disabled={busy || !player || pending.current !== null}
        onChange={(event) => { setValue(event.target.value); setError(''); setNotice(''); }} /></label>
      {busy && <p role="status">{catalogConfirmed ? 'Updating unfinished rounds…' : 'Contacting player service…'}</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="catalog-toolbar">
        <button type="submit" disabled={busy || !player || pending.current?.reviewRequired}>{pending.current ? 'Retry update' : 'Save HI'}</button>
        <button type="button" disabled={busy} onClick={close}>Close</button>
        {error && <button type="button" disabled={busy} onClick={() => {
          setBusy(true); setPlayer(undefined); setError(''); setNotice(''); setAttempt((previous) => previous + 1);
        }}>Reload and review</button>}
      </div>
    </form>
  </dialog>;
}
