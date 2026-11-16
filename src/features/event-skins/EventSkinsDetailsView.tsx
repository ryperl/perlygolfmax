import { useState } from 'react';
import type { EventSkinsDetails } from '../../domain/event-skins-details';
import { RoundAccent, roundToneFor } from '../round-theme';

export function EventSkinsDetailsView({ value }: { readonly value: EventSkinsDetails }) {
  const [selected, setSelected] = useState(value.rounds[0]?.id ?? '');
  const [hole, setHole] = useState('all');
  const roundId = value.rounds.some((entry) => entry.id === selected) ? selected : value.rounds[0]?.id;
  const holes = value.holes.filter((entry) => entry.roundId === roundId);
  const name = (id: string) => value.players.find((player) => player.playerId === id)?.displayName ?? 'Player unavailable';
  return <div className="event-skins-details">
    <RoundAccent className="event-skins-filters" tone={roundId ? roundToneFor(roundId, value.rounds) : undefined}>
      <label>Round<select value={roundId} onChange={(event) => { setSelected(event.target.value); setHole('all'); }}>
        {value.rounds.map((round) => <option key={round.id} value={round.id}>{round.name}</option>)}
      </select></label>
      <label>Hole<select value={hole} onChange={(event) => { setHole(event.target.value); }}>
        <option value="all">All holes</option>
        {holes.map((entry) => <option key={entry.number} value={String(entry.number)}>Hole {entry.number}</option>)}
      </select></label>
    </RoundAccent>
    <p className="purse-hint">Saved scores · Net first · No carryovers</p>
    {holes.filter((entry) => hole === 'all' || String(entry.number) === hole).map((entry) => <details key={`${entry.roundId}:${String(entry.number)}`}>
      <summary>Hole {entry.number} · {entry.winnerId ? name(entry.winnerId) : entry.status === 'tied'
        ? `Covered by ${entry.contenderIds.map(name).join(', ')} — no skin` : entry.status}</summary>
      {entry.grossUnderParPriority && <p>Equal net: actual gross birdie-or-better priority, then lowest qualifying gross.</p>}
      {entry.reason && <p role="status">{entry.reason.replaceAll('-', ' ')}</p>}
      <div className="event-skins-comparisons"><table>
        <caption className="visually-hidden">Hole {entry.number} skins comparison</caption>
        <thead><tr><th scope="col">Player</th><th scope="col">Par</th><th scope="col">Gross</th><th scope="col">Received</th><th scope="col">Net</th><th scope="col">Outcome</th></tr></thead>
        <tbody>{entry.players.map((player) => <tr key={player.playerId}>
          <th scope="row">{name(player.playerId)}</th><td>{player.par ?? '—'}</td>
          <td>{player.disposition === 'picked-up' ? `X${player.gross === null ? '' : String(player.gross)}`
            : player.disposition === 'did-not-finish' ? 'DNF' : player.gross ?? '—'}</td>
          <td>{player.strokesReceived ?? '—'}</td><td>{player.net ?? '—'}</td>
          <td>{player.outcome}{(player.outcome === 'covered' || player.outcome === 'beaten')
            && ` by ${entry.contenderIds.filter((id) => id !== player.playerId).map(name).join(', ')}`}</td>
        </tr>)}</tbody>
      </table></div>
    </details>)}
    {value.status === 'disabled' && <p>Event skins is no longer configured.</p>}
    {holes.length === 0 && value.status !== 'disabled' && <p role="alert">No hole details available.</p>}
  </div>;
}
