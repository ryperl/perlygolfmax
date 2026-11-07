import type { CourseHole } from '../../domain/catalog';
import { useCallback, useLayoutEffect, useRef } from 'react';
import type { HoleScore } from '../../domain/scoring';
import type { RoundGroup } from '../../domain/setup';
import { parseScoreEntry, scoreEntryText } from '../../contracts/scoring';
import { maximumExactHoleStrokes } from '../../domain/scoring';
import { adjacentHole, groupStartingHole } from '../../domain/round-navigation';
import type { HoleDraft } from './entry-state';
import { scoreLabel } from './entry-state';
import { ScoreActionIcon } from './ScoreActionIcon';
import './scoring.css';

// Allow a pause between digits (including 10/12) before moving to another score.
const scoreTypingPauseMs = 850;

export interface GroupHoleEntryRow {
  readonly playerId: string;
  readonly displayName: string;
  readonly saved: HoleScore;
  readonly draft?: HoleDraft;
  readonly canReview: boolean;
  readonly hole?: CourseHole;
  readonly teeLabel?: string;
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
  readonly focusHole?: number | null;
  readonly saveStatus?: string;
  readonly onGroupChange: (number: number) => void;
  readonly onHoleChange: (number: number) => void;
  readonly onEdit: (playerId: string, text: string) => void;
  readonly onReview: (playerId: string) => void;
  readonly onDiscard: (playerId: string) => void;
  readonly onDiscardAll: () => void;
  readonly onSave: () => void;
  readonly onRefresh: () => void;
}

export function GroupHoleEntry({ groups, groupNumber, layout, hole, rows, busy, readOnly, unsavedCount, focusHole, saveStatus,
  onGroupChange, onHoleChange, onEdit, onReview, onDiscard, onDiscardAll, onSave, onRefresh }: GroupHoleEntryProps) {
  const previous = adjacentHole(layout, hole.number, -1);
  const next = adjacentHole(layout, hole.number, 1);
  const last = next?.number === groupStartingHole(groups.find((group) => group.number === groupNumber), layout);
  const disabled = busy || readOnly;
  const scoreInputs = useRef<Array<HTMLInputElement | null>>([]);
  const primaryAction = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  useLayoutEffect(() => {
    if (focusHole !== hole.number) return;
    heading.current?.focus({ preventScroll: true });
    if (typeof heading.current?.scrollIntoView === 'function') heading.current.scrollIntoView({ block: 'center', behavior: 'instant' });
  }, [focusHole, hole.number]);
  const composing = useRef(false);
  const context = JSON.stringify([groupNumber, hole.number, rows.slice(0, 4).map((row) => row.playerId)]);
  const current = useRef({ rows, disabled, context });
  const pending = useRef<{
    timer: ReturnType<typeof setTimeout>;
    playerId: string;
    text: string;
    context: string;
  } | null>(null);
  const cancelMovement = useCallback(() => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
  }, []);
  useLayoutEffect(() => {
    current.current = { rows, disabled, context };
    const movement = pending.current;
    if (!movement) return;
    const source = rows.find((row) => row.playerId === movement.playerId);
    if (disabled || context !== movement.context || !source || source.draft?.status === 'conflict'
      || (source.draft?.text ?? scoreEntryText(source.saved)) !== movement.text) cancelMovement();
  });
  useLayoutEffect(() => {
    composing.current = false;
    return cancelMovement;
  }, [cancelMovement, context, disabled]);

  function focusNextBlank(rowIndex: number) {
    const visible = current.current.rows.slice(0, 4);
    for (let offset = 1; offset < visible.length; offset++) {
      const targetIndex = (rowIndex + offset) % visible.length;
      const target = visible[targetIndex];
      const element = scoreInputs.current[targetIndex];
      if (target && target.draft?.status !== 'conflict'
        && parseScoreEntry(target.draft?.text ?? scoreEntryText(target.saved))?.kind === 'unplayed'
        && element && !element.disabled) {
        element.focus();
        return;
      }
    }
    primaryAction.current?.focus();
  }
  const personalContext = rows.some((row) => row.teeLabel !== undefined);
  return <section className="group-hole-entry" aria-label="Group hole entry">
    <div className="score-selection">
      <label>View group<select value={groupNumber} disabled={busy} onChange={(event) => { onGroupChange(Number(event.target.value)); }}>
        {groups.map((group) => <option value={group.number} key={group.number}>Group {group.number}</option>)}
      </select></label>
      <label>Jump to hole<select value={hole.number} disabled={busy} onChange={(event) => { onHoleChange(Number(event.target.value)); }}>
        {layout.map((item) => <option value={item.number} key={item.number}>Hole {item.number}</option>)}
      </select></label>
    </div>
    <header className="hole-heading">
      <button type="button" aria-label="Previous hole" disabled={busy || !previous || layout.length < 2} onClick={() => { if (previous) onHoleChange(previous.number); }}>←</button>
      <div><h2 ref={heading} tabIndex={-1}>Hole {hole.number}</h2><p>{personalContext ? 'Golfer tee details shown below' : `Par ${String(hole.par)} · ${String(hole.length)} yards · Stroke index ${String(hole.allocation)}`}</p></div>
      <button type="button" aria-label="Next hole" disabled={busy || !next || layout.length < 2} onClick={() => { if (next) onHoleChange(next.number); }}>→</button>
    </header>
    <form aria-label={`Group ${String(groupNumber)} hole ${String(hole.number)} entry`} onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <div className="group-entry-rows">{rows.slice(0, 4).map((row, rowIndex) => {
        const playerHole = row.hole ?? hole;
        const quickScores = [...new Set([playerHole.par - 1, playerHole.par, playerHole.par + 1, playerHole.par + 2])].filter((value) => value > 0);
        const text = row.draft?.text ?? scoreEntryText(row.saved);
        const score = parseScoreEntry(text);
        const pickedUp = score?.kind === 'picked-up';
        const numeric = score?.kind === 'strokes' ? score.strokes : pickedUp ? score.reportedStrokes : undefined;
        const blank = score?.kind === 'unplayed';
        const status = row.draft ? row.draft.status === 'conflict'
          ? row.draft.acknowledged ? 'Saved, then changed — review' : 'Conflict — review'
          : row.draft.status === 'saving' ? 'Saving…' : row.draft.status === 'failed' ? 'Failed — retry' : 'Unsaved'
          : row.saved.kind === 'unplayed' ? 'Unplayed' : 'Saved';
        return <article className="player-entry" key={row.playerId} aria-label={`${row.displayName} scorecard`}>
          <div className="entry-heading"><h3>{row.displayName}</h3><span className={`score-badge score-badge-${row.draft?.status ?? 'saved'}`}>{status}</span></div>
          {row.teeLabel && <p className="entry-tee">{row.teeLabel} · Par {playerHole.par} · {playerHole.length} yards · Stroke index {playerHole.allocation}</p>}
          <div className="entry-value">
            <button type="button" aria-label={`Decrease score for ${row.displayName}`} disabled={disabled || (!blank && (numeric === undefined || numeric <= 1))} onClick={() => {
              cancelMovement();
              if (blank) onEdit(row.playerId, String(playerHole.par));
              else if (numeric !== undefined && numeric > 1) onEdit(row.playerId, `${pickedUp ? 'X' : ''}${String(numeric - 1)}`);
            }}>−</button>
            <input aria-label={`${row.displayName} score`} inputMode="numeric" enterKeyHint="next" autoComplete="off" spellCheck={false} aria-invalid={score === null}
              placeholder="—" disabled={disabled} value={text} ref={(element) => { scoreInputs.current[rowIndex] = element; }}
              onChange={(event) => {
                cancelMovement();
                const element = event.currentTarget;
                const value = element.value;
                onEdit(row.playerId, value);
                if (disabled || composing.current || parseScoreEntry(value)?.kind !== 'strokes'
                  || row.draft?.status === 'conflict' || document.activeElement !== element) return;
                pending.current = {
                  playerId: row.playerId, text: value, context,
                  timer: setTimeout(() => {
                    pending.current = null;
                    const latest = current.current;
                    const source = latest.rows[rowIndex];
                    if (latest.disabled || latest.context !== context || composing.current
                      || document.activeElement !== element || element.value !== value
                      || source?.playerId !== row.playerId || source.draft?.status === 'conflict'
                      || (source.draft?.text ?? scoreEntryText(source.saved)) !== value) return;
                    focusNextBlank(rowIndex);
                  }, scoreTypingPauseMs),
                };
              }}
              onBlur={cancelMovement}
              onCompositionStart={() => { composing.current = true; cancelMovement(); }}
              onCompositionEnd={() => { composing.current = false; cancelMovement(); }}
              onKeyDown={(event) => {
                cancelMovement();
                if (event.key === 'Enter' && !event.nativeEvent.isComposing && !composing.current) {
                  event.preventDefault();
                  if (score !== null && row.draft?.status !== 'conflict' && !disabled) focusNextBlank(rowIndex);
                }
              }} />
            <button type="button" aria-label={`Increase score for ${row.displayName}`} disabled={disabled || (!blank && (numeric === undefined || numeric >= maximumExactHoleStrokes))} onClick={() => {
              cancelMovement();
              if (blank) onEdit(row.playerId, String(playerHole.par));
              else if (numeric !== undefined && numeric < maximumExactHoleStrokes) onEdit(row.playerId, `${pickedUp ? 'X' : ''}${String(numeric + 1)}`);
            }}>+</button>
            <button className="pickup-button" type="button" aria-label={`Pickup X for ${row.displayName}`} aria-pressed={pickedUp} disabled={disabled} onClick={() => {
              cancelMovement();
              onEdit(row.playerId, pickedUp ? numeric === undefined ? '' : String(numeric) : numeric === undefined ? 'X' : `X${String(numeric)}`);
            }}>X</button>
          </div>
          {rows.length === 1 && <div className="quick-scores" aria-label={`Quick scores for ${row.displayName}`}>{quickScores.map((value) => <button type="button" key={value}
            aria-label={`${pickedUp ? 'X' : ''}${String(value)} ${pickedUp ? 'pickup' : 'strokes'} for ${row.displayName}`}
            disabled={disabled} onClick={() => { cancelMovement(); onEdit(row.playerId, `${pickedUp ? 'X' : ''}${String(value)}`); }}>
            {pickedUp ? 'X' : ''}{value}{value === playerHole.par && <small>par</small>}
          </button>)}</div>}
          {!score && <p className="entry-error" role="alert">Enter a valid whole-number score above zero, X or X with a number, or leave this blank.</p>}
          {row.draft?.status === 'conflict' && <div className="entry-conflict">
            <p>Saved: {scoreLabel(row.saved)} · Intended: {score ? scoreEntryText(score) || 'unplayed' : row.draft.text}</p>
            <p>Refresh saved round, then review your value or use the saved value.</p>
            <button type="button" disabled={disabled || !row.canReview} onClick={() => { onReview(row.playerId); }}>Review my value for {row.displayName}</button>
            <button type="button" disabled={disabled} onClick={() => { onDiscard(row.playerId); }}>Use saved value for {row.displayName}</button>
          </div>}
        </article>;
      })}</div>
      <div className="group-save-actions">
        <button ref={primaryAction} className="primary-score-action" disabled={disabled}>{last ? 'Save Hole' : 'Save & Next Hole'}</button>
        <div className="score-secondary-actions">
          <button className="refresh-score-action" type="button" aria-label="Refresh saved round" title="Refresh saved round" disabled={busy} onClick={onRefresh}>
            <ScoreActionIcon kind="refresh" /><span className="score-action-label">Refresh</span>
          </button>
          <div className="score-secondary-summary">
            <p className="score-hint">{unsavedCount} unsaved {unsavedCount === 1 ? 'score' : 'scores'}</p>
            <p className="score-save-status" aria-live="polite">{saveStatus ?? (busy ? 'Working…' : unsavedCount > 0 ? 'Unsaved changes' : '')}</p>
          </div>
          <button className="discard-score-action" type="button" aria-label="Discard unsaved scores" disabled={busy || unsavedCount === 0} onClick={onDiscardAll}>Discard changes</button>
        </div>
      </div>
    </form>
  </section>;
}
