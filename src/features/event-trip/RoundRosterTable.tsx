import type { RoundSnapshot } from '../../domain/setup';
import type { PlayerCourseHandicap } from '../../domain/scoring';
import { CourseHandicap } from '../scoring';

export function RoundRosterTable({ round, playerIds, handicaps, label }: {
  readonly round: RoundSnapshot;
  readonly playerIds: readonly string[];
  readonly handicaps: ReadonlyMap<string, PlayerCourseHandicap>;
  readonly label: string;
}) {
  const names = new Map(round.players.map((player) => [player.playerId, player.displayName]));
  return <table className="event-trip-roster-table">
    <caption className="visually-hidden">{label} golfers and Course Handicaps</caption>
    <thead><tr><th scope="col">Golfer</th><th scope="col"><abbr title="Course Handicap">CH</abbr></th></tr></thead>
    <tbody>{playerIds.map((id) => <tr key={id}>
      <th scope="row"><span className="event-trip-player-name">{names.get(id) ?? 'Player unavailable'}</span></th>
      <td><CourseHandicap value={handicaps.get(id)} className="event-trip-roster-handicap" compact /></td>
    </tr>)}</tbody>
  </table>;
}
