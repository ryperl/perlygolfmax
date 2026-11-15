import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { KpEntry } from '../../domain/kp';
import { kpDistance } from '../../domain/kp';
import { kpEntryLabel } from './kp-presentation';
import './kp.css';

export function KpEntryButton({ name, value, disabled, draft = false, onChange, onOpen }: {
  readonly name: string;
  readonly value?: KpEntry | null | undefined;
  readonly disabled: boolean;
  readonly draft?: boolean;
  readonly onChange: (entry: KpEntry | null) => void;
  readonly onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [feet, setFeet] = useState('');
  const [inches, setInches] = useState('');
  const [onGreen, setOnGreen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (open) { dialog.current?.showModal(); heading.current?.focus(); }
  }, [open]);
  function close() { dialog.current?.close(); setOpen(false); trigger.current?.focus(); }
  const distance = kpDistance(feet, inches);
  return <div className="kp-entry">
    <button ref={trigger} type="button" disabled={disabled} onClick={() => {
      onOpen?.();
      setFeet(value?.kind === 'measured' ? String(Math.floor(value.inches / 12)) : '');
      setInches(value?.kind === 'measured' ? String(value.inches % 12) : '');
      setOnGreen(value?.kind === 'measured');
      setOpen(true);
    }} aria-label={`KP for ${name}`}>KP · {kpEntryLabel(value)}{draft ? ' · unsaved' : ''}</button>
    {open && <dialog ref={dialog} className="kp-dialog" aria-labelledby={`${id}-heading`} onCancel={(event) => {
      event.preventDefault(); close();
    }}>
      <h3 ref={heading} tabIndex={-1} id={`${id}-heading`}>KP · {name}</h3>
      <p>Only on-green measurements qualify. Blank is unknown; 0 ft 0 in explicitly records a hole-in-one.</p>
      <div className="kp-fields">
        <label>Feet<input inputMode="numeric" autoComplete="off" value={feet} onChange={(event) => { setFeet(event.target.value); }} /></label>
        <label>Inches (0–11)<input inputMode="numeric" autoComplete="off" value={inches} onChange={(event) => { setInches(event.target.value); }} /></label>
      </div>
      <label className="kp-check"><input type="checkbox" checked={onGreen} onChange={(event) => { setOnGreen(event.target.checked); }} />Ball finished on the green</label>
      <div className="kp-actions">
        <button type="button" disabled={disabled || distance === null || !onGreen} onClick={() => {
          if (distance !== null && onGreen) { onChange({ kind: 'measured', inches: distance, onGreen: true, measurementId: crypto.randomUUID() }); close(); }
        }}>Stage measurement</button>
        <button type="button" disabled={disabled} onClick={() => { onChange({ kind: 'no-measurement' }); close(); }}>No measurement</button>
        <button type="button" disabled={disabled} onClick={() => { onChange(null); close(); }}>Clear KP entry</button>
        <button type="button" onClick={close}>Cancel</button>
      </div>
      <p>No measurement is not a missed green or zero. Other golfers can stay blank when someone in their group is closer.</p>
    </dialog>}
  </div>;
}
