import type { NassauSide } from '../../domain/nassau';
import type { Scorecard } from '../../domain/scoring';

export function matchSideName(side: NassauSide, players: readonly Pick<Scorecard, 'playerId' | 'displayName'>[]): string {
  if (players.length === 0) return side.name;
  const names = side.playerIds.map((id) => players.find((player) => player.playerId === id)?.displayName
    ?? 'Golfer unavailable').join(' + ');
  return side.playerIds.length === 1 || /^Side [A-C1-3]$/.test(side.name) ? names : `${names} (${side.name})`;
}
