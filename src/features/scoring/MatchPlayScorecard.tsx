import type { CourseHole } from '../../domain/catalog';
import type { NassauMatchResult } from '../../domain/nassau';
import type { Scorecard } from '../../domain/scoring';
import type { ScorecardGame } from './scorecard-presentation';
import { matchSideName as sideName } from '../nassau';

type Position = { readonly status: 'known'; readonly value: number }
  | { readonly status: 'pending' | 'unavailable' };
type PlayerName = Pick<Scorecard, 'playerId' | 'displayName'>;

function positions(match: NassauMatchResult) {
  const holes = new Map<number, Position>();
  let value = 0, played = 0;
  let blocked: 'pending' | 'unavailable' | undefined;
  for (const hole of match.holes) {
    if (hole.status === 'unavailable' || hole.status === 'complete' && hole.outcome === null) blocked = 'unavailable';
    else if (hole.status === 'pending' && !blocked) blocked = 'pending';
    if (blocked) holes.set(hole.number, { status: blocked });
    else {
      value += hole.outcome === 'side-a' ? 1 : hole.outcome === 'side-b' ? -1 : 0;
      played += 1;
      holes.set(hole.number, { status: 'known', value });
    }
  }
  const hasGap = match.holes.slice(played).some((hole) => hole.status === 'complete');
  const current: Position = blocked === 'unavailable' ? { status: 'unavailable' }
    : played === 0 || hasGap ? { status: 'pending' } : { status: 'known', value };
  return { holes, current, played, remaining: match.holes.length - played };
}

function positionText(position: Position, sideA: boolean, accessible = false): string {
  if (position.status !== 'known') return accessible ? position.status : '—';
  const value = position.value * (sideA ? 1 : -1);
  return value === 0 ? accessible ? 'all square' : 'AS'
    : `${String(Math.abs(value))} ${value > 0 ? accessible ? 'up' : 'UP' : accessible ? 'down' : 'DN'}`;
}

export function MatchPlaySummary({ game, players, playerId }: {
  readonly game: ScorecardGame | undefined;
  readonly players: readonly PlayerName[];
  readonly playerId?: string;
}) {
  if (game?.definition.kind !== 'match-play') return null;
  const matches = game.result?.nassau?.matches.filter((match) =>
    !playerId || [...match.sideA.playerIds, ...match.sideB.playerIds].includes(playerId)) ?? [];
  if (playerId && !game.definition.sides.some((side) => side.playerIds.includes(playerId))) return null;
  if (!matches.length) return <p className="scorecard-game-unavailable">Saved match positions unavailable. Refresh to retry.</p>;
  return <section className="scorecard-match-summaries" aria-label={`${game.definition.name} match positions`}>
    {matches.map((match) => {
      const progress = positions(match);
      const sideA = !playerId || match.sideA.playerIds.includes(playerId);
      const own = sideA ? match.sideA : match.sideB, other = sideA ? match.sideB : match.sideA;
      const leader = progress.current.status === 'known' && progress.current.value < 0 ? match.sideB : match.sideA;
      const current = progress.current;
      return <section key={match.id} className="scorecard-match-summary" aria-label={`${sideName(own, players)} vs ${sideName(other, players)}`}>
        <div><h3>{sideName(own, players)} vs {sideName(other, players)}</h3>
          <strong>{current.status === 'known' ? playerId
            ? positionText(current, sideA) : current.value === 0 ? 'All square'
              : `${sideName(leader, players)} ${String(Math.abs(current.value))} UP`
            : current.status === 'pending' ? 'Position pending' : 'Position unavailable'}</strong></div>
        <p>{current.status === 'known' ? progress.remaining === 0 ? 'Complete saved match'
          : `Thru ${String(progress.played)} · ${String(progress.remaining)} holes to play`
          : current.status === 'unavailable' ? 'Saved match inputs need review.'
            : 'Waiting for saved hole results; later positions are not assumed.'}</p>
      </section>;
    })}
  </section>;
}

export function MatchPlayRows({ game, card, players, layout, showTotal }: {
  readonly game: ScorecardGame;
  readonly card: Scorecard;
  readonly players: readonly PlayerName[];
  readonly layout: readonly CourseHole[];
  readonly showTotal: boolean;
}) {
  if (game.definition.kind !== 'match-play'
    || !game.definition.sides.some((side) => side.playerIds.includes(card.playerId))) return null;
  const matches = game.result?.nassau?.matches.filter((match) =>
    [...match.sideA.playerIds, ...match.sideB.playerIds].includes(card.playerId)) ?? [];
  if (!matches.length) return <tr className="recap-match-row" aria-label={`${card.displayName} · Match Play position unavailable`}>
    <th scope="row">Match position<small>Unavailable</small></th>
    {layout.map((hole) => <td key={hole.number} aria-label={`${card.displayName}, after hole ${String(hole.number)} match position: unavailable`}>—</td>)}
    <td className="recap-subtotal">—</td>{showTotal && <td className="recap-subtotal">—</td>}
  </tr>;
  return <>{matches.map((match) => {
    const sideA = match.sideA.playerIds.includes(card.playerId);
    const opponent = sideName(sideA ? match.sideB : match.sideA, players);
    const progress = positions(match);
    const final = progress.remaining === 0 ? positionText(progress.current, sideA) : '—';
    return <tr className="recap-match-row" key={match.id}
      aria-label={`${card.displayName} · ${game.definition.name} match position vs ${opponent}`}>
      <th scope="row">Match position<small>vs {opponent}</small></th>
      {layout.map((hole) => {
        const position = progress.holes.get(hole.number) ?? { status: 'unavailable' as const };
        const lead = position.status === 'known' ? position.value * (sideA ? 1 : -1) : 0;
        return <td key={hole.number} className={lead > 0 ? 'recap-match-up' : undefined}
          aria-label={`${card.displayName}, after hole ${String(hole.number)} match position vs ${opponent}: ${positionText(position, sideA, true)}`}>
          {positionText(position, sideA)}
        </td>;
      })}
      <td className="recap-subtotal" aria-label="Match position is cumulative, not a stroke subtotal">—</td>
      {showTotal && <td className="recap-subtotal" aria-label={`${card.displayName} final match position vs ${opponent}: ${progress.remaining === 0 ? positionText(progress.current, sideA, true) : 'pending'}`}>{final}</td>}
    </tr>;
  })}</>;
}
