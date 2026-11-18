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
  function countControl(key: keyof ChurchyCountTexts, label: string) {
    const count = churchyCount(countTexts[key]);
    return <div className="churchy-count-control">
      <span>{key === 'otherDots' ? 'Other' : label}</span>
      <div className="churchy-count-stepper">
        <button type="button" aria-label={`Decrease ${label} for ${name}`}
          disabled={count === null || count === 0}
          onClick={() => { if (count !== null) editCount(key, String(count - 1)); }}>−</button>
        <output aria-label={`${label} count for ${name}`} aria-live="polite">{count ?? '—'}</output>
        <button type="button" aria-label={`Increase ${label} for ${name}`}
          disabled={count === null || count === Number.MAX_SAFE_INTEGER}
          onClick={() => { if (count !== null) editCount(key, String(count + 1)); }}>+</button>
      </div>
    </div>;
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
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, summary')]
        .filter((control) => !control.matches(':disabled')
          && !control.closest('[hidden], [inert]')
          && ![...event.currentTarget.querySelectorAll('details:not([open])')].some((details) =>
            details.contains(control) && details.firstElementChild !== control));
      if (controls.length === 0) return;
      event.preventDefault();
      const current = controls.findIndex((control) => control === document.activeElement);
      const next = current === -1 ? (event.shiftKey ? controls.length - 1 : 0)
        : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      // WebKit's native Tab order can omit checkboxes and summary controls.
      controls[next]?.focus();
    }} onClose={() => {
      setOpen(false); trigger.current?.focus({ preventScroll: true });
    }}>
      <header><h3 id={title}>{name} · Hole {number} dots</h3>
        <button ref={close} type="button" aria-label="Return to score entry"
          onClick={() => { dialog.current?.close(); }}>Done</button></header>
      <fieldset disabled={disabled}><legend className="churchy-visually-hidden">Hole specials</legend>
      <div className="churchy-quick-choices">
      {enabled('paree') && <label className="churchy-special-choice"><input type="checkbox" checked={value.paree}
        aria-label="Paree called · fairway bunker · par or better" onChange={(event) => {
        onChange({ ...value, paree: event.target.checked });
      }} /><span>Paree</span></label>}
      {enabled('murphy') && <label className="churchy-special-choice"><input type="checkbox" checked={value.murphy}
        aria-label="Murphy called · chipping · par or better" onChange={(event) => {
        onChange({ ...value, murphy: event.target.checked, murphyPresses: 0 });
      }} /><span>Murphy</span></label>}
      {value.version === 2 && enabled('sticky') && <label className="churchy-special-choice"><input type="checkbox"
        checked={value.sticky} aria-label="Sticky confirmed · approach inside flagstick · 1 dot" onChange={(event) => {
          onChange({ ...value, sticky: event.target.checked });
        }} /><span>Sticky</span></label>}
      {value.version !== 2 && <label className="churchy-special-choice"><input type="checkbox" checked={value.sandy}
        aria-label="Sandy confirmed · greenside up-and-down · exact gross par" onChange={(event) => {
          onChange({ ...value, sandy: event.target.checked });
        }} /><span>Sandy</span></label>}
      {enabled('pully') && <label className="churchy-special-choice"><input type="checkbox" checked={value.pully}
        aria-label="Pully confirmed · par or birdie putt longer than flagstick" onChange={(event) => {
          onChange({ ...value, pully: event.target.checked });
        }} /><span>Pully</span></label>}
      </div>
      {enabled('murphy') && value.murphy && <div className="churchy-press-controls">
      <p>Murphy: {1 + value.murphyPresses} dots per winning partner.</p>
      <button type="button" disabled={value.murphyPresses !== 0} onClick={() => {
        onChange({ ...value, murphyPresses: 1 });
      }}>Opposing team presses · 2 dots</button>
      <button type="button" disabled={value.murphyPresses !== 1} onClick={() => {
        onChange({ ...value, murphyPresses: 2 });
      }}>Calling team presses back · 3 dots</button>
      <button type="button" disabled={value.murphyPresses === 0} onClick={() => {
        onChange({ ...value, murphyPresses: 0 });
      }}>Reset recorded presses</button>
      </div>}
      {value.version === 2 ? <>
        {enabled('sandy') && countControl('sandyCount', 'Sandy')}
        {countControl('otherDots', 'Other dots')}
        <details className="churchy-count-editor"><summary>Edit counts</summary>
          {enabled('sandy') && <label>Sandy count<input inputMode="numeric"
            value={countTexts.sandyCount} aria-invalid={churchyCount(countTexts.sandyCount) === null}
            aria-describedby={churchyCount(countTexts.sandyCount) === null ? `${title}-count-error` : undefined}
            onChange={(event) => { editCount('sandyCount', event.target.value); }} /></label>}
          <label>Other dots<input inputMode="numeric" value={countTexts.otherDots}
            aria-invalid={churchyCount(countTexts.otherDots) === null}
            aria-describedby={churchyCount(countTexts.otherDots) === null ? `${title}-count-error` : undefined}
            onChange={(event) => { editCount('otherDots', event.target.value); }} /></label>
        </details>
        {(churchyCount(countTexts.sandyCount) === null || churchyCount(countTexts.otherDots) === null)
          && <p id={`${title}-count-error`} role="alert">Enter nonnegative whole numbers for Sandy occurrences and Other dots. Nothing in this group can save until corrected.</p>}
      </> : null}
      </fieldset>
      <details><summary>Special rules</summary>
        <p>Save &amp; Next saves scores and specials together. Each award credits both current partners in full; enter it only for the golfer who earned it.</p>
        <p>Call Paree from a fairway bunker or Murphy when chipping; each requires gross par or better.
          A missed call awards the opponents. Murphy presses progress 1 → 2 → 3.
          Pully requires a par or birdie putt longer than the flagstick.</p>
        {value.version === 2 ? <p>Enabled Birdie earns 2 on exactly one under; Eagle earns 4 on exactly two under, never both.
          Each Sandy is 1 on exact gross par. Sticky is a scorer-confirmed approach inside flagstick length, with no final-score restriction.
          Other accepts any nonnegative whole count.</p>
          : <p>Birdie is automatic for 1 dot. Sandy requires exact gross par; Pully allows par or birdie. No eagle award or Paree presses.</p>}
      </details>
    </dialog>
  </>;
}
