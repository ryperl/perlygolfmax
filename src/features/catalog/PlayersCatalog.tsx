import { useEffect, useRef, useState } from 'react';
import type { CatalogClient, ManualIndexInput } from '../../client/catalog';
import type { PlayerIndexHistory, PlayerProfile } from '../../domain/catalog';
import { useOperation } from './useOperation';
import './catalog.css';

export function PlayersCatalog({ client }: { readonly client: CatalogClient }) {
  const [players, setPlayers] = useState<readonly PlayerProfile[] | null>(null);
  const [cursor, setCursor] = useState<string>();
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [initialValue, setInitialValue] = useState('');
  const [initialDate, setInitialDate] = useState('');
  const [initialSource, setInitialSource] = useState('Manual organizer entry');
  const [loadError, setLoadError] = useState('');
  const [settledClient, setSettledClient] = useState<CatalogClient | null>(null);
  const initialPending = settledClient !== client;
  const [editorBusy, setEditorBusy] = useState(false);
  const pending = useRef<{ readonly key: string; readonly id: string } | null>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterClose = useRef<string | null>(null);
  const { busy, notice, run, setNotice } = useOperation();
  useEffect(() => {
    if (!selectedId && !busy && !initialPending && focusAfterClose.current) {
      editButtons.current.get(focusAfterClose.current)?.focus(); focusAfterClose.current = null;
    }
  }, [busy, initialPending, selectedId]);
  useEffect(() => {
    const controller = new AbortController();
    void client.players(controller.signal).then((page) => {
      if (!controller.signal.aborted) { setPlayers(page.players); setCursor(page.continuationToken); setLoadError(''); }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Could not load players.');
    }).finally(() => {
      if (!controller.signal.aborted) setSettledClient(client);
    });
    return () => { controller.abort(); };
  }, [client]);
  function upsert(player: PlayerProfile) {
    setPlayers((previous) => previous?.some((item) => item.id === player.id)
      ? previous.map((item) => item.id === player.id ? player : item) : [...(previous ?? []), player]);
  }
  const selected = players?.find((player) => player.id === selectedId);
  const creationBlocked = busy || initialPending || players === null || editorBusy;
  return <section className="catalog-view">
    <h1>Saved player catalog</h1>
    <p>Manager-only player profiles and audited manual handicap history. This does not invite people or refresh official GHIN data.</p>
    <p>Latest effective date determines the current index; a same-date observation is an explicit correction. Backdated entries do not replace newer current values. Captured round inputs do not automatically change.</p>
    {players === null && !loadError && <p role="status">Loading players...</p>}
    {loadError && <p role="alert">{loadError}</p>}
    <button disabled={busy || initialPending || editorBusy || selectedId !== ''} onClick={() => { void run(async (signal) => {
      const page = await client.players(signal);
      if (!signal.aborted) { setPlayers(page.players); setCursor(page.continuationToken); setLoadError(''); setSelectedId(''); }
    }); }}>Refresh player catalog</button>
    <form className="panel catalog-form" onSubmit={(event) => {
      event.preventDefault();
      if (creationBlocked) return;
      void run(async (signal) => {
        const initialIndex: ManualIndexInput | undefined = initialValue.trim() ? {
          value: initialValue.trim(), effectiveDate: initialDate, source: initialSource.trim(),
        } : undefined;
        const displayName = name.trim();
        const key = JSON.stringify({ displayName, initialIndex });
        if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
        const player = initialIndex
          ? await client.createPlayer(displayName, pending.current.id, signal, initialIndex)
          : await client.createPlayer(displayName, pending.current.id, signal);
        if (!signal.aborted) {
          upsert(player); setName(''); setInitialValue(''); setInitialDate(''); setInitialSource('Manual organizer entry');
          pending.current = null;
          setNotice(initialIndex ? 'Player and initial manual handicap observation saved together.'
            : 'Player saved. Handicap index is unknown until manually recorded.');
        }
      });
    }}>
      <h2>Create a saved player</h2>
      <p>Initial HI is optional. Leave it blank for Unknown, never zero. A supplied index is a manual observation, not verified GHIN data.</p>
      <label>Player display name<input required maxLength={100} disabled={creationBlocked} value={name} onChange={(event) => { setName(event.target.value); }} /></label>
      <label>Initial handicap index (optional)<input pattern={'\\+?(0|[1-9][0-9]?)(\\.[0-9])?'} disabled={creationBlocked} value={initialValue} onChange={(event) => { setInitialValue(event.target.value); }} /></label>
      <label>Initial index effective date<input type="date" required={initialValue.trim() !== ''} disabled={creationBlocked} value={initialDate} onChange={(event) => { setInitialDate(event.target.value); }} /></label>
      <label>Initial index manual source<input maxLength={200} required={initialValue.trim() !== ''} disabled={creationBlocked} value={initialSource} onChange={(event) => { setInitialSource(event.target.value); }} /></label>
      <button disabled={creationBlocked || !name.trim()}>Save player</button>
    </form>
    <p role="status">{busy ? 'Working...' : notice}</p>
    <p role="status">{selected ? `Player editor expanded for ${selected.displayName}.` : 'Choose Edit on a saved player to expand its editor inline.'}</p>
    {players?.length === 0 && <p>No saved players.</p>}
    <ul className="round-list">{players?.map((player) => <li className={`panel player-card${player.id === selectedId ? ' player-card-expanded' : ''}`} key={player.id}>
      <h2>{player.displayName}</h2><p>Current HI: {player.currentIndex?.value ?? 'Unknown'}{player.currentIndex ? ` — effective ${player.currentIndex.effectiveDate}; ${player.currentIndex.source}` : ''}</p>
      <button ref={(button) => { if (button) editButtons.current.set(player.id, button); else editButtons.current.delete(player.id); }}
        aria-expanded={player.id === selectedId} aria-controls={`player-editor-${player.id}`}
        disabled={busy || initialPending || editorBusy} onClick={() => { setSelectedId(player.id); }}>Edit {player.displayName}</button>
      {player.id === selectedId && <PlayerEditor client={client} player={player} onSaved={upsert} onBusy={setEditorBusy}
        blocked={busy || initialPending} onClose={() => {
          focusAfterClose.current = player.id; setSelectedId(''); setEditorBusy(false);
        }} />}
    </li>)}</ul>
    {cursor && <button disabled={busy || initialPending || editorBusy} onClick={() => { void run(async (signal) => {
      const page = await client.players(signal, cursor);
      if (!signal.aborted) {
        setPlayers((previous) => [...(previous ?? []), ...page.players.filter((player) => !previous?.some((item) => item.id === player.id))]);
        setCursor(page.continuationToken);
      }
    }); }}>More players</button>}
  </section>;
}

function PlayerEditor({ client, player, onSaved, onBusy, blocked, onClose }: {
  readonly client: CatalogClient;
  readonly player: PlayerProfile;
  readonly onSaved: (player: PlayerProfile) => void;
  readonly onBusy: (busy: boolean) => void;
  readonly blocked: boolean;
  readonly onClose: () => void;
}) {
  const [name, setName] = useState(player.displayName);
  const [value, setValue] = useState('');
  const [date, setDate] = useState('');
  const [source, setSource] = useState('');
  const [correction, setCorrection] = useState(false);
  const [history, setHistory] = useState<PlayerIndexHistory | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [settledHistoryClient, setSettledHistoryClient] = useState<CatalogClient | null>(null);
  const initialHistoryPending = settledHistoryClient !== client;
  const pending = useRef<{ readonly key: string; readonly id: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focused = useRef(false);
  const { busy, notice, conflict, run, setNotice, setConflict } = useOperation();
  const controlsBusy = busy || initialHistoryPending || blocked;
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
  return <section id={`player-editor-${player.id}`} className="catalog-form player-editor" aria-label="Player editor">
    <h3 id={`player-editor-heading-${player.id}`} ref={heading} tabIndex={-1}>Edit saved player: {player.displayName}</h3>
    <p>Expanded editor for this player. Refresh player and history preserves your local draft.</p>
    <button disabled={controlsBusy} onClick={onClose}>Close player editor</button>
    <p>Current HI: {player.currentIndex?.value ?? 'Unknown'}. Never inferred as zero.</p>
    <button disabled={controlsBusy} onClick={() => { void run(async (signal) => {
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
    <form className="catalog-form" onSubmit={(event) => {
      event.preventDefault();
      if (controlsBusy || conflict) return;
      void run(async (signal) => {
        const updated = await client.renamePlayer(player, name.trim(), signal);
        if (!signal.aborted) { onSaved(updated); setNotice('Player name saved. Existing round snapshots are unchanged.'); }
      });
    }}>
      <label>Saved player name<input required maxLength={100} disabled={controlsBusy} value={name} onChange={(event) => { setName(event.target.value); }} /></label>
      <button disabled={controlsBusy || conflict}>Save player name</button>
    </form>
    <form className="catalog-form" onSubmit={(event) => {
      event.preventDefault();
      if (controlsBusy || conflict || !correction) return;
      void run(async (signal) => {
        const input: ManualIndexInput = { value: value.trim(), effectiveDate: date, source: source.trim() };
        const key = JSON.stringify(input);
        if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
        const updated = await client.recordIndex(player, input, pending.current.id, signal);
        signal.throwIfAborted();
        onSaved(updated); pending.current = null; setCorrection(false); setValue(''); setDate(''); setSource('');
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
      <h3>Record manual handicap observation</h3>
      <label>Handicap index (explicit + supported)<input required pattern={'\\+?(0|[1-9][0-9]?)(\\.[0-9])?'} disabled={controlsBusy} value={value} onChange={(event) => { setValue(event.target.value); setCorrection(false); }} /></label>
      <label>Effective date<input required type="date" disabled={controlsBusy} value={date} onChange={(event) => { setDate(event.target.value); setCorrection(false); }} /></label>
      <label>Manual source<input required maxLength={200} disabled={controlsBusy} value={source} onChange={(event) => { setSource(event.target.value); setCorrection(false); }} /></label>
      <label className="catalog-check"><input type="checkbox" disabled={controlsBusy || conflict} checked={correction} onChange={(event) => { setCorrection(event.target.checked); }} />I confirm this manual observation, including replacing any observation on the same effective date.</label>
      <button disabled={controlsBusy || conflict || !correction}>Save manual index</button>
    </form>
    <h3>Audited index history</h3>
    {history === null && !historyError && <p role="status">Loading history...</p>}
    {historyError && <p role="alert">{historyError}</p>}
    {history?.observations.length === 0 && <p>No handicap observations. Current index is unknown.</p>}
    <ol>{history?.observations.map((observation) => <li key={observation.id}>
      {observation.value} — effective {observation.effectiveDate}; {observation.source}; recorded {observation.recordedAt}
      <span className="catalog-version"> — recorded by {observation.recordedBy.tenantId}/{observation.recordedBy.objectId}{observation.previousObservationId ? `; previous audit entry ${observation.previousObservationId}` : ''}</span>
    </li>)}</ol>
    {history?.continuationToken && <button disabled={controlsBusy} onClick={() => { void run(async (signal) => {
      const page = await client.history(player.id, signal, history.continuationToken);
      if (!signal.aborted) setHistory({ ...page, observations: [...history.observations, ...page.observations] });
    }); }}>More index history</button>}
    <p role={conflict ? 'alert' : 'status'}>{busy ? 'Working...' : notice}</p>
  </section>;
}
