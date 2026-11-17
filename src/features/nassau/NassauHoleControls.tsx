import type { NassauGameDefinition, NassauHoleRecord, NassauOutcome, NassauResults } from '../../domain/nassau';

export function NassauHoleControls({ game, result, holeNumber, etag, saved, draft, disabled, onChange }: {
  readonly game: NassauGameDefinition;
  readonly result: NassauResults | undefined;
  readonly holeNumber: number;
  readonly etag: string;
  readonly saved: NassauHoleRecord | undefined;
  readonly draft: NassauHoleRecord | undefined;
  readonly disabled: boolean;
  readonly onChange: (record: NassauHoleRecord) => void;
}) {
  const record: NassauHoleRecord = { ...(draft ?? { number: holeNumber, gameId: game.id, outcomes: [], presses: [] }), gameEtag: etag };
  const options = result?.pressOptions.filter((option) => option.startHole === holeNumber) ?? [];
  return <fieldset disabled={disabled}><legend>{game.name} · Match outcomes and presses</legend>
    {!result && <p>Saved match results unavailable. Refresh before declaring a press.</p>}
    {result?.matches.map((match) => {
      const current = record.outcomes.find((entry) => entry.matchId === match.id)
        ?? saved?.outcomes.find((entry) => entry.matchId === match.id);
      return <label key={match.id}>{match.sideA.name} vs {match.sideB.name} · Hole {holeNumber}<select
        value={current?.outcome ?? 'scores'} onChange={(event) => {
          const outcome = event.target.value;
          if (outcome !== 'scores' && outcome !== 'side-a' && outcome !== 'side-b' && outcome !== 'halved') return;
          const edit: { readonly matchId: string; readonly outcome: NassauOutcome } = { matchId: match.id, outcome };
          onChange({ ...record, outcomes: [...record.outcomes.filter((entry) => entry.matchId !== match.id), edit] });
        }}>
        <option value="scores">Use actual saved strokes</option>
        <option value="side-a">{match.sideA.name} wins · conceded</option>
        <option value="side-b">{match.sideB.name} wins · conceded</option>
        <option value="halved">Explicitly halved</option>
      </select></label>;
    })}
    <p>Match outcomes do not replace actual strokes. Press eligibility uses acknowledged saved holes, never score drafts.</p>
    {options.map((option) => {
      const match = result?.matches.find((entry) => entry.id === option.matchId);
      const parent = match?.bets.find((bet) => bet.id === option.parentBetId);
      const staged = record.presses.some((press) => press.parentBetId === option.parentBetId);
      const alreadySaved = saved?.presses.some((press) => press.parentBetId === option.parentBetId) === true;
      return <div key={option.parentBetId}>
        <span>{match?.sideA.name ?? 'Side A'} vs {match?.sideB.name ?? 'Side B'} · {parent?.segment ?? 'Match'} ·
          {' '}{option.pressingSide === 'a' ? match?.sideA.name ?? 'Side A' : match?.sideB.name ?? 'Side B'} press · Starts hole {option.startHole}
          {parent && `, ends hole ${String(parent.endHole)}`}</span>
        <button type="button" disabled={alreadySaved || staged} onClick={() => {
          onChange({ ...record, presses: [...record.presses, { ...option, id: crypto.randomUUID() }] });
        }}>{alreadySaved ? 'Press saved · read-only' : staged ? 'Press staged' : 'Stage manual press'}</button>
        {staged && <button type="button" onClick={() => { onChange({ ...record,
          presses: record.presses.filter((press) => press.parentBetId !== option.parentBetId) }); }}>Remove staged press</button>}
      </div>;
    })}
    {(saved?.presses.length ?? 0) > 0 && <p>{saved?.presses.length} saved press declaration(s) on this hole · Read-only</p>}
    {(result?.stalePresses.length ?? 0) > 0 && <p role="status">Saved stale presses require review in Games; they cannot be edited here.</p>}
    {record.presses.filter((press) => !options.some((option) => option.parentBetId === press.parentBetId && option.proof === press.proof)).map((press, index) =>
      <div key={press.id}><p role="status">Staged press {index + 1} is no longer eligible. Discard or refresh and review before retrying.</p>
        <button type="button" onClick={() => { onChange({ ...record, presses: record.presses.filter((entry) => entry.id !== press.id) }); }}>
          Remove stale staged press
        </button></div>)}
  </fieldset>;
}
