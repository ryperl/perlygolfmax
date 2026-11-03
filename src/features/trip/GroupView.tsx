import type { Golfer } from '../../domain/trip';

interface GroupViewProps {
  readonly golfers: readonly Golfer[];
}

export function GroupView({ golfers }: GroupViewProps) {
  return (
    <section aria-labelledby="group-title">
      <p className="eyebrow">The good company</p>
      <h1 id="group-title">Meet the group.</h1>
      <p className="page-description">Twelve fictional golfers. No real identities, handicaps, or invitations.</p>
      {golfers.length === 0 ? <p className="panel">No golfers in this demo group.</p> : (
        <ul className="golfer-grid">
          {golfers.map((golfer, index) => (
            <li className="panel golfer-card" key={golfer.id}>
              <span className="avatar" aria-hidden="true">{golfer.displayName.split(' ').map((word) => word[0]).join('')}</span>
              <div><h2>{golfer.displayName}</h2><p>Demo golfer {index + 1}</p></div>
            </li>
          ))}
        </ul>
      )}
      <p className="boundary-note">Private invitations, roles, and handicap management are planned, not connected.</p>
    </section>
  );
}
