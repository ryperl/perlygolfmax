import type { DotsGameDefinition, DotsHoleRecord, DotsRotationContext } from '../../domain/dots';

export function DotsRotationControls({ game, holeNumber, record, rotation, locked, players, onChange }: {
  readonly game: Extract<DotsGameDefinition, { readonly version: 2 }>;
  readonly holeNumber: number;
  readonly record: DotsHoleRecord;
  readonly rotation: DotsRotationContext;
  readonly locked: boolean;
  readonly players: readonly { readonly playerId: string; readonly displayName: string }[];
  readonly onChange: (record: DotsHoleRecord) => void;
}) {
  const name = (id: string) => players.find((player) => player.playerId === id)?.displayName ?? 'Golfer unavailable';
  const eligible = rotation.firstHole === null || rotation.firstHole === holeNumber;
  const order = rotation.rotation?.playerIds ?? ['', '', '', ''];
  const complete = order.length === 4 && new Set(order).size === 4 && order.every((id) => game.playerIds.includes(id));
  const current = rotation.contexts.find((context) => context.number === holeNumber);
  return <section aria-label={`${game.name} partner rotation`}>
    <h4>{game.rotationHoles === 3 ? 'Modified Sixes' : 'Sixes'} · Partners every {game.rotationHoles} holes</h4>
    {current?.status === 'ready' && <p>{locked ? 'Saved partners' : 'Partner preview'} · {current.sides.map((side) =>
      side.map(name).join(' + ')).join(' vs ')}</p>}
    {locked ? <p>Cycle starts on hole {rotation.firstHole}. P1–P4 order is saved and cannot change.
      {rotation.rotation?.recordedLate && ' Recovered after scoring started; marked late by the server.'}</p>
      : eligible ? <>
        <p>Choose the first played hole&apos;s order. Save &amp; Next saves it with this hole; the order then locks.</p>
        {rotation.firstHole !== null && <p role="note">Scores already exist. Saving the recovered order is marked late by the server.</p>}
        <div className="dots-rotation-order">{[0, 1, 2, 3].map((index) => <label key={index}>
          Dots P{index + 1}<select value={order[index] ?? ''} onChange={(event) => {
            const next = [...order];
            const other = next.indexOf(event.target.value);
            if (event.target.value && other >= 0) next[other] = next[index] ?? '';
            next[index] = event.target.value;
            onChange({ ...record, rotation: { playerIds: next } });
          }}><option value="">Choose golfer</option>{game.playerIds.map((id) =>
            <option key={id} value={id}>{name(id)}</option>)}</select></label>)}</div>
        {!complete && <p>Sharing is pending until all four positions are chosen and saved.</p>}
        {complete && <details><summary>Preview partner cycle</summary>
          <ul>{rotation.contexts.map((context) => <li key={context.number}>Hole {context.number} · {
            context.status === 'ready' ? context.sides.map((side) => side.map(name).join(' + ')).join(' vs ') : 'Pending order'}</li>)}</ul>
        </details>}
      </> : <p>Partner order is missing. Return to first played hole {rotation.firstHole} to recover it; no partners are inferred.</p>}
  </section>;
}
