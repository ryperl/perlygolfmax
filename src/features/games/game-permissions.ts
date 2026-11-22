import type { RoundScores } from '../../domain/scoring';
import { scorePermissions, supportsDotsSpecials, supportsIndividualDotsPlayerCount } from '../../domain/scoring';
import type { RoundGameDefinition } from '../../domain/games';

export function canManageAllRoundGames(round: RoundScores): boolean {
  const permissions = scorePermissions(round);
  return permissions.canManageGames
    && (permissions.role === 'owner' || permissions.role === 'public' && round.quickRound === true);
}

export function canManageRoundGames(round: RoundScores): boolean {
  const permissions = scorePermissions(round);
  return canManageAllRoundGames(round) || permissions.role === 'public' && round.internalGamesSupported === true
    && permissions.canManageInternalGames === true && !round.setupLocked && round.eventStatus !== 'archived';
}

export function canManageGame(round: RoundScores, game: RoundGameDefinition): boolean {
  if (round.eventStatus === 'archived') return false;
  if (game.kind === 'wolf' && game.version === 2 && !round.wolfRulesVersions?.includes(2)) return false;
  if (game.kind === 'wolf' && game.version === 2 && game.highLowSweep === true && round.wolfHighLowSweep !== true) return false;
  if (game.kind === 'dots' && game.version === 2 && !round.dotsRulesVersions?.includes(2)) return false;
  if (game.kind === 'dots' && game.highLow && round.dotsHighLowVersion !== 1) return false;
  if (game.kind === 'dots' && game.mode === 'individual' && !supportsIndividualDotsPlayerCount(round, game.playerIds.length)) return false;
  if (game.kind === 'dots' && !supportsDotsSpecials(round, game.specials)) return false;
  if (game.kind === 'dots' && game.sweepRule === 'manual-v1' && round.dotsManualSweep !== true) return false;
  if (game.kind === 'churchy' && (round.churchyEnabled !== true || game.version !== 1 && !round.churchyRulesVersions?.includes(game.version))) return false;
  if (game.kind === 'dots' || game.kind === 'wolf' || game.kind === 'nassau' || game.kind === 'match-play') {
    if (round.setupLocked) return false;
  }
  if (canManageAllRoundGames(round)) return true;
  return canManageRoundGames(round) && (game.kind === 'dots' || game.kind === 'wolf' && game.version === 2
    || game.kind === 'churchy' && round.churchyEnabled === true);
}
