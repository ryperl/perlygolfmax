import type { GamePlayerResult } from '../../domain/games';

type ScoredPlayer = GamePlayerResult & { readonly totalPoints: number };

export interface RankedStanding {
  readonly player: ScoredPlayer;
  readonly position: number;
  readonly tied: boolean;
}
interface GameStandings {
  readonly ranked: readonly RankedStanding[];
  readonly awaiting: readonly GamePlayerResult[];
  readonly unavailable: readonly GamePlayerResult[];
  readonly provisional: boolean;
}

export function gameStandings(players: readonly GamePlayerResult[]): GameStandings {
  const scored = players.filter((player): player is ScoredPlayer =>
    player.status !== 'unavailable' && player.totalPoints !== null && player.holesScored > 0);
  scored.sort((left, right) => left.totalPoints === right.totalPoints ? 0 : left.totalPoints > right.totalPoints ? -1 : 1);
  const counts = new Map<number, number>();
  for (const player of scored) counts.set(player.totalPoints, (counts.get(player.totalPoints) ?? 0) + 1);
  let position = 0;
  let previous: number | null = null;
  const ranked: readonly RankedStanding[] = scored.map((player, index) => {
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
