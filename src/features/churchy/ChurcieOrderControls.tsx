import './churcie-order.css';

export function ChurcieOrderControls({ mode, value, players, circuit, saved = false, late = false, disabled, onChange }: {
  readonly mode: 'tee' | 'approach';
  readonly value: readonly string[];
  readonly players: readonly { readonly playerId: string; readonly displayName: string }[];
  readonly circuit: readonly number[];
  readonly saved?: boolean;
  readonly late?: boolean;
  readonly disabled: boolean;
  readonly onChange: (playerIds: readonly string[]) => void;
}) {
  const name = (id: string | undefined) => players.find((player) => player.playerId === id)?.displayName ?? 'Not chosen';
  const complete = value.length === 4 && new Set(value).size === 4
    && players.length === 4 && value.every((id) => players.some((player) => player.playerId === id));
  const labels = mode === 'approach' ? ['Closest approach', 'Farthest approach', 'Next farthest approach']
    : ['Churchie P1', 'Churchie P2', 'Churchie P3', 'Churchie P4'];
  const positions = mode === 'approach' ? [0, 3, 2] : [0, 1, 2, 3];
  const preview = complete ? [
    [[value[0], value[3]], [value[1], value[2]]],
    [[value[0], value[2]], [value[1], value[3]]],
    [[value[0], value[1]], [value[2], value[3]]],
  ] : [];
  function choose(index: number, id: string) {
    if (saved || disabled || id && !players.some((player) => player.playerId === id)) return;
    const next = Array.from({ length: 4 }, (_, position) => value[position] ?? '');
    const previous = next[index] ?? '';
    const other = id ? next.indexOf(id) : -1;
    if (other >= 0 && other !== index) next[other] = previous;
    next[index] = id;
    if (mode === 'approach') {
      const selected = [next[0], next[3], next[2]];
      const remaining = players.filter((player) => !selected.includes(player.playerId));
      next[1] = selected.every(Boolean) && new Set(selected).size === 3 && remaining.length === 1
        ? remaining[0]?.playerId ?? '' : '';
    }
    onChange(next);
  }
  const pairings = <ol className="churcie-pair-preview" aria-label="Churchie partner rotation">
    {preview.map((pairs, index) => <li key={index}>
      <span>Holes {circuit.slice(index * 3, index * 3 + 3).join(', ')}</span>
      <span>{pairs.map((pair) => pair.map(name).join(' + ')).join(' vs ')}</span>
    </li>)}
  </ol>;
  if (saved) return <details className="churcie-order">
    <summary>Churchie partners{late ? ' · Order recorded late' : ''}</summary>
    {complete ? pairings : <p role="alert">Saved partner order is unavailable. Refresh before reviewing Churchie results.</p>}
  </details>;
  return <section className="churcie-order" aria-label="Churchie partner order">
    <h3>{mode === 'approach' ? `Choose partners after approaches on hole ${String(circuit[0] ?? '—')}` : 'Set the order at the tee'}</h3>
    <div className="churcie-order-fields">{labels.map((label, index) => <label key={label}>{label}
      <select value={value[positions[index] ?? index] ?? ''} disabled={disabled} onChange={(event) => { choose(positions[index] ?? index, event.target.value); }}>
        <option value="">Choose golfer</option>{players.map((player) =>
          <option value={player.playerId} key={player.playerId}>{player.displayName}</option>)}
      </select>
    </label>)}</div>
    {mode === 'approach' && <p>Remaining golfer: {complete ? name(value[1]) : 'Choose the first three positions'}</p>}
    {complete ? <details><summary>Preview partner rotation</summary>{pairings}
      {circuit.length > 9 && <p>Repeats for the next nine played holes.</p>}</details>
      : <p>{value.some(Boolean) ? mode === 'approach' ? 'Complete all three approach choices, or reset the order before saving.'
        : 'Choose all four tee positions before saving.'
        : 'Partners pending. Raw scores can still be saved without choosing an order.'}</p>}
    {value.some(Boolean) && <button type="button" disabled={disabled} onClick={() => { onChange([]); }}>Reset unsaved order</button>}
  </section>;
}
