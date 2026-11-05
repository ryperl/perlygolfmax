import { useState } from 'react';
import type { PlayerProfile } from '../../domain/catalog';
import type { EventRosterPlayer } from '../../domain/setup';
import { SetupPager } from './SetupPager';

export function SetupRoster({ players, selectedIds, savedRoster, locked, onChange }: {
  readonly players: readonly PlayerProfile[];
  readonly selectedIds: readonly string[];
  readonly savedRoster: readonly EventRosterPlayer[];
  readonly locked: boolean;
  readonly onChange: (ids: readonly string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [selectedPage, setSelectedPage] = useState(0);
  const [availablePage, setAvailablePage] = useState(0);
  const term = query.trim().toLowerCase();
  const selected = players.filter((player) => selectedIds.includes(player.id));
  const available = players.filter((player) => !selectedIds.includes(player.id) && player.displayName.toLowerCase().includes(term));
  const pageSize = 12;
  const selectedOffset = Math.min(selectedPage, Math.max(0, Math.ceil(selected.length / pageSize) - 1));
  const availableOffset = Math.min(availablePage, Math.max(0, Math.ceil(available.length / pageSize) - 1));

  function choice(player: PlayerProfile) {
    const checked = selectedIds.includes(player.id);
    return <label className="setup-check" key={player.id}>
      <input type="checkbox" checked={checked} disabled={locked}
        onChange={(event) => {
          onChange(event.target.checked ? [...selectedIds, player.id] : selectedIds.filter((id) => id !== player.id));
        }} />{player.displayName} — HI {player.currentIndex?.value ?? 'Unknown'}
    </label>;
  }

  return <><fieldset disabled={locked}>
    <legend>Saved player roster ({selectedIds.length} selected)</legend>
    {locked && <p>Roster locked because scoring has started in a saved round.</p>}
    <p>Choose at least four saved players. Selecting players does not invite them or assign playing groups.</p>
    {selectedIds.filter((id) => !players.some((player) => player.id === id)).map((id) => <p key={id}>
        Saved roster player unavailable in catalog: {savedRoster.find((player) => player.playerId === id)?.displayName ?? 'Unavailable player'}
    </p>)}
    {selectedIds.length === 0 && <p>No players selected.</p>}
    {!locked && <>
      <label>Find players<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setAvailablePage(0); }}
        onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} /></label>
      <p>Selected players stay at the top when you search.</p>
    </>}
    <div className="setup-player-list" role="group" aria-label="Player choices">
      {[...selected.slice(selectedOffset * pageSize, (selectedOffset + 1) * pageSize),
        ...(!locked ? available.slice(availableOffset * pageSize, (availableOffset + 1) * pageSize) : [])].map(choice)}
    </div>
    {!locked && <>
      <SetupPager page={availableOffset} count={available.length} size={pageSize} label="available players" onChange={setAvailablePage} />
      {players.length === 0 ? <p>No saved players. Create players in the manager catalog first.</p>
        : available.length === 0 && <p>{term ? 'No other players match your search. Selected players stay above.' : 'All saved players are selected.'}</p>}
    </>}
  </fieldset>
    <SetupPager page={selectedOffset} count={selected.length} size={pageSize} label="selected players" onChange={setSelectedPage} />
  </>;
}
