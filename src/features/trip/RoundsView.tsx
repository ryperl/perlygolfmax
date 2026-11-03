import type { Round } from '../../domain/trip';

interface RoundsViewProps {
  readonly rounds: readonly Round[];
}

export function RoundsView({ rounds }: RoundsViewProps) {
  return (
    <section aria-labelledby="rounds-title">
      <p className="eyebrow">The itinerary</p>
      <h1 id="rounds-title">Five days. Fairways ahead.</h1>
      <p className="page-description">Fictional courses and sample tee times, not confirmed bookings.</p>
      {rounds.length === 0 ? <p className="panel">No rounds scheduled yet.</p> : (
        <ol className="round-list">
          {rounds.map((round) => (
            <li className="panel round-card" key={round.id}>
              <span className="round-number" aria-hidden="true">{round.number.toString().padStart(2, '0')}</span>
              <div><p className="eyebrow">Round {round.number} / {round.dayLabel}</p><h2>{round.courseName}</h2></div>
              <div className="tee-time"><strong>{round.teeTimeLabel}</strong><span>Sample tee time</span></div>
            </li>
          ))}
        </ol>
      )}
      <p className="boundary-note">Score entry, pairings, and round results are not available in this demo.</p>
    </section>
  );
}
