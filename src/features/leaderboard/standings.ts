import type { GamePlayerResult, GameTeamResult } from '../../domain/games';
import { gameResultTotal } from '../../domain/games';

type StandingResult = GamePlayerResult | GameTeamResult;

export interface RankedStanding<T extends StandingResult = GamePlayerResult> {
  readonly player: T;
  readonly position: number;
  readonly tied: boolean;
}
interface GameStandings<T extends StandingResult> {
  readonly ranked: readonly RankedStanding<T>[];
  readonly awaiting: readonly T[];
  readonly unavailable: readonly T[];
  readonly provisional: boolean;
}

export function gameStandings<T extends StandingResult>(players: readonly T[], direction: 1 | -1 = -1): GameStandings<T> {
  const scored = players.filter((player) =>
    player.status !== 'unavailable' && gameResultTotal(player) !== null && player.holesScored > 0);
  scored.sort((left, right) => {
    const a = gameResultTotal(left);
    const b = gameResultTotal(right);
    return a === null || b === null || a === b ? 0 : (a < b ? -1 : 1) * direction;
  });
  const counts = new Map<number, number>();
  for (const player of scored) {
    const total = gameResultTotal(player);
    if (total !== null) counts.set(total, (counts.get(total) ?? 0) + 1);
  }
  let position = 0;
  let previous: number | null = null;
  const ranked: readonly RankedStanding<T>[] = scored.map((player, index) => {
    const total = gameResultTotal(player);
    if (previous !== total) position = index + 1;
    previous = total;
    return { player, position, tied: total !== null && (counts.get(total) ?? 0) > 1 };
  });
  return {
    ranked,
    awaiting: players.filter((player) => player.status !== 'unavailable' && (gameResultTotal(player) === null || player.holesScored === 0)),
    unavailable: players.filter((player) => player.status === 'unavailable'),
    provisional: players.some((player) => player.status !== 'complete'),
  };
}
