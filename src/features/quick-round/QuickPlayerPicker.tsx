import { useId, useState } from 'react';
import { comparePlayerNames } from '../../domain/player-order';

export function QuickPlayerPicker({ players, selectedIds, disabled, onToggle }: {
  readonly players: readonly { readonly id: string; readonly displayName: string }[];
  readonly selectedIds: readonly string[];
  readonly disabled: boolean;
  readonly onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const id = useId();
  const matches = players.filter((player) => player.displayName.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(selectedIds.includes(b.id)) - Number(selectedIds.includes(a.id)) || comparePlayerNames(a, b));
  const last = Math.max(0, Math.ceil(matches.length / 24) - 1);
  const current = Math.min(page, last);
  const visible = matches.slice(current * 24, (current + 1) * 24);
  return <section className="quick-player-picker" aria-label="Round golfers">
    <div className="quick-section-heading"><h3>Golfers <span>({selectedIds.length})</span></h3>
      <button type="button" disabled={disabled} aria-expanded={open} aria-controls={id} onClick={() => { setOpen((value) => !value); }}>
        {open ? 'Done choosing golfers' : 'Add golfers'}
      </button>
    </div>
    {open && <div id={id} className="quick-player-choices">
      <label>Find saved golfers<input type="search" value={query} disabled={disabled}
        onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label>
      <p className="quick-picker-count">{selectedIds.length} selected · {matches.length} {query.trim() ? 'matching' : 'saved'} {matches.length === 1 ? 'golfer' : 'golfers'}</p>
      <div className="quick-golfer-options">{visible.map((player) => <label key={player.id}>
        <input type="checkbox" checked={selectedIds.includes(player.id)} disabled={disabled} onChange={() => { onToggle(player.id); }} />
        <span>{player.displayName}</span>
      </label>)}</div>
      {matches.length === 0 && <p>No saved golfers match.</p>}
      {matches.length > 24 && <div className="quick-actions">
        <button type="button" disabled={disabled || current === 0} onClick={() => { setPage((value) => Math.max(0, value - 1)); }}>Previous golfers</button>
        <span>Page {current + 1} of {last + 1}</span>
        <button type="button" disabled={disabled || current >= last} onClick={() => { setPage(current + 1); }}>Next golfers</button>
      </div>}
    </div>}
  </section>;
}
