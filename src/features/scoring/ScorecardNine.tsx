import { scoreEntryText } from '../../contracts/scoring';
import type { CourseHole } from '../../domain/catalog';
import type { HoleScore, Scorecard } from '../../domain/scoring';
import { cardTotalText } from './scorecard-presentation';
import './scorecard-recap.css';

function scoreMark(score: HoleScore | undefined, par: number) {
  if (!score || score.kind !== 'strokes') return { className: '', description: '' };
  const relative = score.strokes - par;
  if (relative <= -2) return { className: 'score-eagle', description: 'eagle or better' };
  if (relative === -1) return { className: 'score-birdie', description: 'birdie' };
  if (relative === 0) return { className: '', description: 'par' };
  return relative === 1 ? { className: 'score-bogey', description: 'bogey' }
    : { className: 'score-double', description: 'double bogey or more' };
}

export function ScorecardNine({ label, subtotal, layout, fullLayout, cards, onPlayerSelect }: {
  readonly label: string;
  readonly subtotal: 'Out' | 'In';
  readonly layout: readonly CourseHole[];
  readonly fullLayout: readonly CourseHole[];
  readonly cards: readonly Scorecard[];
  readonly onPlayerSelect?: (playerId: string) => void;
}) {
  const showTotal = subtotal === 'In' || fullLayout.length === layout.length;
  return <section className="recap-nine">
    <h4>{label}</h4>
    <div className="recap-scroll" role="region" aria-label={`${label} scorecard`} tabIndex={0}>
      <table className="recap-table">
        <caption>{label} scorecard</caption>
        <thead><tr><th scope="col">Hole</th>{layout.map((hole) => <th scope="col" key={hole.number}>{hole.number}</th>)}
          <th scope="col">{subtotal}</th>{showTotal && <th scope="col">Total</th>}</tr></thead>
        <tbody>
          <tr className="recap-par"><th scope="row">Par</th>{layout.map((hole) => <td key={hole.number}>{hole.par}</td>)}
            <td>{layout.reduce((sum, hole) => sum + hole.par, 0)}</td>{showTotal && <td>{fullLayout.reduce((sum, hole) => sum + hole.par, 0)}</td>}</tr>
          <tr className="recap-course-row"><th scope="row">Yards</th>{layout.map((hole) => <td key={hole.number}>{hole.length}</td>)}
            <td>{layout.reduce((sum, hole) => sum + hole.length, 0)}</td>{showTotal && <td>{fullLayout.reduce((sum, hole) => sum + hole.length, 0)}</td>}</tr>
          <tr className="recap-course-row"><th scope="row">Stroke index</th>{layout.map((hole) => <td key={hole.number}>{hole.allocation}</td>)}
            <td>—</td>{showTotal && <td>—</td>}</tr>
          {cards.map((card) => {
            const saved = new Map(card.holes.map((hole) => [hole.number, hole.score]));
            return <tr className="recap-score-row" key={card.playerId}>
              <th scope="row">{onPlayerSelect ? <button type="button" className="scorecard-player-link"
                aria-label={`Open scorecard for ${card.displayName}`} onClick={() => { onPlayerSelect(card.playerId); }}>{card.displayName}</button> : card.displayName}</th>
              {layout.map((hole) => {
                const score = saved.get(hole.number);
                const mark = scoreMark(score, hole.par);
                const text = score ? scoreEntryText(score) || '—' : '?';
                return <td key={hole.number}><span className={`score-mark ${mark.className}${text.length > 2 ? ' score-token' : ''}`}
                  title={mark.description || undefined}
                  aria-label={score ? `Hole ${String(hole.number)}: ${score.kind === 'unplayed' ? 'unplayed' : text}${mark.description ? `, ${mark.description}` : ''}` : `Hole ${String(hole.number)}: score unavailable`}>{text}</span></td>;
              })}
              <td className="recap-subtotal">{cardTotalText(card, layout)}</td>{showTotal && <td className="recap-subtotal">{cardTotalText(card, fullLayout)}</td>}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </section>;
}
