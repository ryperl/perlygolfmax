import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { KpEntry } from '../../domain/kp';
import { kpDistance } from '../../domain/kp';
import { kpEntryLabel } from './kp-presentation';
import './kp.css';

export function KpEntryButton({ name, value, disabled, draft = false, compact = false, readOnly = false, onChange, onOpen }: {
  readonly name: string;
  readonly value?: KpEntry | null | undefined;
  readonly disabled: boolean;
  readonly draft?: boolean;
  readonly compact?: boolean;
  readonly readOnly?: boolean;
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
  const readonlyValue = useRef<HTMLParagraphElement>(null);
  const id = useId();
  const locked = disabled || readOnly;
  useLayoutEffect(() => {
    if (open) { dialog.current?.showModal(); heading.current?.focus(); }
  }, [open]);
  function close() { dialog.current?.close(); setOpen(false); (readOnly ? readonlyValue.current : trigger.current)?.focus(); }
  const distance = kpDistance(feet, inches);
  return <div className={compact ? 'kp-entry kp-entry-compact' : 'kp-entry'}>
    {readOnly ? <p ref={readonlyValue} tabIndex={-1} className="kp-entry-readonly">
      <span className="kp-entry-value" data-measured={value?.kind === 'measured' || undefined}>{kpEntryLabel(value)}</span>
      {draft && <small className="kp-entry-draft">unsaved</small>}
    </p> : <button ref={trigger} type="button" disabled={locked} onClick={() => {
      onOpen?.();
      setFeet(value?.kind === 'measured' ? String(Math.floor(value.inches / 12)) : '');
      setInches(value?.kind === 'measured' ? String(value.inches % 12) : '');
      setOnGreen(value?.kind === 'measured');
      setOpen(true);
    }} aria-label={`KP for ${name}`}>{compact ? <>
      <span className="kp-entry-value" data-measured={value?.kind === 'measured' || undefined}>{kpEntryLabel(value)}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true" focusable="false">
        <path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14v6Z" />
      </svg>
      {draft && <small className="kp-entry-draft">unsaved</small>}
    </> : <>KP · {kpEntryLabel(value)}{draft ? ' · unsaved' : ''}</>}</button>}
    {open && <dialog ref={dialog} className="kp-dialog" aria-labelledby={`${id}-heading`} onCancel={(event) => {
      event.preventDefault(); close();
    }}>
      <h3 ref={heading} tabIndex={-1} id={`${id}-heading`}>KP · {name}</h3>
      <p>Only on-green measurements qualify. Blank is unknown; 0 ft 0 in explicitly records a hole-in-one.</p>
      {readOnly && <p role="status">KP entry is now read-only. Cancel to return to the group.</p>}
      <div className="kp-fields">
        <label>Feet<input inputMode="numeric" autoComplete="off" value={feet} onChange={(event) => { setFeet(event.target.value); }} /></label>
        <label>Inches (0–11)<input inputMode="numeric" autoComplete="off" value={inches} onChange={(event) => { setInches(event.target.value); }} /></label>
      </div>
      <label className="kp-check"><input type="checkbox" checked={onGreen} onChange={(event) => { setOnGreen(event.target.checked); }} />Ball finished on the green</label>
      <div className="kp-actions">
        <button type="button" disabled={locked || distance === null || !onGreen} onClick={() => {
          if (distance !== null && onGreen) { onChange({ kind: 'measured', inches: distance, onGreen: true, measurementId: crypto.randomUUID() }); close(); }
        }}>Stage measurement</button>
        <button type="button" disabled={locked} onClick={() => { onChange({ kind: 'no-measurement' }); close(); }}>No measurement</button>
        <button type="button" disabled={locked} onClick={() => { onChange(null); close(); }}>Clear KP entry</button>
        <button type="button" onClick={close}>Cancel</button>
      </div>
      <p>No measurement is not a missed green or zero. Other golfers can stay blank when someone in their group is closer.</p>
    </dialog>}
  </div>;
}
