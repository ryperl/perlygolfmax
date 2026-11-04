import { useState } from 'react';
import type { TeeProfile } from '../../domain/catalog';

export function TeeProfileSelector({ profiles }: { readonly profiles: readonly TeeProfile[] }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = profiles.find((profile) => profile.id === selectedId);
  return <section className="tee-selector" aria-label="Tee preview">
    <label>Preview tee<select value={selected?.id ?? ''} onChange={(event) => {
      setSelectedId(event.target.value ? Number(event.target.value) : null);
    }}>
      <option value="">Select a tee</option>
      {profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name} / {profile.category}</option>)}
    </select></label>
    {profiles.length === 0 && <p>No tee profiles available.</p>}
    {selected && <TeeProfilePreview key={selected.id} profile={selected} />}
  </section>;
}

export function TeeProfilePreview({ profile }: { readonly profile: TeeProfile }) {
  const holes = [...profile.holes].sort((left, right) => left.number - right.number);
  const rating = profile.ratings.find((item) => item.type === 'Total');
  return <details className="tee-preview">
    <summary className="tee-preview-summary">
      {profile.name} / {profile.category} · {profile.holeCount} holes · {profile.totalYardage} yards · par {profile.totalPar}
      {rating && ` · Rating ${String(rating.course)} / Slope ${String(rating.slope)}`}
    </summary>
    <p>Stroke index is the source hole handicap allocation, not a golfer&apos;s Handicap Index. Viewing this profile does not select it for a round.</p>
    <table className="tee-preview-table">
      <caption>Hole yardage, par and stroke index</caption>
      <thead><tr><th scope="col">Hole</th><th scope="col">Yards</th><th scope="col">Par</th><th scope="col">Stroke index</th></tr></thead>
      <tbody>{holes.map((hole) => <tr key={hole.number}>
        <th scope="row">{hole.number}</th><td>{hole.length}</td><td>{hole.par}</td><td>{hole.allocation}</td>
      </tr>)}</tbody>
      <tfoot><tr><th scope="row">Total</th><td>{profile.totalYardage}</td><td>{profile.totalPar}</td><td>Not applicable</td></tr></tfoot>
    </table>
    <table className="tee-preview-table">
      <caption>Course and slope ratings</caption>
      <thead><tr><th scope="col">Section</th><th scope="col">Course rating</th><th scope="col">Slope rating</th><th scope="col">Bogey rating</th></tr></thead>
      <tbody>{profile.ratings.map((rating) => <tr key={rating.type}>
        <th scope="row">{rating.type}</th><td>{rating.course}</td><td>{rating.slope}</td><td>{rating.bogey}</td>
      </tr>)}</tbody>
    </table>
  </details>;
}
