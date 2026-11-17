import { useEffect, useId, useRef, useState } from 'react';
import type { RoundDifferential } from '../../domain/round-differential';
import { differentialExplanation, formatDifferential } from './presentation';
import './differentials.css';

export interface DifferentialPlayer {
  readonly playerId: string;
  readonly displayName: string;
}

export interface RoundDifferentialsProps {
  readonly values: readonly RoundDifferential[];
  readonly players: readonly DifferentialPlayer[];
}

function DifferentialHeading({ name, wide, compact }: {
  readonly name: string;
  readonly wide: string;
  readonly compact: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const container = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    close.current?.focus({ preventScroll: true });
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissEscape);
    };
  }, [open]);
  return <span className="differential-heading" ref={container} onBlur={(event) => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className="differential-info-button" aria-label={`About ${name}`}
      aria-expanded={open} aria-controls={id} aria-haspopup="dialog" onClick={() => { setOpen((value) => !value); }}>
      <span className="differential-heading-wide" aria-hidden="true">{wide}</span>
      <span className="differential-heading-compact" aria-hidden="true">{compact}</span>
      <svg className="differential-info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" />
        <path d="M12 11v6" /><circle cx="12" cy="7" r=".8" fill="currentColor" stroke="none" /></svg>
    </button>
    {open && <span id={id} className="differential-name-popup" role="dialog" aria-label={name}>
      <span>{name}</span>
      <button ref={close} type="button" className="differential-name-close" aria-label={`Close ${name}`}
        onClick={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </span>}
  </span>;
}

export function RoundDifferentials({ values, players }: RoundDifferentialsProps) {
  const descriptionId = useId();
  const byPlayer = new Map(values.map((value) => [value.playerId, value]));
  return <section className="round-differentials" aria-label="Round differentials">
    <p id={descriptionId} className="differential-explanation">{differentialExplanation}</p>
    <table aria-describedby={descriptionId}>
      <caption>Round differentials</caption>
      <thead><tr>
        <th scope="col">Golfer</th>
        <th scope="col" aria-label="Adjusted gross">
          <DifferentialHeading name="Adjusted Gross" wide="Adj. Gross" compact="A.G" />
        </th>
        <th scope="col" aria-label="Estimated differential">
          <DifferentialHeading name="Estimated Differential" wide="Est. Diff." compact="E.D" />
        </th>
      </tr></thead>
      <tbody>{players.map((player) => {
        const value = byPlayer.get(player.playerId);
        return <tr key={player.playerId}>
          <th scope="row">{player.displayName}</th>
          <td>{value?.status === 'available' ? value.adjustedGross : <span aria-label="Adjusted gross unavailable">—</span>}</td>
          <td>{value?.status === 'available' ? formatDifferential(value.differentialTenths)
            : <span className="differential-state" aria-label="Estimated differential unavailable">—</span>}</td>
        </tr>;
      })}</tbody>
    </table>
  </section>;
}
