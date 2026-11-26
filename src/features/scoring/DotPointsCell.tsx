import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent, RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Scorecard } from '../../domain/scoring';
import type { ScorecardGame } from './scorecard-presentation';
import type { DotHoleBreakdown } from './dot-hole-breakdown';
import { dotHoleBreakdown } from './dot-hole-breakdown';

/** Gap kept between the popover and the viewport edge or its cell, in pixels. */
const popoverMargin = 12;
const popoverGap = 8;

function placePopover(popup: HTMLDivElement, anchor: DOMRect) {
  const bounds = popup.getBoundingClientRect();
  const rightmost = window.innerWidth - bounds.width - popoverMargin;
  const left = Math.max(popoverMargin, Math.min(rightmost, anchor.left));
  const fitsBelow = anchor.bottom + bounds.height + popoverGap <= window.innerHeight - popoverMargin;
  const top = fitsBelow ? anchor.bottom + popoverGap : Math.max(popoverMargin, anchor.top - bounds.height - popoverGap);
  popup.style.left = `${String(left)}px`;
  popup.style.top = `${String(top)}px`;
}

/**
 * After a dismissal that did not hand focus to another control (a tap on plain scorecard text, a scroll or a
 * resize), focus would fall back to the page body. Put it back on the cell so keyboard navigation resumes there.
 * The check waits a task because a tap moves focus only after its pointerdown handlers have run.
 */
function useFocusRestore(trigger: RefObject<HTMLButtonElement | null>) {
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => { window.clearTimeout(timer.current); }, []);
  return useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const focusLost = document.activeElement === null || document.activeElement === document.body;
      if (focusLost) trigger.current?.focus({ preventScroll: true });
    }, 0);
  }, [trigger]);
}

/**
 * Keeps the open popover honest about where it points: it closes on an outside tap, Escape, or when its cell
 * moves (page scroll or resize). Scrolling inside the popover itself keeps it open.
 */
function useDismissablePopover(open: boolean, close: () => void, trigger: RefObject<HTMLButtonElement | null>,
  popup: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) return;
    const anchor = trigger.current?.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    if (anchor && popup.current) placePopover(popup.current, anchor);
    popup.current?.focus({ preventScroll: true });

    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (popup.current?.contains(event.target) || trigger.current?.contains(event.target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      trigger.current?.focus({ preventScroll: true });
    };
    const onMove = (event: Event) => {
      if (event.target instanceof Node && popup.current?.contains(event.target)) return;
      const current = trigger.current?.getBoundingClientRect();
      const cellMoved = current?.left !== anchor?.left || current?.top !== anchor?.top;
      const viewportChanged = window.innerWidth !== viewportWidth || window.innerHeight !== viewportHeight;
      if (cellMoved || viewportChanged) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, close, trigger, popup]);
}

function statusMessage(status: DotHoleBreakdown['status']): string | null {
  if (status === 'pending') return 'Pending saved inputs; listed awards are known only, not a final total.';
  if (status === 'unavailable') return 'Saved breakdown unavailable. Refresh and review inputs.';
  return null;
}

function BreakdownBody({ value }: { readonly value: DotHoleBreakdown }) {
  const message = statusMessage(value.status);
  return <>
    <p className="scorecard-dot-context">{value.context}</p>
    <p>
      Base <strong>{value.base ?? '—'}</strong> · Specials <strong>{value.specials ?? '—'}</strong>
      {' · '}Total <strong>{value.total ?? '—'}</strong>
    </p>
    {message && <p role="status">{message}</p>}
    {value.entries.length > 0 && <ul>{value.entries.map((entry, index) => <li key={index}>
      {entry.label} <strong>{entry.dots}</strong>{entry.source && <small> · Source: {entry.source}</small>}
    </li>)}</ul>}
    {value.entries.length === 0 && value.status === 'complete' && <p>No dots awarded on this hole.</p>}
  </>;
}

/**
 * A scorecard dot cell that keeps its saved value visible and opens a small breakdown popover on tap.
 * The breakdown uses only results already on the page; it never reads audits or makes a request.
 */
export function DotPointsCell({ game, card, number, text, description, players }: {
  readonly game: ScorecardGame;
  readonly card: Scorecard;
  readonly number: number;
  readonly text: number | string;
  /** The saved value or its pending/unavailable state, announced with the button's name. */
  readonly description: string;
  readonly players: readonly Pick<Scorecard, 'playerId' | 'displayName'>[];
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const id = useId();
  const restoreFocus = useFocusRestore(trigger);
  const close = useCallback(() => {
    setOpen(false);
    restoreFocus();
  }, [restoreFocus]);
  useDismissablePopover(open, close, trigger, popup);
  const value = open ? dotHoleBreakdown(game, card.playerId, number, players) : undefined;
  const closeAndRefocus = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  // Focus moving back to the cell is left to the cell's own click, which toggles the popover closed.
  const closeOnBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (event.currentTarget.contains(next) || next === trigger.current) return;
    close();
  };

  return <>
    <button type="button" ref={trigger} className="scorecard-dot-detail" aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? id : undefined} aria-label={`${card.displayName}, hole ${String(number)} dots: ${description}. Show breakdown`}
      onClick={() => { setOpen((current) => !current); }}>{text}</button>
    {open && value && createPortal(<div ref={popup} id={id} role="dialog" tabIndex={-1}
      aria-label={`${card.displayName} · Hole ${String(number)} dots`} className="scorecard-dot-popover"
      onBlur={closeOnBlur}>
      <header>
        <strong>Hole {number} · {card.displayName}</strong>
        <button type="button" aria-label="Close dot breakdown" onClick={closeAndRefocus}>×</button>
      </header>
      <BreakdownBody value={value} />
    </div>, document.body)}
  </>;
}
