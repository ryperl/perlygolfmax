import { useEffect, useRef, useState } from 'react';
import type { CatalogClient, ManualIndexInput } from '../../client/catalog';
import type { PlayerIndexHistory, PlayerProfile } from '../../domain/catalog';
import { defaultManualIndex } from '../../client/manual-index';
import { useOperation } from './useOperation';

export function PlayerEditor({ client, player, onSaved, onBusy, onDirty, blocked, onClose }: {
  readonly client: CatalogClient;
  readonly player: PlayerProfile;
  readonly onSaved: (player: PlayerProfile) => void;
  readonly onBusy: (busy: boolean) => void;
  readonly onDirty: (dirty: boolean) => void;
  readonly blocked: boolean;
  readonly onClose: () => void;
}) {
  const [section, setSection] = useState<'profile' | 'handicap' | 'history'>('profile');
  const [confirmClose, setConfirmClose] = useState(false);
  const [name, setName] = useState(player.displayName);
  const [value, setValue] = useState('');
  const [date, setDate] = useState<string>();
  const [source, setSource] = useState<string>();
  const [correction, setCorrection] = useState(false);
  const [history, setHistory] = useState<PlayerIndexHistory | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [settledHistoryClient, setSettledHistoryClient] = useState<CatalogClient | null>(null);
  const initialHistoryPending = settledHistoryClient !== client;
  const pending = useRef<{ readonly key: string; readonly id: string; readonly input: ManualIndexInput } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focused = useRef(false);
  const { busy, notice, conflict, run, setNotice, setConflict } = useOperation();
  const controlsBusy = busy || initialHistoryPending || blocked;
  const dirty = name !== player.displayName || value !== '' || date !== undefined || source !== undefined || correction;
  const defaults = defaultManualIndex(value);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (!controlsBusy && !focused.current) { heading.current?.focus(); focused.current = true; }
  }, [controlsBusy]);
  useEffect(() => { onBusy(busy || initialHistoryPending); }, [busy, initialHistoryPending, onBusy]);
  useEffect(() => {
    const controller = new AbortController();
    void client.history(player.id, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setHistory(result); setHistoryError(''); }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : 'Could not load history.');
    }).finally(() => {
      if (!controller.signal.aborted) setSettledHistoryClient(client);
    });
    return () => { controller.abort(); };
  }, [client, player.id]);
  return <section id={`player-editor-${player.id}`} className="catalog-form player-editor" aria-label="Player editor" aria-busy={controlsBusy}>
    <div className="catalog-editor-heading"><div><p className="catalog-eyebrow">Saved player</p>
      <h3 ref={heading} tabIndex={-1}>Edit saved player: {player.displayName}</h3></div>
      <button disabled={controlsBusy} onClick={() => { if (dirty) setConfirmClose(true); else onClose(); }}>Close player editor</button></div>
    <p className="catalog-current-index">Current HI: <strong>{player.currentIndex?.value ?? 'Unknown'}</strong>
      {player.currentIndex && <span> · effective {player.currentIndex.effectiveDate}</span>}</p>
    {confirmClose && <div className="catalog-confirm" role="alert">
      <p>Discard local edits and close? This does not undo a request that may already have saved.</p>
      <div className="catalog-toolbar"><button disabled={controlsBusy} onClick={() => { setConfirmClose(false); }}>Keep editing</button>
        <button disabled={controlsBusy} onClick={onClose}>Discard changes and close</button></div>
    </div>}
    <div className="catalog-editor-tabs" role="group" aria-label="Player editor sections" hidden={confirmClose}>
      {(['profile', 'handicap', 'history'] as const).map((tab) => <button key={tab} type="button" disabled={busy || blocked}
        aria-pressed={section === tab} onClick={() => { focused.current = true; setSection(tab); }}>
        {tab === 'profile' ? 'Profile' : tab === 'handicap' ? 'Handicap' : 'History'}</button>)}
    </div>
    <button className="catalog-secondary" hidden={confirmClose} disabled={controlsBusy} onClick={() => { void run(async (signal) => {
      let cursor: string | undefined;
      const seen = new Set<string>();
      let found: PlayerProfile | undefined;
      do {
        const page = await client.players(signal, cursor);
        found = page.players.find((item) => item.id === player.id);
        cursor = page.continuationToken;
        if (cursor && seen.has(cursor)) throw new Error('Invalid player paging response.');
        if (cursor) seen.add(cursor);
      } while (!found && cursor);
      if (!found) throw new Error('Player no longer available. Draft preserved.');
      const refreshed = await client.history(player.id, signal);
      if (!signal.aborted) { onSaved(found); setHistory(refreshed); setHistoryError(''); setConflict(false); setCorrection(false); setNotice('Player revision and history refreshed. Draft preserved; review before saving.'); }
    }); }}>Refresh player and history</button>
    <form className="catalog-form" hidden={confirmClose || section !== 'profile'} onSubmit={(event) => {
      event.preventDefault();
      if (controlsBusy || conflict) return;
      void run(async (signal) => {
        const updated = await client.renamePlayer(player, name.trim(), signal);
        if (!signal.aborted) { onSaved(updated); setNotice('Player name saved. Existing round snapshots are unchanged.'); }
      });
    }}>
      <label>Saved player name<input required maxLength={100} disabled={controlsBusy} value={name} onChange={(event) => { setName(event.target.value); }} /></label>
      <button className="catalog-primary" disabled={controlsBusy || conflict || name.trim() === player.displayName}>Save player name</button>
    </form>
    <form className="catalog-form" hidden={confirmClose || section !== 'handicap'} onSubmit={(event) => {
      event.preventDefault();
      if (controlsBusy || conflict || !correction) return;
      void run(async (signal) => {
        const key = JSON.stringify({ value: value.trim(), date, source });
        if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID(),
          input: { ...defaultManualIndex(value), ...(date === undefined ? {} : { effectiveDate: date }),
            ...(source === undefined ? {} : { source: source.trim() }) } };
        const updated = await client.recordIndex(player, pending.current.input, pending.current.id, signal);
        signal.throwIfAborted();
        onSaved(updated); pending.current = null; setCorrection(false); setValue(''); setDate(undefined); setSource(undefined);
        setNotice('Manual index observation saved. Captured round inputs are unchanged.');
        setHistory(null);
        try {
          const result = await client.history(player.id, signal);
          if (!signal.aborted) { setHistory(result); setHistoryError(''); }
        } catch {
          if (!signal.aborted) setHistoryError('Observation saved, but history could not be refreshed. Refresh player and history.');
        }
      });
    }}>
      <p className="catalog-hint">Today and GHIN are filled in for manual entry, not automatic GHIN verification. Use The Group to also update unfinished rounds in an event.</p>
      <label>Handicap index (explicit + supported)<input required pattern={'\\+?(0|[1-9][0-9]?)(\\.[0-9])?'} disabled={controlsBusy} value={value} onChange={(event) => { setValue(event.target.value); setCorrection(false); }} /></label>
      <label>Effective date<input required type="date" disabled={controlsBusy} value={date ?? defaults.effectiveDate} onChange={(event) => { setDate(event.target.value); setCorrection(false); }} /></label>
      <label>Manual source<input required maxLength={200} disabled={controlsBusy} value={source ?? defaults.source} onChange={(event) => { setSource(event.target.value); setCorrection(false); }} /></label>
      <label className="catalog-check"><input type="checkbox" disabled={controlsBusy || conflict} checked={correction} onChange={(event) => { setCorrection(event.target.checked); }} />I confirm this manual observation, including replacing any observation on the same effective date.</label>
      <button className="catalog-primary" disabled={controlsBusy || conflict || !correction}>Save manual index</button>
    </form>
    <section hidden={confirmClose || section !== 'history'} className="catalog-form" aria-label="Handicap history">
      <h4>Audited index history</h4>
      {history === null && !historyError && <p role="status">Loading history...</p>}
      {history?.observations.length === 0 && <p>No handicap observations. Current index is unknown.</p>}
      <ol className="catalog-history">{history?.observations.map((observation) => <li key={observation.id}>
        <p><strong>{observation.value}</strong> — effective {observation.effectiveDate}; {observation.source}</p>
        <details className="catalog-technical"><summary>Observation details</summary>
          <p>Recorded {observation.recordedAt}</p><p className="catalog-version">recorded by {'tenantId' in observation.recordedBy
            ? `${observation.recordedBy.tenantId}/${observation.recordedBy.objectId}` : 'unverified public player creation'}
            {observation.previousObservationId ? `; previous audit entry ${observation.previousObservationId}` : ''}</p>
        </details>
      </li>)}</ol>
      {history?.continuationToken && <button disabled={controlsBusy} onClick={() => { void run(async (signal) => {
        const page = await client.history(player.id, signal, history.continuationToken);
        if (!signal.aborted) setHistory({ ...page, observations: [...history.observations, ...page.observations] });
      }); }}>More index history</button>}
    </section>
    {historyError && <p role="alert">{historyError}</p>}
    <p role={conflict ? 'alert' : 'status'}>{initialHistoryPending ? 'Loading player details...' : busy ? 'Working...' : notice}</p>
  </section>;
}
