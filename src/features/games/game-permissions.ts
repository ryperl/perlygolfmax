import type { RoundScores } from '../../domain/scoring';
import { scorePermissions } from '../../domain/scoring';

export function canManageRoundGames(round: RoundScores): boolean {
  const permissions = scorePermissions(round);
  return permissions.canManageGames
    && (permissions.role === 'owner' || permissions.role === 'public' && round.quickRound === true);
}
