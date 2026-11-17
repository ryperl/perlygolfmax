import type { RoundDifferential } from '../../domain/round-differential';
import { differentialExplanation, formatDifferential } from './presentation';
import './differentials.css';

export interface PlayerDifferentialProps {
  readonly value?: RoundDifferential;
}

export function PlayerDifferential({ value }: PlayerDifferentialProps) {
  return <div className="player-differential" role="group" aria-label="Estimated round differential">
    <p><span>Estimated differential: </span>
      {value?.status === 'available' ? <><strong>{formatDifferential(value.differentialTenths)}</strong>
        <span> · Adjusted gross {value.adjustedGross}</span></>
        : <span className="differential-state" aria-label="Estimated differential unavailable">—</span>}
    </p>
    <p className="differential-explanation">{differentialExplanation}</p>
  </div>;
}
