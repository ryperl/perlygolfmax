import { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogClient, ManualIndexInput } from '../../client/catalog';
import type { PlayerProfile } from '../../domain/catalog';
import { comparePlayerNames } from '../../domain/player-order';
import { useOperation } from './useOperation';
import { PlayerEditor } from './PlayerEditor';
import { catalogDirectoryProgress, readCatalogDirectory } from './catalog-directory';
import './catalog.css';

export function PlayersCatalog({ client }: { readonly client: CatalogClient }) {
  const [identity, setIdentity] = useState({ client, generation: 0 });
  if (identity.client !== client) setIdentity({ client, generation: identity.generation + 1 });
  return <PlayersCatalogSession key={identity.generation} client={client} />;
}

function PlayersCatalogSession({ client }: { readonly client: CatalogClient }) {
  const [players, setPlayers] = useState<readonly PlayerProfile[] | null>(null);
  const [catalogComplete, setCatalogComplete] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [initialValue, setInitialValue] = useState('');
  const [initialDate, setInitialDate] = useState('');
  const [initialSource, setInitialSource] = useState('Manual organizer entry');
  const [loadError, setLoadError] = useState('');
  const [settledClient, setSettledClient] = useState<CatalogClient | null>(null);
  const initialPending = settledClient !== client;
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const pending = useRef<{ readonly key: string; readonly id: string } | null>(null);
  const directory = useRef(catalogDirectoryProgress<PlayerProfile>());
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterClose = useRef<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const createHeading = useRef<HTMLHeadingElement>(null);
  const { busy, notice, run, setNotice } = useOperation();
  const list = useCallback(async (signal: AbortSignal, resume = false) => {
    if (!resume) directory.current = catalogDirectoryProgress();
    await readCatalogDirectory(async (cursor) => {
      const page = await client.players(signal, cursor);
      return { entries: page.players, continuationToken: page.continuationToken };
    }, directory.current, signal, (entries, complete) => { setPlayers(entries); setCatalogComplete(complete); });
    setLoadError('');
  }, [client]);
  useEffect(() => {
    if (!selectedId && !busy && !initialPending && focusAfterClose.current) {
      (editButtons.current.get(focusAfterClose.current) ?? search.current)?.focus();
      focusAfterClose.current = null;
    }
  }, [busy, initialPending, selectedId]);
  useEffect(() => { if (creating) createHeading.current?.focus(); }, [creating]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try { await list(controller.signal); }
      catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Could not load players.');
      } finally {
        if (!controller.signal.aborted) setSettledClient(client);
      }
    })();
    return () => { controller.abort(); };
  }, [client, list]);
  function upsert(player: PlayerProfile) {
    directory.current.entries.set(player.id, player);
    setPlayers((previous) => previous?.some((item) => item.id === player.id)
      ? previous.map((item) => item.id === player.id ? player : item) : [...(previous ?? []), player]);
  }
  const selected = players?.find((player) => player.id === selectedId);
  const creationBlocked = busy || initialPending || !catalogComplete || players === null || editorBusy;
  const hasCreateDraft = name !== '' || initialValue !== '';
  const matches = catalogComplete ? players?.filter((player) => player.displayName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort(comparePlayerNames) : players;
  return <section className="catalog-view">
    <header className="catalog-heading"><div><p className="catalog-eyebrow">Organizer catalog</p><h1>Players</h1></div>
      <div className="catalog-toolbar">
        <button ref={addButton} className="catalog-primary" disabled={busy || editorBusy || editorDirty}
          aria-expanded={creating} aria-controls="player-create-editor" onClick={() => { setSelectedId(''); setCreating(true); }}>
          {hasCreateDraft ? 'Resume player draft' : 'Add player'}</button>
        <button aria-label="Refresh player catalog" disabled={busy || initialPending || editorBusy || selectedId !== ''} onClick={() => {
          void run(async (signal) => {
            if (catalogComplete) { setPlayers(null); setCatalogComplete(false); }
            try { await list(signal, !catalogComplete); }
            catch (error) {
              if (!signal.aborted) setLoadError(error instanceof Error ? error.message : 'Could not load players.');
              throw error;
            }
          });
        }}>Refresh</button>
      </div>
    </header>
    <label className="catalog-search">Search players<input ref={search} type="search" value={query} onChange={(event) => { setQuery(event.target.value); }} placeholder="Player name" /></label>
    {players === null && !loadError && <p role="status">Loading players...</p>}
    {loadError && <p role="alert">{loadError}</p>}
    {!catalogComplete && players && <p role="status">{players.length} players loaded · catalog incomplete. {loadError ? 'Refresh to continue loading before searching or editing.' : 'Loading remaining pages...'}</p>}
    <div className="catalog-workspace" data-editor-open={creating || selected !== undefined || undefined}>
      <div className="catalog-directory">
        {catalogComplete && <p className="catalog-count">{matches?.length ?? 0} of {players?.length ?? 0} players</p>}
        {catalogComplete && players?.length === 0 && <p>No saved players.</p>}
        {catalogComplete && players?.length !== 0 && matches?.length === 0 && <p>No players match your search.</p>}
        <ul className="catalog-list" aria-label="Saved players">{(!query.trim() || catalogComplete) && matches?.map((player) => <li
          className="catalog-row" key={player.id} data-selected={player.id === selectedId || undefined}>
          <div><h2>{player.displayName}</h2><p>Current HI: <strong>{player.currentIndex?.value ?? 'Unknown'}</strong>
            {player.currentIndex && <span> · effective {player.currentIndex.effectiveDate}</span>}</p></div>
          <button ref={(button) => { if (button) editButtons.current.set(player.id, button); else editButtons.current.delete(player.id); }}
            aria-label={`Edit ${player.displayName}`} aria-expanded={player.id === selectedId} aria-controls={`player-editor-${player.id}`}
            disabled={busy || initialPending || !catalogComplete || editorBusy || editorDirty && player.id !== selectedId}
            onClick={() => { setCreating(false); setSelectedId(player.id); }}>Edit</button>
        </li>)}</ul>
      </div>
      <div className="catalog-editor" hidden={!creating && !selected}>
        <form id="player-create-editor" className="catalog-form" hidden={!creating} onSubmit={(event) => {
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
          <div className="catalog-editor-heading"><h2 ref={createHeading} tabIndex={-1}>Create a saved player</h2>
            <button type="button" disabled={busy} onClick={() => { setCreating(false); addButton.current?.focus(); }}>Close player creation</button></div>
          <label>Player display name<input required maxLength={100} disabled={creationBlocked} value={name} onChange={(event) => { setName(event.target.value); if (!pending.current) setNotice(''); }} /></label>
          <label>Initial handicap index (optional)<input pattern={'\\+?(0|[1-9][0-9]?)(\\.[0-9])?'} disabled={creationBlocked} value={initialValue} onChange={(event) => { setInitialValue(event.target.value); if (!pending.current) setNotice(''); }} /></label>
          <p className="catalog-hint">Leave HI blank for Unknown, never zero. A supplied index is a manual observation, not verified GHIN data.</p>
          <div className="catalog-form" hidden={!initialValue.trim()}>
            <label>Initial index effective date<input type="date" required={initialValue.trim() !== ''} disabled={creationBlocked} value={initialDate} onChange={(event) => { setInitialDate(event.target.value); if (!pending.current) setNotice(''); }} /></label>
            <label>Initial index manual source<input maxLength={200} required={initialValue.trim() !== ''} disabled={creationBlocked} value={initialSource} onChange={(event) => { setInitialSource(event.target.value); if (!pending.current) setNotice(''); }} /></label>
          </div>
          <button className="catalog-primary" disabled={creationBlocked || !name.trim()}>Save player</button>
          <p role="status">{busy ? 'Working...' : notice}</p>
        </form>
        {selected && <PlayerEditor key={selected.id} client={client} player={selected} onSaved={upsert} onBusy={setEditorBusy} onDirty={setEditorDirty}
          blocked={busy || initialPending} onClose={() => {
            focusAfterClose.current = selected.id; setSelectedId(''); setEditorBusy(false); setEditorDirty(false);
          }} />}
      </div>
    </div>
    {!creating && busy && <p role="status">Working...</p>}
  </section>;
}
