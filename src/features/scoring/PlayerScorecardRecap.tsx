import { scoreEntryText } from '../../contracts/scoring';
import type { CourseHole } from '../../domain/catalog';
import type { RoundScores, Scorecard, ScoredHole } from '../../domain/scoring';
import { summarizeGross } from '../../domain/scoring';
import './scorecard-recap.css';

function recordedTotal(holes: readonly ScoredHole[], expected: number): string {
  const summary = summarizeGross(holes);
  if (summary.recordedHoles === 0) return '—';
  return `${String(summary.recordedStrokes)}${holes.length !== expected || summary.completeGross === null ? '*' : ''}`;
}

function NineScorecard({ label, subtotal, layout, card }: {
  readonly label: string;
  readonly subtotal: string;
  readonly layout: readonly CourseHole[];
  readonly card: Scorecard;
}) {
  const saved = new Map(card.holes.map((hole) => [hole.number, hole]));
  const entries = layout.flatMap((hole) => {
    const entry = saved.get(hole.number);
    return entry ? [entry] : [];
  });
  return <section className="recap-nine">
    <h4>{label}</h4>
    <div className="recap-scroll" role="region" aria-label={`${label} scorecard for ${card.displayName}`} tabIndex={0}>
      <table className="recap-table">
        <caption>{label} — {card.displayName}</caption>
        <thead><tr><th scope="col">Hole</th>{layout.map((hole) => <th scope="col" key={hole.number}>{hole.number}</th>)}<th scope="col">{subtotal}</th></tr></thead>
        <tbody>
          <tr><th scope="row">Yards</th>{layout.map((hole) => <td key={hole.number}>{hole.length}</td>)}<td>{layout.reduce((sum, hole) => sum + hole.length, 0)}</td></tr>
          <tr><th scope="row">Par</th>{layout.map((hole) => <td key={hole.number}>{hole.par}</td>)}<td>{layout.reduce((sum, hole) => sum + hole.par, 0)}</td></tr>
          <tr><th scope="row">Stroke index</th>{layout.map((hole) => <td key={hole.number}>{hole.allocation}</td>)}<td>—</td></tr>
          <tr className="recap-score-row"><th scope="row">Score</th>{layout.map((hole) => {
            const entry = saved.get(hole.number);
            return <td key={hole.number}>{entry ? scoreEntryText(entry.score) || '—' : 'Unavailable'}</td>;
          })}<td>{recordedTotal(entries, layout.length)}</td></tr>
        </tbody>
      </table>
    </div>
  </section>;
}

export function PlayerScorecardRecap({ round, card }: { readonly round: RoundScores; readonly card: Scorecard }) {
  const layout = [...round.layout].sort((left, right) => left.number - right.number);
  const front = layout.filter((hole) => hole.number <= 9);
  const back = layout.filter((hole) => hole.number > 9);
  const summary = summarizeGross(card.holes);
  const missing = layout.some((hole) => !card.holes.some((entry) => entry.number === hole.number));
  const complete = !missing && summary.completeGross !== null;
  const totalRating = round.teeRatings?.find((rating) => rating.type === 'Total');
  return <section className="player-scorecard-recap" aria-label={`${card.displayName} full scorecard`}>
    <header className="recap-heading">
      <div><h3>{card.displayName}</h3><p>{round.roundName} — {round.courseName}</p>
        <p>{round.teeName} / {round.teeCategory}{totalRating ? ` · Course rating ${String(totalRating.course)} · Slope ${String(totalRating.slope)}` : ''}</p>
      </div>
      <p className="recap-total">{complete ? 'Complete gross' : 'Recorded total'}:
        <strong>{summary.recordedHoles === 0 ? '—' : summary.recordedStrokes}</strong>
        <span>{complete ? `${String(layout.length)} holes completed` : 'Incomplete — not a final gross result'}</span>
      </p>
    </header>
    <div className="recap-sections">
      <NineScorecard label="Front nine" subtotal="Out" layout={front} card={card} />
      {back.length > 0 && <NineScorecard label="Back nine" subtotal="In" layout={back} card={card} />}
    </div>
    <p className="recap-legend">— unplayed · X picked up · X7 picked up with 7 reported · DNF did not finish.
      {' '}* Recorded subtotal includes entered pickup values and is incomplete, not a completed gross score.
      {' '}No net or Stableford calculation is shown.</p>
    {!complete && <p>{summary.numericHoles}/{layout.length} holes completed with numeric strokes;
      {' '}{summary.pickedUpHoles} picked up; {summary.didNotFinishHoles} DNF; {summary.unplayedHoles} unplayed.</p>}
    {missing && <p role="alert">Some saved hole data is unavailable. Refresh before relying on this scorecard.</p>}
  </section>;
}
