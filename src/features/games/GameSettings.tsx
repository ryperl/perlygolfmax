import type { FormEvent } from 'react';
import { useId } from 'react';
import { maximumPointsRows } from '../../domain/games';
import type { GameDraft } from './game-draft';
import { addBand, setPreset } from './game-draft';

interface GameSettingsProps {
  readonly draft: GameDraft;
  readonly disabled: boolean;
  readonly saveDisabled: boolean;
  readonly cancelDisabled: boolean;
  readonly retry: boolean;
  readonly onChange: (draft: GameDraft) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}

function scoreLabel(value: number): string {
  if (value === 0) return 'Par';
  if (value === -1) return 'Birdie · 1 under';
  if (value === -2) return 'Eagle · 2 under';
  if (value === -3) return 'Albatross · 3 under';
  if (value === 1) return 'Bogey · 1 over';
  if (value === 2) return 'Double bogey · 2 over';
  return value < 0 ? `${String(Math.abs(value))} under par` : `${String(value)} over par`;
}

export function GameSettings({
  draft, disabled, saveDisabled, cancelDisabled, retry, onChange, onSave, onCancel,
}: GameSettingsProps) {
  const allowanceHint = useId();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave();
  }
  return (
    <form className="game-settings" onSubmit={submit} noValidate aria-label="Game settings">
      <fieldset disabled={disabled}>
        <legend>Edit game</legend>
        <label>Game name
          <input value={draft.name} maxLength={100} onChange={(event) => { onChange({ ...draft, name: event.target.value }); }} />
        </label>
        <label>Points preset
          <select value={draft.preset} onChange={(event) => {
            if (event.target.value === 'standard' || event.target.value === 'modified') {
              onChange(setPreset(draft, event.target.value));
            }
          }}>
            <option value="standard">Standard</option>
            <option value="modified">GolfLink Modified</option>
          </select>
        </label>
        <label>Score basis
          <select value={draft.basis} onChange={(event) => {
            if (event.target.value === 'gross' || event.target.value === 'net') {
              onChange({ ...draft, basis: event.target.value });
            }
          }}>
            <option value="gross">Gross</option>
            <option value="net">Net</option>
          </select>
        </label>
        {draft.basis === 'net' && <div><label>Handicap allowance (%)
          <input inputMode="numeric" aria-describedby={allowanceHint} value={draft.allowance}
            onChange={(event) => { onChange({ ...draft, allowance: event.target.value }); }} />
        </label><small id={allowanceHint}>Whole percent, 1–100.</small></div>}
        <div className="game-scroll" role="region" aria-label="Editable points table" tabIndex={0}>
          <table>
            <caption>Points by strokes relative to par</caption>
            <thead><tr><th scope="col">Relative to par</th><th scope="col">Points</th></tr></thead>
            <tbody>
              <tr><th scope="row">Better than listed</th><td>
                <input aria-label="Better than listed points" inputMode="text" value={draft.better}
                  onChange={(event) => { onChange({ ...draft, better: event.target.value }); }} />
              </td></tr>
              {draft.rows.map((row) => <tr key={row.scoreToPar}>
                <th scope="row">{scoreLabel(row.scoreToPar)}</th>
                <td><input aria-label={`Points at ${String(row.scoreToPar)} relative to par`} inputMode="text"
                  value={row.points} onChange={(event) => { onChange({
                    ...draft, rows: draft.rows.map((item) => item.scoreToPar === row.scoreToPar
                      ? { ...item, points: event.target.value } : item),
                  }); }} /></td>
              </tr>)}
              <tr><th scope="row">Worse than listed</th><td>
                <input aria-label="Worse than listed points" inputMode="text" value={draft.worse}
                  onChange={(event) => { onChange({ ...draft, worse: event.target.value }); }} />
              </td></tr>
            </tbody>
          </table>
        </div>
        <div className="game-actions">
          <button type="button" disabled={draft.rows.length >= maximumPointsRows}
            onClick={() => { onChange(addBand(draft, 'better')); }}>Add better band</button>
          <button type="button" disabled={draft.rows.length >= maximumPointsRows}
            onClick={() => { onChange(addBand(draft, 'worse')); }}>Add worse band</button>
        </div>
        <p className="game-hint">Pickup and DNF receive the lowest configured points. Enter strokes on the scorecard.</p>
      </fieldset>
      <div className="game-actions">
        <button type="submit" disabled={disabled || saveDisabled}>{retry ? 'Retry save' : 'Save game'}</button>
        <button type="button" disabled={cancelDisabled} onClick={onCancel}>Cancel editing</button>
      </div>
    </form>
  );
}
