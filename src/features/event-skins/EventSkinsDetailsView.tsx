import { useId } from 'react';
import type { EventSkinsDetails } from '../../domain/event-skins-details';
import { RoundAccent, roundToneFor } from '../round-theme';

export interface EventSkinsHoleSelection {
  readonly roundId: string;
  readonly holeNumber?: number;
}

type SkinHole = EventSkinsDetails['holes'][number];
const statusLabels: Readonly<Record<SkinHole['status'], string>> = {
  awarded: 'Skin awarded', tied: 'Covered · no skin', pending: 'Pending',
  unavailable: 'Unavailable', ineligible: 'No eligible scores',
};
const shortLabels: Readonly<Record<SkinHole['status'], string>> = {
  awarded: 'Skin', tied: 'Tie', pending: 'Wait', unavailable: 'N/A', ineligible: 'None',
};

export function EventSkinsDetailsView({ value, selection, onSelect }: {
  readonly value: EventSkinsDetails;
  readonly selection: EventSkinsHoleSelection | undefined;
  readonly onSelect: (selection: EventSkinsHoleSelection) => void;
}) {
  const panelId = useId();
  const roundId = value.rounds.some((entry) => entry.id === selection?.roundId) ? selection?.roundId : value.rounds[0]?.id;
  const holes = value.holes.filter((entry) => entry.roundId === roundId).sort((left, right) => left.number - right.number);
  const selectedNumber = selection && selection.roundId === roundId ? selection.holeNumber : undefined;
  const selected = holes.find((entry) => entry.number === selectedNumber) ?? holes[0];
  const name = (id: string) => value.players.find((player) => player.playerId === id)?.displayName ?? 'Player unavailable';
  const title = (entry: SkinHole) => entry.winnerId ? name(entry.winnerId) : entry.status === 'tied'
    ? `${String(entry.contenderIds.length)} tied · no skin`
    : entry.status === 'pending' ? 'Awaiting the field'
      : entry.status === 'unavailable' ? 'Result unavailable' : 'No eligible scores';
  const contenderIds = new Set(selected?.contenderIds);
  const savedNet = selected?.players.find((player) => player.playerId === selected.contenderIds[0])?.net ?? null;
  function move(direction: number) {
    const index = holes.findIndex((entry) => entry.number === selected?.number);
    const next = holes[(index + direction + holes.length) % holes.length];
    if (roundId && next) onSelect({ roundId, holeNumber: next.number });
  }
  if (value.status === 'disabled') return <p>Event skins is no longer configured.</p>;
  return <div className="event-skins-details">
    {roundId && <RoundAccent className="event-skins-filters" tone={roundToneFor(roundId, value.rounds)}>
      <label>Round<select value={roundId} onChange={(event) => { onSelect({ roundId: event.target.value }); }}>
        {value.rounds.map((round) => <option key={round.id} value={round.id}>{round.name}</option>)}
      </select></label>
    </RoundAccent>}
    <p className="purse-hint">Saved scores · Net first · No carryovers</p>
    {selected && roundId ? <>
      <nav className="skins-hole-nav" aria-label="Skins holes">{holes.map((entry) => <button key={entry.number} type="button"
        aria-label={`Hole ${String(entry.number)}: ${entry.winnerId ? name(entry.winnerId) : statusLabels[entry.status]}`}
        aria-pressed={entry.number === selected.number} aria-controls={panelId} data-state={entry.status}
        onClick={() => { onSelect({ roundId, holeNumber: entry.number }); }}>
        <strong>{entry.number}</strong><small>{shortLabels[entry.status]}</small>
      </button>)}</nav>
      <article className="skins-hole-panel" id={panelId} aria-label={`Hole ${String(selected.number)} skins details`}>
        <p role="status" className="skins-hole-announcement">Hole {selected.number}: {title(selected)}</p>
        <header className="skins-hole-heading">
          <div className="skins-hole-number" aria-hidden="true"><small>Hole</small><strong>{selected.number}</strong></div>
          <div className="skins-hole-result"><p className="skins-hole-state" data-state={selected.status}>{statusLabels[selected.status]}</p><h3>{title(selected)}</h3></div>
          {savedNet !== null && <p className="skins-hole-net"><strong>{savedNet}</strong><small>low net</small></p>}
        </header>
        {selected.grossUnderParPriority && <p className="skins-hole-note">Equal net: actual gross birdie-or-better priority, then lowest qualifying gross.</p>}
        {selected.reason && <p className="skins-hole-note">{selected.reason.replaceAll('-', ' ')}</p>}
        <div className="event-skins-comparisons" role="region" tabIndex={0} aria-label={`Hole ${String(selected.number)} score comparison`}><table>
        <caption>Hole {selected.number} skins comparison</caption>
        <thead><tr><th scope="col">Player</th><th scope="col">Par</th><th scope="col">Gross</th><th scope="col" aria-label="Strokes received"><abbr title="Handicap strokes received">Shots</abbr></th><th scope="col">Net</th></tr></thead>
        <tbody>{selected.players.map((player) => <tr key={player.playerId} data-contender={contenderIds.has(player.playerId) || undefined}>
          <th scope="row">{name(player.playerId)}</th><td>{player.par ?? '—'}</td>
          <td>{player.disposition === 'picked-up' ? `X${player.gross === null ? '' : String(player.gross)}`
            : player.disposition === 'did-not-finish' ? 'DNF' : player.gross ?? '—'}</td>
          <td>{player.strokesReceived ?? '—'}</td><td>{player.net ?? '—'}</td>
        </tr>)}</tbody>
        </table></div>
        <div className="skins-hole-actions">
          <button type="button" disabled={holes.length < 2} aria-controls={panelId} onClick={() => { move(-1); }}>Previous hole</button>
          <button type="button" disabled={holes.length < 2} aria-controls={panelId} onClick={() => { move(1); }}>Next hole</button>
        </div>
      </article>
    </> : <p role="alert">No hole details available.</p>}
  </div>;
}
