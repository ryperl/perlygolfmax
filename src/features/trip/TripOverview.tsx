import type { Trip } from '../../domain/trip';

interface TripOverviewProps {
  readonly trip: Trip;
}

export function TripOverview({ trip }: TripOverviewProps) {
  const firstRound = trip.rounds[0];

  return (
    <>
      <section className="hero" aria-labelledby="trip-title">
        <div className="hero-copy">
          <p className="eyebrow">Good company. Great golf.</p>
          <h1 id="trip-title">{trip.name}</h1>
          <p className="hero-description">Five rounds, familiar faces, and a little friendly competition. Your trip, all in one place.</p>
          <p className="location">{trip.locationLabel} <span aria-hidden="true">/</span> {trip.dateLabel}</p>
          <a className="primary-link" href="#rounds">Explore the rounds <span aria-hidden="true">↗</span></a>
        </div>
        <div className="course-art" aria-hidden="true">
          <span className="art-sun" />
          <span className="art-hill art-hill-back" />
          <span className="art-hill art-hill-front" />
          <span className="art-green" />
          <span className="art-flag" />
          <span className="art-ball" />
          <span className="art-caption">A little further down the fairway.</span>
        </div>
      </section>
      <section className="trip-stats" aria-label="Demo trip at a glance">
        <div><strong>{trip.golfers.length.toString().padStart(2, '0')}</strong><span>golfers</span></div>
        <div><strong>{trip.rounds.length.toString().padStart(2, '0')}</strong><span>rounds</span></div>
        <div><strong>One</strong><span>unforgettable trip</span></div>
      </section>
      <div className="overview-grid">
        <section className="panel" aria-labelledby="first-round-title">
          <div className="section-heading"><p className="eyebrow">The opening round</p><a href="#rounds">All rounds <span aria-hidden="true">→</span></a></div>
          <h2 id="first-round-title">{firstRound?.courseName ?? 'No rounds scheduled'}</h2>
          {firstRound ? <p>{firstRound.dayLabel} <span aria-hidden="true">·</span> {firstRound.teeTimeLabel} <span aria-hidden="true">·</span> Sample tee time</p> : <p>A round will appear here when the itinerary is available.</p>}
          <div className="inset-note"><span className="note-mark" aria-hidden="true">01</span><p>Room for the whole group.<br /><span>Pairings and score entry are coming later.</span></p></div>
        </section>
        <section className="panel next-chapter" aria-labelledby="next-title">
          <p className="eyebrow">The next chapter</p>
          <h2 id="next-title">Less admin.<br />More time on the course.</h2>
          <p>Scorecards, results, and leaderboards are planned. This foundation is a read-only preview, not a live scoreboard.</p>
          <span className="badge">In development</span>
        </section>
      </div>
    </>
  );
}
