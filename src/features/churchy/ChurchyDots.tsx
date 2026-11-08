import { useEffect, useId, useRef, useState } from 'react';
import type { ChurchySpecials } from '../../domain/churchy';
import './churchy.css';

export function ChurchyDots({ name, number, value, disabled, onChange }: {
  readonly name: string;
  readonly number: number;
  readonly value: ChurchySpecials;
  readonly disabled: boolean;
  readonly onChange: (value: ChurchySpecials) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const title = useId();
  const summaryId = useId();
  const selections = [
    ...(value.paree ? ['Paree called'] : []),
    ...(value.murphy ? [`Murphy called (${String(1 + value.murphyPresses)}-dot stage)`] : []),
    ...(value.sandy ? ['Sandy confirmed'] : []),
    ...(value.pully ? ['Pully confirmed'] : []),
  ];
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open && !disabled) {
      dialog.current?.showModal();
      close.current?.focus({ preventScroll: true });
    } else if (dialog.current?.open) dialog.current.close();
  }, [open, disabled]);
  return <>
    <button ref={trigger} type="button" className="churchy-dots-button" disabled={disabled}
      aria-label={`Dots for ${name}`} aria-describedby={summaryId} aria-haspopup="dialog"
      onClick={() => { setOpen(true); }}>+ Dots <span className="churchy-dots-count" aria-hidden="true">{selections.length} selected</span></button>
    <span id={summaryId} hidden>{selections.length === 0 ? 'No specials selected.'
      : `${String(selections.length)} selected: ${selections.join('; ')}.`} Selections are not awarded dots; gross birdie is automatic.</span>
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
      <p>Staged with the score. Save &amp; Next acknowledges both. Gross-only specials; birdie is automatic. Calls stay pending until a saved disposition.</p>
      <label><input type="checkbox" checked={value.paree} onChange={(event) => {
        onChange({ ...value, paree: event.target.checked });
      }} />Paree called · fairway bunker · par or better</label>
      <label><input type="checkbox" checked={value.murphy} onChange={(event) => {
        onChange({ ...value, murphy: event.target.checked, murphyPresses: 0 });
      }} />Murphy called · chipping · par or better</label>
      <p>Murphy: {value.murphy ? 1 + value.murphyPresses : 0} dots per winning partner.
        A missed call awards the opponents. Team presses are recorded, not verified identities.</p>
      <button type="button" disabled={!value.murphy || value.murphyPresses !== 0} onClick={() => {
        onChange({ ...value, murphyPresses: 1 });
      }}>Opposing team presses · 2 dots</button>
      <button type="button" disabled={!value.murphy || value.murphyPresses !== 1} onClick={() => {
        onChange({ ...value, murphyPresses: 2 });
      }}>Calling team presses back · 3 dots</button>
      <button type="button" disabled={!value.murphy || value.murphyPresses === 0} onClick={() => {
        onChange({ ...value, murphyPresses: 0 });
      }}>Reset recorded presses</button>
      <label><input type="checkbox" checked={value.sandy} onChange={(event) => {
        onChange({ ...value, sandy: event.target.checked });
      }} />Sandy confirmed · greenside up-and-down · exact gross par</label>
      <label><input type="checkbox" checked={value.pully} onChange={(event) => {
        onChange({ ...value, pully: event.target.checked });
      }} />Pully confirmed · par putt longer than flagstick</label>
      <p>Each other special is one dot. No selectable birdie, eagle dots or Paree presses.</p>
      <button ref={close} type="button" onClick={() => { dialog.current?.close(); }}>Return to score entry</button>
    </dialog>
  </>;
}
