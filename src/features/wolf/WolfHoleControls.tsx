import type { WolfGameDefinition, WolfHoleRecord } from '../../domain/wolf';

export function WolfHoleControls({ game, wolfId, holeNumber, etag, saved, draft, players, disabled, onChange }: {
  readonly game: WolfGameDefinition;
  readonly wolfId: string | null;
  readonly holeNumber: number;
  readonly etag: string;
  readonly saved: WolfHoleRecord | undefined;
  readonly draft: WolfHoleRecord | undefined;
  readonly players: readonly { readonly playerId: string; readonly displayName: string }[];
  readonly disabled: boolean;
  readonly onChange: (record: WolfHoleRecord) => void;
}) {
  const record = draft ?? saved;
  const name = (id: string) => players.find((player) => player.playerId === id)?.displayName ?? 'Golfer unavailable';
  const choice = saved?.choice ?? record?.choice;
  return <fieldset disabled={disabled || wolfId === null}><legend>{game.name} · Hole {holeNumber}</legend>
    <p>Wolf: {wolfId ? name(wolfId) : 'Unavailable'} · Wolf tees last. Timing is honor-system.</p>
    <label>Wolf declaration<select disabled={saved !== undefined} value={choice?.mode === 'partner' ? `partner:${choice.partnerId}` : choice?.mode ?? ''}
      onChange={(event) => {
        const value = event.target.value;
        const common = { gameId: game.id, gameEtag: etag };
        if (value === 'blind' || value === 'pig' && game.allowPig) onChange({ number: holeNumber, choice: { ...common, mode: value },
          ...(record?.outcome ? { outcome: record.outcome } : {}) });
        else if (value.startsWith('partner:')) {
          const partnerId = value.slice('partner:'.length);
          if (game.playerIds.includes(partnerId) && partnerId !== wolfId) onChange({ number: holeNumber,
            choice: { ...common, mode: 'partner', partnerId }, ...(record?.outcome ? { outcome: record.outcome } : {}) });
        }
      }}>
      <option value="">Record declaration</option>
      {game.playerIds.filter((id) => id !== wolfId).map((id) => <option key={id} value={`partner:${id}`}>
        Partner: {name(id)} · immediately after their drive</option>)}
      <option value="blind">Blind Wolf · pass all after seeing drives · double</option>
      {game.allowPig && <option value="pig">PIG · before any tee shots · triple</option>}
    </select></label>
    {saved ? <p>Saved mode and partner are locked. Explicit match outcomes may still be corrected.</p>
      : <p>Choose a partner immediately after their drive and before the next drive, or pass all. PIG must be declared before anyone tees off.</p>}
    <label>Wolf match outcome<select disabled={!choice} value={record?.outcome ?? 'scores'} onChange={(event) => {
      const outcome = event.target.value;
      if (choice && (outcome === 'scores' || outcome === 'wolf' || outcome === 'opponents' || outcome === 'halved'))
        onChange({ number: holeNumber, choice: { ...choice, gameEtag: etag }, outcome });
    }}><option value="scores">Use actual saved strokes</option><option value="wolf">Wolf side wins · conceded</option>
      <option value="opponents">Opponents win · conceded</option><option value="halved">Explicitly halved</option></select></label>
    <small>Declarations and match outcomes save with Save &amp; Next, never as separate writes. Actual strokes remain unchanged.</small>
    {saved?.recordedLate && <p>Choice recorded after scores were saved. Tee-shot timing was not verified.</p>}
  </fieldset>;
}
