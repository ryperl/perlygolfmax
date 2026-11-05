import type { GamePlayerResult, GameTeamResult } from '../../domain/games';

type StandingResult = GamePlayerResult | GameTeamResult;
type ScoredPlayer<T extends StandingResult> = T & { readonly totalPoints: number };

export interface RankedStanding<T extends StandingResult = GamePlayerResult> {
  readonly player: ScoredPlayer<T>;
  readonly position: number;
  readonly tied: boolean;
}
interface GameStandings<T extends StandingResult> {
  readonly ranked: readonly RankedStanding<T>[];
  readonly awaiting: readonly T[];
  readonly unavailable: readonly T[];
  readonly provisional: boolean;
}

export function gameStandings<T extends StandingResult>(players: readonly T[]): GameStandings<T> {
  const scored = players.filter((player): player is ScoredPlayer<T> =>
    player.status !== 'unavailable' && player.totalPoints !== null && player.holesScored > 0);
  scored.sort((left, right) => left.totalPoints === right.totalPoints ? 0 : left.totalPoints > right.totalPoints ? -1 : 1);
  const counts = new Map<number, number>();
  for (const player of scored) counts.set(player.totalPoints, (counts.get(player.totalPoints) ?? 0) + 1);
  let position = 0;
  let previous: number | null = null;
  const ranked: readonly RankedStanding<T>[] = scored.map((player, index) => {
    if (previous !== player.totalPoints) position = index + 1;
    previous = player.totalPoints;
    return { player, position, tied: (counts.get(player.totalPoints) ?? 0) > 1 };
  });
  return {
    ranked,
    awaiting: players.filter((player) => player.status !== 'unavailable' && (player.totalPoints === null || player.holesScored === 0)),
    unavailable: players.filter((player) => player.status === 'unavailable'),
    provisional: players.some((player) => player.status !== 'complete'),
  };
}
