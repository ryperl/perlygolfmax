import type { DotsGameDefinition, DotsHoleRecord, DotsRotationContext } from '../../domain/dots';

export function DotsRotationControls({ game, holeNumber, record, rotation, locked, players, onChange }: {
  readonly game: Extract<DotsGameDefinition, { readonly mode: 'rotating' }>;
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
  const approach = game.version === 3 && game.orderMode === 'approach';
  const labels = approach ? ['Closest approach', 'Next closest approach', 'Next farthest approach', 'Farthest approach']
    : game.version === 3 ? ['First in tee flip', 'Second in tee flip', 'Third in tee flip', 'Fourth in tee flip']
      : ['Dots P1', 'Dots P2', 'Dots P3', 'Dots P4'];
  return <section aria-label={`${game.name} partner rotation`}>
    <h4>{game.rotationHoles === 3 ? 'Modified Sixes' : 'Sixes'} · {locked ? 'Current teams' : 'Set initial order'}</h4>
    {current?.status === 'ready' && <p>{locked ? 'Saved teams' : 'Partner preview'} · {current.sides.map((side) =>
      side.map(name).join(' + ')).join(' vs ')}
      {locked && rotation.rotation?.recordedLate && <small> · Order recovered late, marked by the server</small>}</p>}
    {locked ? current?.status !== 'ready' && <p role="alert">Current teams are unavailable. Refresh and review saved inputs.</p>
      : eligible ? <>
        <p>{approach ? 'Rank your first-hole approaches from closest to farthest: closest + farthest play the middle two.'
          : game.version === 3 ? 'Choose your first-tee flip order: first + second play third + fourth.'
            : 'Choose the first played hole’s order.'} Save &amp; Next saves it with this hole; the order then locks.</p>
        {rotation.firstHole !== null && <p role="note">Scores already exist. Saving the recovered order is marked late by the server.</p>}
        <div className="dots-rotation-order">{[0, 1, 2, 3].map((index) => <label key={index}>
          {labels[index]}<select value={order[index] ?? ''} onChange={(event) => {
            const next = [...order];
            const other = next.indexOf(event.target.value);
            if (event.target.value && other >= 0) next[other] = next[index] ?? '';
            next[index] = event.target.value;
            onChange({ ...record, rotation: { playerIds: next } });
          }}><option value="">Choose golfer</option>{game.playerIds.map((id) =>
            <option key={id} value={id}>{name(id)}</option>)}</select></label>)}</div>
        {!complete && <p>Sharing is pending until all four positions are chosen and saved.</p>}
      </> : <p>Partner order is missing. Return to first played hole {rotation.firstHole} to recover it; no partners are inferred.</p>}
  </section>;
}
