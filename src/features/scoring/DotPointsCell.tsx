import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RoundScores, Scorecard } from '../../domain/scoring';
import type { ScorecardGame } from './scorecard-presentation';
import { dotHoleBreakdown } from './dot-hole-breakdown';

export function DotPointsCell({ game, card, number, text, players, round }: {
  readonly game: ScorecardGame; readonly card: Scorecard; readonly number: number;
  readonly text: number | string; readonly players: readonly Pick<Scorecard, 'playerId' | 'displayName'>[];
  readonly round?: RoundScores | undefined;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const id = useId();
  const value = open ? dotHoleBreakdown(game, card.playerId, number, players, round) : undefined;
  useEffect(() => {
    if (!open) return;
    const anchor = trigger.current?.getBoundingClientRect(), bounds = popup.current?.getBoundingClientRect();
    const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight;
    if (anchor && bounds && popup.current) {
      popup.current.style.left = `${String(Math.max(12, Math.min(window.innerWidth - bounds.width - 12, anchor.left)))}px`;
      popup.current.style.top = `${String(anchor.bottom + bounds.height + 8 <= window.innerHeight - 12
        ? anchor.bottom + 8 : Math.max(12, anchor.top - bounds.height - 8))}px`;
    }
    popup.current?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !popup.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus({ preventScroll: true }); }
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && popup.current?.contains(event.target)) return;
      const current = trigger.current?.getBoundingClientRect();
      if (current?.left !== anchor?.left || current?.top !== anchor?.top
        || window.innerWidth !== viewportWidth || window.innerHeight !== viewportHeight) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', scroll);
    return () => {
      document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', scroll);
    };
  }, [open]);
  return <>
    <button type="button" ref={trigger} className="scorecard-dot-detail" aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? id : undefined} aria-label={`${card.displayName}, hole ${String(number)} dot breakdown`}
      onClick={() => { setOpen((value) => !value); }}>{text}</button>
    {open && value && createPortal(<div ref={popup} id={id} role="dialog" tabIndex={-1}
      aria-label={`${card.displayName} · Hole ${String(number)} dots`} className="scorecard-dot-popover"
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <header><strong>Hole {number} · {card.displayName}</strong><button type="button" aria-label="Close dot breakdown"
        onClick={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }}>×</button></header>
      <p className="scorecard-dot-context">{value.context}</p>
      <p>Base <strong>{value.base ?? '—'}</strong> · Specials <strong>{value.specials ?? '—'}</strong> · Total <strong>{value.total ?? '—'}</strong></p>
      {value.status !== 'complete' && <p role="status">{value.status === 'pending' ? 'Pending saved inputs; listed awards are known only, not a final total.' : 'Saved breakdown unavailable. Refresh and review inputs.'}</p>}
      {value.entries.length > 0 ? <ul>{value.entries.map((entry, index) => <li key={index}>
        {entry.label} <strong>{entry.dots}</strong>{entry.source && <small> · Source: {entry.source}</small>}
      </li>)}</ul> : value.status === 'complete' && <p>No dots awarded on this hole.</p>}
    </div>, document.body)}
  </>;
}
