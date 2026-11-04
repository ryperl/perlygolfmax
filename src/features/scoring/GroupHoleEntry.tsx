import type { CourseHole } from '../../domain/catalog';
import { useRef } from 'react';
import type { HoleScore } from '../../domain/scoring';
import type { RoundGroup } from '../../domain/setup';
import { parseScoreEntry, scoreEntryText } from '../../contracts/scoring';
import { maximumExactHoleStrokes } from '../../domain/scoring';
import type { HoleDraft } from './entry-state';
import { scoreLabel } from './entry-state';
import './scoring.css';

export interface GroupHoleEntryRow {
  readonly playerId: string;
  readonly displayName: string;
  readonly saved: HoleScore;
  readonly draft?: HoleDraft;
  readonly canReview: boolean;
}
export interface GroupHoleEntryProps {
  readonly groups: readonly RoundGroup[];
  readonly groupNumber: number;
  readonly layout: readonly CourseHole[];
  readonly hole: CourseHole;
  readonly rows: readonly GroupHoleEntryRow[];
  readonly busy: boolean;
  readonly readOnly: boolean;
  readonly unsavedCount: number;
  readonly onGroupChange: (number: number) => void;
  readonly onHoleChange: (number: number) => void;
  readonly onEdit: (playerId: string, text: string) => void;
  readonly onReview: (playerId: string) => void;
  readonly onDiscard: (playerId: string) => void;
  readonly onSave: (advance: boolean) => void;
}

export function GroupHoleEntry({ groups, groupNumber, layout, hole, rows, busy, readOnly, unsavedCount,
  onGroupChange, onHoleChange, onEdit, onReview, onDiscard, onSave }: GroupHoleEntryProps) {
  const index = layout.findIndex((item) => item.number === hole.number);
  const previous = layout[index - 1];
  const next = layout[index + 1];
  const disabled = busy || readOnly;
  const scoreInputs = useRef<Array<HTMLInputElement | null>>([]);
  const primaryAction = useRef<HTMLButtonElement | null>(null);
  const quickScores = [...new Set([hole.par - 1, hole.par, hole.par + 1, hole.par + 2])].filter((value) => value > 0);
  return <section className="group-hole-entry" aria-label="Group hole entry">
    <div className="score-selection">
      <label>View group<select value={groupNumber} disabled={busy} onChange={(event) => { onGroupChange(Number(event.target.value)); }}>
        {groups.map((group) => <option value={group.number} key={group.number}>Group {group.number} · {group.playerIds.length} players</option>)}
      </select></label>
      <label>Jump to hole<select value={hole.number} disabled={busy} onChange={(event) => { onHoleChange(Number(event.target.value)); }}>
        {layout.map((item) => <option value={item.number} key={item.number}>Hole {item.number}</option>)}
      </select></label>
    </div>
    <p className="score-hint">View only · {unsavedCount} unsaved / review {unsavedCount === 1 ? 'value' : 'values'} in this page. Navigation keeps them.</p>
    <header className="hole-heading">
      <button type="button" aria-label="Previous hole" disabled={busy || !previous} onClick={() => { if (previous) onHoleChange(previous.number); }}>←</button>
      <div><h2>Hole {hole.number}</h2><p>Par {hole.par} · {hole.length} yards · Stroke index {hole.allocation}</p></div>
      <button type="button" aria-label="Next hole" disabled={busy || !next} onClick={() => { if (next) onHoleChange(next.number); }}>→</button>
    </header>
    <form aria-label={`Group ${String(groupNumber)} hole ${String(hole.number)} entry`} onSubmit={(event) => { event.preventDefault(); onSave(true); }}>
      <div className="group-entry-rows">{rows.slice(0, 4).map((row, rowIndex) => {
        const text = row.draft?.text ?? scoreEntryText(row.saved);
        const score = parseScoreEntry(text);
        const pickedUp = score?.kind === 'picked-up';
        const numeric = score?.kind === 'strokes' ? score.strokes : pickedUp ? score.reportedStrokes : undefined;
        const status = row.draft ? row.draft.status === 'conflict'
          ? row.draft.acknowledged ? 'Saved, then changed — review' : 'Conflict — review'
          : row.draft.status === 'saving' ? 'Saving…' : row.draft.status === 'failed' ? 'Failed — retry' : 'Unsaved'
          : row.saved.kind === 'unplayed' ? 'Unplayed' : 'Saved';
        return <article className="player-entry" key={row.playerId} aria-label={`${row.displayName} scorecard`}>
          <div className="entry-heading"><h3>{row.displayName}</h3><span className={`score-badge score-badge-${row.draft?.status ?? 'saved'}`}>{status}</span></div>
          <div className="entry-value">
            <button type="button" aria-label={`Decrease score for ${row.displayName}`} disabled={disabled || numeric === undefined || numeric <= 1} onClick={() => {
              if (numeric !== undefined && numeric > 1) onEdit(row.playerId, `${pickedUp ? 'X' : ''}${String(numeric - 1)}`);
            }}>−</button>
            <label>{row.displayName} score<input inputMode="numeric" autoComplete="off" spellCheck={false} aria-invalid={score === null}
              placeholder="—" disabled={disabled} value={text} ref={(element) => { scoreInputs.current[rowIndex] = element; }}
              onChange={(event) => { onEdit(row.playerId, event.target.value); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  const nextInput = scoreInputs.current[rowIndex + 1];
                  if (nextInput) nextInput.focus(); else primaryAction.current?.focus();
                }
              }} /></label>
            <button type="button" aria-label={`Increase score for ${row.displayName}`} disabled={disabled || numeric === undefined || numeric >= maximumExactHoleStrokes} onClick={() => {
              if (numeric !== undefined && numeric < maximumExactHoleStrokes) onEdit(row.playerId, `${pickedUp ? 'X' : ''}${String(numeric + 1)}`);
            }}>+</button>
            <button className="pickup-button" type="button" aria-label={`Pickup X for ${row.displayName}`} aria-pressed={pickedUp} disabled={disabled} onClick={() => {
              onEdit(row.playerId, pickedUp ? numeric === undefined ? '' : String(numeric) : numeric === undefined ? 'X' : `X${String(numeric)}`);
            }}>X</button>
          </div>
          <div className="quick-scores" aria-label={`Quick scores for ${row.displayName}`}>{quickScores.map((value) => <button type="button" key={value}
            aria-label={`${pickedUp ? 'X' : ''}${String(value)} ${pickedUp ? 'pickup' : 'strokes'} for ${row.displayName}`}
            disabled={disabled} onClick={() => { onEdit(row.playerId, `${pickedUp ? 'X' : ''}${String(value)}`); }}>
            {pickedUp ? 'X' : ''}{value}{value === hole.par && <small>par</small>}
          </button>)}</div>
          <p className="entry-saved">Saved: {scoreLabel(row.saved)}{row.draft && score ? ` · Local: ${scoreEntryText(score) || 'unplayed'}${score.kind === 'picked-up' ? ' (pickup; incomplete)' : ''}` : ''}</p>
          {!score && <p className="entry-error" role="alert">Enter a valid whole-number score above zero, X or X with a number, or leave this blank.</p>}
          {row.draft?.status === 'conflict' && <div className="entry-conflict">
            <p>Saved and intended values need review. Refresh saved round first, then choose your value or use the saved value.</p>
            <button type="button" disabled={disabled || !row.canReview} onClick={() => { onReview(row.playerId); }}>Review my value for {row.displayName}</button>
            <button type="button" disabled={disabled} onClick={() => { onDiscard(row.playerId); }}>Use saved value for {row.displayName}</button>
          </div>}
        </article>;
      })}</div>
      <div className="group-save-actions">
        <button ref={primaryAction} className="primary-score-action" disabled={disabled}>{next ? 'Save & Next Hole' : 'Save Hole'}</button>
        <button type="button" disabled={disabled} onClick={() => { onSave(false); }}>Save changes</button>
      </div>
    </form>
  </section>;
}
