import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './dots-entry.css';

export function DotsEntryButton({ name, gameName, disabled, staged, children, showGameName = false, holeNumber }: {
  readonly name: string;
  readonly gameName: string;
  readonly disabled: boolean;
  readonly staged: boolean;
  readonly children: ReactNode;
  readonly showGameName?: boolean;
  readonly holeNumber?: number;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (open) { dialog.current?.showModal(); heading.current?.focus(); }
  }, [open]);
  function close() { dialog.current?.close(); setOpen(false); trigger.current?.focus(); }
  return <div className="dots-entry">
    <button ref={trigger} type="button" disabled={disabled} aria-label={`Dots for ${name} · ${gameName}`}
      onClick={() => { setOpen(true); }}>Dots{showGameName && <> · {gameName}</>}{staged && <small> · unsaved</small>}</button>
    {open && <dialog ref={dialog} className="dots-entry-dialog" aria-labelledby={`${id}-heading`}
      onCancel={(event) => { event.preventDefault(); close(); }}>
      <header><h3 ref={heading} tabIndex={-1} id={`${id}-heading`}>Dots · {name}</h3>
        <button type="button" onClick={close}>Done</button></header>
      <small>{gameName}{holeNumber !== undefined && ` · Hole ${String(holeNumber)}`}</small>
      {children}
    </dialog>}
  </div>;
}
