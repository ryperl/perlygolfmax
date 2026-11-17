import { dotsManualKinds, dotsSpecialCatalog } from '../../domain/dots';
import type { DotsCall, DotsContest, DotsGameDefinition, DotsHoleRecord, DotsPlayerDeclaration } from '../../domain/dots';
import type { DotHoleContext } from '../../domain/dot-context';

export function DotsHoleControls({ game, holeNumber, par, playerPars, etag, saved, draft, players, context, disabled, onChange }: {
  readonly game: DotsGameDefinition;
  readonly holeNumber: number;
  readonly par: number;
  readonly playerPars?: readonly { readonly playerId: string; readonly par: number }[] | undefined;
  readonly etag: string;
  readonly saved: DotsHoleRecord | undefined;
  readonly draft: DotsHoleRecord | undefined;
  readonly players: readonly { readonly playerId: string; readonly displayName: string }[];
  readonly context?: DotHoleContext | undefined;
  readonly disabled: boolean;
  readonly onChange: (record: DotsHoleRecord) => void;
}) {
  const record = draft ?? saved ?? { number: holeNumber, gameId: game.id, gameEtag: etag, players: [], contests: [] };
  const enabled = (kind: string) => game.specials.some((special) => special.kind === kind);
  const name = (id: string) => players.find((player) => player.playerId === id)?.displayName ?? 'Golfer unavailable';
  const sides = game.mode === 'fixed' ? [game.partnerIds.slice(0, 2), game.partnerIds.slice(2)]
    : game.mode === 'linked' && context?.status === 'ready' ? context.sides : [];
  const partnered = sides.length === 2 && sides.every((side) => side.length === 2);
  function changePlayer(player: DotsPlayerDeclaration) {
    onChange({ ...record, gameEtag: etag, players: [...record.players.filter((entry) => entry.playerId !== player.playerId), player] });
  }
  function changeContest(contest: DotsContest) {
    onChange({ ...record, gameEtag: etag, contests: [...record.contests.filter((entry) => entry.kind !== contest.kind), contest] });
  }
  const manual = dotsSpecialCatalog.filter((special) => enabled(special.kind) && dotsManualKinds.includes(special.kind));
  const calls: readonly DotsCall['kind'][] = ['paree', 'murphy', 'pully-murphy'];
  return <fieldset disabled={disabled}><legend>{game.name} specials · Hole {holeNumber}</legend>
    {game.mode === 'linked' && <p>{context?.status === 'ready'
      ? `${context.sides.map((side) => side.map(name).join(' + ')).join(' vs ')} · ×${String(context.multiplier)}`
      : 'Linked sides are pending saved Wolf choices. Results use the authoritative saved context.'}</p>}
    <small>Stage specials below the scores; Save &amp; Next saves everything together. Automatic awards use saved gross strokes.</small>
    {game.playerIds.map((playerId) => {
      const declaration = record.players.find((entry) => entry.playerId === playerId) ?? { playerId, counts: {}, calls: [] };
      return <details key={playerId}><summary>{name(playerId)} · Specials and calls</summary>
        {manual.filter((special) => special.kind !== 'gorilla' || (playerPars?.find((entry) => entry.playerId === playerId)?.par ?? par) === 5)
          .map((special) => <label key={special.kind}>{special.label} count · {name(playerId)}
          <input aria-label={`${special.label} count · ${name(playerId)}`} type="number" min="0" step="1"
            aria-invalid={!Number.isSafeInteger(declaration.counts[special.kind] ?? 0) || (declaration.counts[special.kind] ?? 0) < 0}
            value={declaration.counts[special.kind] ?? 0} onChange={(event) => {
            const count = event.target.value === '' ? 0 : Number(event.target.value);
            const counts = { ...declaration.counts, [special.kind]: count };
            if (count > 0 && special.kind === 'super-dime') counts.dime = 0;
            if (count > 0 && special.kind === 'dime') counts['super-dime'] = 0;
            changePlayer({ ...declaration, counts });
          }} />
          {(!Number.isSafeInteger(declaration.counts[special.kind] ?? 0) || (declaration.counts[special.kind] ?? 0) < 0)
            && <span role="alert">{special.label} count must be a whole number of 0 or more.</span>}
          <small>{special.description}{special.kind === 'sandy' && ' Count each fairway or greenside bunker separately.'}</small></label>)}
        {calls.filter(enabled).map((kind) => <div key={kind}>
          <button type="button" onClick={() => { changePlayer({ ...declaration, calls: [...declaration.calls,
            { id: crypto.randomUUID(), kind, result: 'pending' }] }); }}>
            Call {dotsSpecialCatalog.find((special) => special.kind === kind)?.label} · {name(playerId)}</button>
          {declaration.calls.filter((call) => call.kind === kind).map((call, index) => <div key={call.id}>
            <label>{dotsSpecialCatalog.find((special) => special.kind === kind)?.label} call {index + 1} · {name(playerId)}
              <select value={call.result} onChange={(event) => {
                const result = event.target.value;
                if (result === 'pending' || result === 'success' || result === 'failure') changePlayer({ ...declaration,
                  calls: declaration.calls.map((entry) => entry.id === call.id ? { ...entry, result } : entry) });
              }}><option value="pending">Called · Outcome pending</option><option value="success">Success</option>
                <option value="failure">Failed · Opponents earn</option></select></label>
            <button type="button" onClick={() => { changePlayer({ ...declaration, calls: declaration.calls.filter((entry) => entry.id !== call.id) }); }}>
              Remove {dotsSpecialCatalog.find((special) => special.kind === kind)?.label} call {index + 1} · {name(playerId)}</button>
          </div>)}
        </div>)}
      </details>;
    })}
    {(['kp', 'blue-plate', 'long-drive'] satisfies readonly DotsContest['kind'][]).filter((kind) =>
      (enabled(kind) || kind !== 'long-drive' && enabled('assassin')) && par === (kind === 'kp' ? 3 : 5)).map((kind) => {
      const contest = record.contests.find((entry) => entry.kind === kind);
      const label = dotsSpecialCatalog.find((special) => special.kind === kind)?.label;
      return <div key={kind}><label>{label} result<select value={contest?.status === 'no-qualifier' ? 'none' : contest?.winnerId ?? ''}
        onChange={(event) => {
          if (event.target.value === 'none') changeContest({ kind, status: 'no-qualifier' });
          else if (game.playerIds.includes(event.target.value)) changeContest({ kind, status: 'awarded', winnerId: event.target.value });
          else onChange({ ...record, gameEtag: etag, contests: record.contests.filter((entry) => entry.kind !== kind) });
        }}><option value="">Decision pending</option><option value="none">No qualifier · Carry category</option>
          {game.playerIds.map((id) => <option key={id} value={id}>{name(id)}</option>)}</select></label>
        <small>{kind === 'long-drive' ? 'Par-5 fairway qualifier.' : `Par-${kind === 'kp' ? '3' : '5'} GIR qualifier.`} Missing input is pending, never no qualifier.</small>
        {kind !== 'long-drive' && enabled('assassin') && partnered && contest?.status === 'awarded' && <label>
          {label} second-closest qualifier · Assassin<select value={contest.secondId ?? ''} onChange={(event) => {
            const secondId = event.target.value;
            const { secondId: previous, ...rest } = contest;
            void previous;
            changeContest(secondId ? { ...rest, secondId } : rest);
          }}><option value="">Not confirmed</option>{game.playerIds.filter((id) => id !== contest.winnerId).map((id) =>
            <option key={id} value={id}>{name(id)}</option>)}</select>
          <small>Confirm both closest qualifying approaches; Assassin requires teammates ahead of both opponents.</small>
        </label>}
      </div>;
    })}
    <button type="button" onClick={() => { onChange({ number: holeNumber, gameId: game.id, gameEtag: etag, players: [], contests: [] }); }}>
      Clear {game.name} hole specials</button>
  </fieldset>;
}
