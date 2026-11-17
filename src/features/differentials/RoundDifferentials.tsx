import { useId } from 'react';
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

export function RoundDifferentials({ values, players }: RoundDifferentialsProps) {
  const descriptionId = useId();
  const byPlayer = new Map(values.map((value) => [value.playerId, value]));
  return <section className="round-differentials" aria-label="Round differentials">
    <p id={descriptionId} className="differential-explanation">{differentialExplanation}</p>
    <table aria-describedby={descriptionId}>
      <caption>Round differentials</caption>
      <thead><tr>
        <th scope="col">Golfer</th>
        <th scope="col" aria-label="Adjusted gross" title="Adjusted gross">
          <span className="differential-heading-wide" aria-hidden="true">Adj. Gross</span>
          <span className="differential-heading-compact" aria-hidden="true">A.G</span>
        </th>
        <th scope="col" aria-label="Estimated differential" title="Estimated differential">
          <span className="differential-heading-wide" aria-hidden="true">Est. Diff.</span>
          <span className="differential-heading-compact" aria-hidden="true">E.D</span>
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
