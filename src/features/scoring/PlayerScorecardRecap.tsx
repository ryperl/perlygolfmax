import type { RoundScores, Scorecard } from '../../domain/scoring';
import { ScorecardNine } from './ScorecardNine';
import { summarizeCard } from './scorecard-presentation';
import './scorecard-recap.css';

export function PlayerScorecardRecap({ round, card }: { readonly round: RoundScores; readonly card: Scorecard }) {
  const layout = [...round.layout].sort((left, right) => left.number - right.number);
  const front = layout.filter((hole) => hole.number <= 9);
  const back = layout.filter((hole) => hole.number > 9);
  const summary = summarizeCard(card, layout);
  const totalRating = round.teeRatings?.find((rating) => rating.type === 'Total');
  return <section className="player-scorecard-recap" aria-label={`${card.displayName} full scorecard`}>
    <header className="recap-heading">
      <div><h3>{card.displayName}</h3><p>{round.roundName} — {round.courseName}</p>
        <p>{round.teeName} / {round.teeCategory}{totalRating ? ` · Course rating ${String(totalRating.course)} · Slope ${String(totalRating.slope)}` : ''}</p>
      </div>
      <p className="recap-total">{summary.complete ? 'Gross total' : 'Recorded total'}:
        <strong>{summary.total ?? '—'}</strong>
        {!summary.complete && <span>Incomplete</span>}
      </p>
    </header>
    <div className="recap-sections">
      <ScorecardNine label="Front nine" subtotal="Out" layout={front} fullLayout={layout} cards={[card]} />
      {back.length > 0 && <ScorecardNine label="Back nine" subtotal="In" layout={back} fullLayout={layout} cards={[card]} />}
    </div>
    {!summary.complete && <p className="scorecard-incomplete">* Incomplete recorded total.</p>}
    {summary.missing && <p role="alert">Some saved hole data is unavailable. Refresh before relying on this scorecard.</p>}
  </section>;
}
