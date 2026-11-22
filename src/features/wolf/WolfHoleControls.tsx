import type { WolfComebackState, WolfGameDefinition, WolfHoleRecord, WolfHoleResult, WolfOrderReceipt } from '../../domain/wolf';
import { WolfSoloProgress } from './WolfSoloProgress';

export function WolfHoleControls({ game, wolfId, holeNumber, etag, saved, draft, players, disabled, comeback, onChange, holes, reviewMessages = [],
  firstHole, savedOrder, orderSupported = false }: {
  readonly game: WolfGameDefinition;
  readonly wolfId: string | null;
  readonly holeNumber: number;
  readonly etag: string;
  readonly saved: WolfHoleRecord | undefined;
  readonly draft: WolfHoleRecord | undefined;
  readonly players: readonly { readonly playerId: string; readonly displayName: string }[];
  readonly disabled: boolean;
  readonly comeback?: WolfComebackState | undefined;
  readonly holes?: readonly WolfHoleResult[] | undefined;
  readonly reviewMessages?: readonly string[];
  readonly onChange: (record: WolfHoleRecord) => void;
  readonly firstHole?: number | undefined;
  readonly savedOrder?: WolfOrderReceipt | undefined;
  readonly orderSupported?: boolean;
}) {
  const record = draft ?? saved;
  const name = (id: string) => players.find((player) => player.playerId === id)?.displayName ?? 'Golfer unavailable';
  const choice = saved?.choice.mode !== 'order' ? saved?.choice ?? record?.choice : record?.choice;
  const declarationLocked = saved !== undefined && saved.choice.mode !== 'order';
  const order = savedOrder ?? record?.order;
  const orderMissing = game.orderMode !== undefined && !savedOrder;
  const commonOrder = record?.order ? { order: record.order } : {};
  const receipt = game.version === 2 && comeback?.status === 'available' && comeback.receipt ? { comeback: comeback.receipt } : {};
  return <>
    {game.orderMode && <fieldset disabled={disabled || !orderSupported}><legend>{game.name} · Wolf order</legend>
      {savedOrder ? <p>Saved Wolf rotation: {savedOrder.playerIds.map(name).join(' → ')}
        {savedOrder.recordedLate && <small> · Order recovered after scoring</small>}</p>
        : firstHole === holeNumber ? <>
          <div className="dots-rotation-order">{['First Wolf', 'Second Wolf', 'Third Wolf', 'Fourth Wolf'].map((label, index) => <label key={label}>
            {label}<select value={order?.playerIds[index] ?? ''} onChange={(event) => {
              const ids = [...(order?.playerIds ?? ['', '', '', ''])];
              const other = ids.indexOf(event.target.value);
              if (event.target.value && other >= 0) ids[other] = ids[index] ?? '';
              ids[index] = event.target.value;
              onChange({ number: holeNumber,
                choice: choice && choice.mode !== 'order' ? choice : { gameId: game.id, gameEtag: etag, mode: 'order' },
                order: { playerIds: ids } });
            }}><option value="">Choose golfer</option>{game.playerIds.map((id) =>
              <option key={id} value={id}>{name(id)}</option>)}</select></label>)}</div>
          <small>Save &amp; Next locks this order with the hole. Raw scores can be saved without an order.</small>
        </> : <p>Wolf is pending. Choose the order at this group&apos;s first hole ({firstHole}). Raw scoring remains available.</p>}
      {!orderSupported && <p>First-tee Wolf order is temporarily unavailable.</p>}
    </fieldset>}
    <fieldset disabled={disabled || wolfId === null}><legend>{game.name} · Hole {holeNumber}</legend>
    <p>Wolf: {wolfId ? name(wolfId) : comeback?.status === 'pending' ? 'Pending earlier entries' : 'Unavailable'} · Tees last</p>
    <label>Wolf declaration<select disabled={declarationLocked} value={choice?.mode === 'partner' ? `partner:${choice.partnerId}` : choice?.mode === 'order' ? '' : choice?.mode ?? ''}
      onChange={(event) => {
        const value = event.target.value;
        const common = { gameId: game.id, gameEtag: etag };
        if (value === 'blind' || value === 'pig' && game.allowPig) onChange({ number: holeNumber, ...receipt, ...commonOrder, choice: { ...common, mode: value },
          ...(record?.outcome ? { outcome: record.outcome } : {}) });
        else if (value.startsWith('partner:')) {
          const partnerId = value.slice('partner:'.length);
          if (game.playerIds.includes(partnerId) && partnerId !== wolfId) onChange({ number: holeNumber, ...receipt, ...commonOrder,
            choice: { ...common, mode: 'partner', partnerId }, ...(record?.outcome ? { outcome: record.outcome } : {}) });
        }
      }}>
      <option value="">Record declaration</option>
      {game.playerIds.filter((id) => id !== wolfId).map((id) => <option key={id} value={`partner:${id}`}>
        {name(id)}</option>)}
      <option value="blind">Blind Wolf · ×2</option>
      {game.allowPig && <option value="pig">PIG · before drives · ×3</option>}
    </select></label>
    {declarationLocked && <p>Saved mode and partner are locked.{game.version === 1 && ' Explicit match outcomes may still be corrected.'}</p>}
    {game.version === 1 && <label>Wolf match outcome<select disabled={!choice} value={record?.outcome ?? 'scores'} onChange={(event) => {
      const outcome = event.target.value;
      if (choice && choice.mode !== 'order' && (outcome === 'scores' || outcome === 'wolf' || outcome === 'opponents' || outcome === 'halved'))
        onChange({ number: holeNumber, ...commonOrder, choice: { ...choice, gameEtag: etag }, outcome });
    }}><option value="scores">Use actual saved strokes</option><option value="wolf">Wolf side wins · conceded</option>
      <option value="opponents">Opponents win · conceded</option><option value="halved">Explicitly halved</option></select></label>}
    {game.version === 2 && wolfId === null && !orderMissing && <p>Wolf selection is pending authoritative saved prefix scores and linked specials. Save or refresh earlier holes before declaring.</p>}
    {game.version === 2 && wolfId === null && !orderMissing && reviewMessages.length > 0 && <div role="alert">
      <p>Review earlier holes before choosing the final-two-hole Wolf:</p>
      <ul>{reviewMessages.map((message) => <li key={message}>{message}</li>)}</ul>
    </div>}
    <WolfSoloProgress game={game} holes={holes} players={players} />
    {comeback?.status === 'available' && <p>Comeback Wolf: {comeback.receipt ? name(comeback.receipt.wolfId) : 'Pending'} · Lowest saved combined dots.
      Selection freezes with the first final-two-hole declaration.</p>}
    {comeback?.changed && <p role="status">Earlier saved results changed after comeback selection. The chosen Wolf remains unchanged.</p>}
    <details><summary>Timing &amp; rules</summary>
      <p>Choose a partner immediately after their drive and before the next drive, or pass all. PIG must be declared before anyone tees off.
        Timing is honor-system.</p>
      {game.version === 2 && <p>Earned dots use actual saved strokes: partnered High and Low separately; Blind Wolf ×2 and PIG ×3.
        No conceded single-match outcome.</p>}
      <small>Declarations and match outcomes save with Save &amp; Next, never as separate writes. Actual strokes remain unchanged.</small>
    </details>
    {saved?.recordedLate && <p>Choice recorded after scores were saved. Tee-shot timing was not verified.</p>}
  </fieldset></>;
}
