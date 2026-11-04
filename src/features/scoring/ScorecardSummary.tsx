import type { RoundScores, Scorecard } from '../../domain/scoring';
import { summarizeGross } from '../../domain/scoring';
import './scoring.css';

export function ScorecardSummary({ card }: { readonly card: Scorecard }) {
  const summary = summarizeGross(card.holes);
  return <div>
    <p>Saved numeric strokes: {summary.recordedStrokes} across {summary.numericHoles}/{summary.totalHoles} holes.
      {' '}Unplayed: {summary.unplayedHoles}; picked up: {summary.pickedUpHoles}; DNF: {summary.didNotFinishHoles}.
      {' '}{summary.completeGross === null ? 'Incomplete — no final gross total.' : `Complete gross: ${String(summary.completeGross)}.`}</p>
    <p>{card.etag === null ? 'No saved card yet.' : `Saved card updated ${card.updatedAt ?? ''}.`}</p>
  </div>;
}

export function SavedScoreLayout({ round }: { readonly round: RoundScores }) {
  return <div>
    <p>Saved course: {round.courseName}. Tee: {round.teeName} / {round.teeCategory}.</p>
    <div className="score-layout" tabIndex={0} role="region" aria-label="Saved source layout, horizontally scrollable">
      <table><caption>Saved source layout</caption><thead><tr><th>Hole</th><th>Source hole</th><th>Par</th><th>Yardage</th><th>Stroke index</th></tr></thead>
        <tbody>{round.layout.map((hole) => <tr key={hole.number}><th scope="row">{hole.number}</th><td>{hole.sourceId}</td><td>{hole.par}</td><td>{hole.length}</td><td>{hole.allocation}</td></tr>)}</tbody>
      </table>
    </div>
  </div>;
}
