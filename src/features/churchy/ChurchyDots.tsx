import { useEffect, useId, useRef, useState } from 'react';
import type { ChurchyGameDefinition, ChurchySpecialKey, ChurchySpecials } from '../../domain/churchy';
import type { ChurchyCountTexts } from './churchy-counts';
import { churchyCount } from './churchy-counts';
import './churchy.css';

export function ChurchyDots({ name, number, value, disabled, onChange, game, counts }: {
  readonly name: string;
  readonly number: number;
  readonly value: ChurchySpecials;
  readonly disabled: boolean;
  readonly game?: ChurchyGameDefinition;
  readonly counts?: ChurchyCountTexts | undefined;
  readonly onChange: (value: ChurchySpecials, counts?: ChurchyCountTexts) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const title = useId();
  const summaryId = useId();
  const selections = [
    ...(value.paree ? ['Paree called'] : []),
    ...(value.murphy ? [`Murphy called (${String(1 + value.murphyPresses)}-dot stage)`] : []),
    ...(value.version === 2 ? [
      ...(value.sandyCount > 0 ? [`Sandy ×${String(value.sandyCount)}`] : []),
      ...(value.sticky ? ['Sticky confirmed'] : []),
      ...(value.otherDots > 0 ? [`Other ×${String(value.otherDots)}`] : []),
    ] : value.sandy ? ['Sandy confirmed'] : []),
    ...(value.pully ? ['Pully confirmed'] : []),
  ];
  const [open, setOpen] = useState(false);
  const enabled = (key: ChurchySpecialKey) => value.version !== 2 || game?.version === 2 && game.enabledSpecials.includes(key);
  const countTexts = counts ?? { sandyCount: value.version === 2 ? String(value.sandyCount) : '0',
    otherDots: value.version === 2 ? String(value.otherDots) : '0' };
  function editCount(key: keyof ChurchyCountTexts, text: string) {
    if (value.version !== 2) return;
    const next = { ...countTexts, [key]: text };
    const parsed = churchyCount(text);
    onChange({ ...value, ...(parsed === null ? {} : { [key]: parsed }) }, next);
  }
  useEffect(() => {
    if (open && !disabled) {
      dialog.current?.showModal();
      close.current?.focus({ preventScroll: true });
    } else if (dialog.current?.open) dialog.current.close();
  }, [open, disabled]);
  return <>
    <button ref={trigger} type="button" className="churchy-dots-button" disabled={disabled}
      aria-label={`Dots for ${name}`} aria-describedby={summaryId} aria-haspopup="dialog"
      onClick={() => { setOpen(true); }}><svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
      Dots <span className="churchy-dots-count" aria-hidden="true">{selections.length} selected</span></button>
    <span id={summaryId} hidden>{selections.length === 0 ? 'No specials selected.'
      : `${String(selections.length)} selected: ${selections.join('; ')}.`} {value.version === 2
        ? 'Selections save with the score; enabled gross birdie and eagle are automatic.'
        : 'Selections are not awarded dots; gross birdie is automatic.'}</span>
    <dialog ref={dialog} className="churchy-dots-dialog" aria-labelledby={title} onKeyDown={(event) => {
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }} onClose={() => {
      setOpen(false); trigger.current?.focus({ preventScroll: true });
    }}>
      <h3 id={title}>{name} · Hole {number} dots</h3>
      {enabled('paree') && <label><input type="checkbox" checked={value.paree} onChange={(event) => {
        onChange({ ...value, paree: event.target.checked });
      }} />Paree called · fairway bunker · par or better</label>}
      {enabled('murphy') && <label><input type="checkbox" checked={value.murphy} onChange={(event) => {
        onChange({ ...value, murphy: event.target.checked, murphyPresses: 0 });
      }} />Murphy called · chipping · par or better</label>}
      {enabled('murphy') && <div>
      <p>Murphy: {value.murphy ? 1 + value.murphyPresses : 0} dots per winning partner.</p>
      <button type="button" disabled={!value.murphy || value.murphyPresses !== 0} onClick={() => {
        onChange({ ...value, murphyPresses: 1 });
      }}>Opposing team presses · 2 dots</button>
      <button type="button" disabled={!value.murphy || value.murphyPresses !== 1} onClick={() => {
        onChange({ ...value, murphyPresses: 2 });
      }}>Calling team presses back · 3 dots</button>
      <button type="button" disabled={!value.murphy || value.murphyPresses === 0} onClick={() => {
        onChange({ ...value, murphyPresses: 0 });
      }}>Reset recorded presses</button>
      </div>}
      {value.version === 2 ? <>
        {enabled('sandy') && <label>Sandy count · exact gross par<input inputMode="numeric"
          value={countTexts.sandyCount} aria-invalid={churchyCount(countTexts.sandyCount) === null}
          aria-describedby={churchyCount(countTexts.sandyCount) === null ? `${title}-count-error` : undefined}
          onChange={(event) => { editCount('sandyCount', event.target.value); }} /></label>}
        {enabled('sticky') && <label><input type="checkbox" checked={value.sticky} onChange={(event) => {
          onChange({ ...value, sticky: event.target.checked });
        }} />Sticky confirmed · approach inside flagstick · 1 dot</label>}
        <label>Other dots<input inputMode="numeric" value={countTexts.otherDots}
          aria-invalid={churchyCount(countTexts.otherDots) === null}
          aria-describedby={churchyCount(countTexts.otherDots) === null ? `${title}-count-error` : undefined}
          onChange={(event) => { editCount('otherDots', event.target.value); }} /></label>
        {(churchyCount(countTexts.sandyCount) === null || churchyCount(countTexts.otherDots) === null)
          && <p id={`${title}-count-error`} role="alert">Enter nonnegative whole numbers for Sandy occurrences and Other dots. Nothing in this group can save until corrected.</p>}
      </> : <label><input type="checkbox" checked={value.sandy} onChange={(event) => {
        onChange({ ...value, sandy: event.target.checked });
      }} />Sandy confirmed · greenside up-and-down · exact gross par</label>}
      {enabled('pully') && <label><input type="checkbox" checked={value.pully} onChange={(event) => {
        onChange({ ...value, pully: event.target.checked });
      }} />Pully confirmed · par or birdie putt longer than flagstick</label>}
      <details><summary>Special rules</summary>
        <p>Save &amp; Next saves scores and specials together. Each award credits both current partners in full; enter it only for the golfer who earned it.</p>
        <p>Paree and Murphy require gross par or better. A missed call awards the opponents. Murphy presses progress 1 → 2 → 3.</p>
        {value.version === 2 ? <p>Enabled Birdie earns 2 on exactly one under; Eagle earns 4 on exactly two under, never both.
          Each Sandy is 1 on exact gross par. Sticky is scorer-confirmed, with no final-score restriction. Other accepts any nonnegative whole count.</p>
          : <p>Birdie is automatic for 1 dot. Sandy requires exact gross par; Pully allows par or birdie. No eagle award or Paree presses.</p>}
      </details>
      <button ref={close} type="button" onClick={() => { dialog.current?.close(); }}>Return to score entry</button>
    </dialog>
  </>;
}
