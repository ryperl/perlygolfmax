import type { RoundGameDefinition } from '../../../src/domain/games.js';
import { sameGameDefinitions } from '../../../src/domain/games.js';
import type { RoundSnapshot } from '../../../src/domain/setup.js';
import type { Scorecard } from '../../../src/domain/scoring.js';
import type { DotRoundInput } from '../../../src/domain/dot-context.js';
import { dotsDefinitionMatchesRound } from '../../../src/contracts/dots.js';
import { ApiError } from '../errors.js';
import { isPublicInternalGameDefinition, preservesProtectedGameDefinitions } from '../../../src/domain/internal-game-management.js';
import { hasConflictingSweep } from '../../../src/domain/internal-games.js';
import { linkedNinesGame } from '../../../src/domain/linked-dots.js';

export function isPublicInternalGame(game: RoundGameDefinition): boolean {
  return isPublicInternalGameDefinition(game);
}

export function dotRound(round: RoundSnapshot, cards: readonly Scorecard[]): DotRoundInput {
  return { layout: round.teeProfile.holes, groups: round.groups, cards,
    playerLayouts: round.players.map((player) => ({ playerId: player.playerId,
      layout: round.playerTees?.find((tee) => tee.playerId === player.playerId)?.profile.holes ?? round.teeProfile.holes })) };
}

export function definitionCards(round: RoundSnapshot): readonly Scorecard[] {
  return round.players.map((player) => ({ playerId: player.playerId, displayName: player.displayName,
    holes: [], etag: null, updatedAt: null }));
}

export function validateInternalGameChanges(
  before: readonly RoundGameDefinition[], after: readonly RoundGameDefinition[], round: RoundSnapshot,
  publicOnly: boolean,
): void {
  if (publicOnly && (!preservesProtectedGameDefinitions(before, after)
    || after.some((game) => {
      const previous = before.find((saved) => saved.id === game.id);
      return (!previous || !sameGameDefinitions([previous], [game]))
        && (!isPublicInternalGame(game) || previous !== undefined && !isPublicInternalGame(previous));
    }))) throw new ApiError(403, 'SCORES_OWNER_REQUIRED');
  const affected = new Set<number>();
  for (const game of after) {
    const previous = before.find((saved) => saved.id === game.id);
    if (publicOnly && previous && isPublicInternalGame(previous) && isPublicInternalGame(game)
      && (previous.kind === 'dots' || previous.kind === 'wolf' || previous.kind === 'churchy')
      && (game.kind === 'dots' || game.kind === 'wolf' || game.kind === 'churchy')
      && previous.groupNumber !== game.groupNumber) throw new ApiError(403, 'SCORES_OWNER_REQUIRED');
    if (previous?.kind === 'wolf' && game.kind === 'wolf' && previous.version !== game.version) {
      throw new ApiError(400, 'WOLF_REQUIRES_NEW_GAME');
    }
    if (previous?.kind === 'churchy' && game.kind === 'churchy' && previous.version !== game.version) {
      if (previous.version !== 2 || game.version !== 3) throw new ApiError(400, 'CHURCHY_REQUIRES_NEW_GAME');
      if (round.scoringStarted) throw new ApiError(409, 'CHURCHY_SETUP_LOCKED');
    }
    if (previous?.kind === 'dots' && game.kind === 'dots' && previous.version !== game.version) {
      if (previous.version !== 2 || game.version !== 3) {
        throw new ApiError(400, 'DOTS_REQUIRES_NEW_GAME');
      }
      if (round.scoringStarted) throw new ApiError(409, 'MATCH_SETUP_LOCKED');
    }
    if (previous && sameGameDefinitions([previous], [game])) continue;
    if (game.kind === 'dots' || game.kind === 'wolf' || game.kind === 'churchy') {
      if (previous && previous.kind !== game.kind) throw new ApiError(400, 'INTERNAL_GAME_REQUIRES_NEW_GAME');
      affected.add(game.groupNumber);
      if (previous) {
        affected.add(previous.groupNumber);
      }
    }
    if (round.scoringStarted && (game.kind === 'dots' || game.kind === 'wolf' && game.version === 2
      || previous?.kind === 'dots' || previous?.kind === 'wolf' && previous.version === 2)) {
      throw new ApiError(409, 'MATCH_SETUP_LOCKED');
    }
    if (game.kind === 'dots' && !dotsDefinitionMatchesRound(game, dotRound(round, definitionCards(round)))) {
      throw new ApiError(400, 'INVALID_DOTS_GROUP');
    }
  }
  if (publicOnly && round.scoringStarted && !sameGameDefinitions(before, after)) {
    throw new ApiError(409, 'MATCH_SETUP_LOCKED');
  }
  for (const groupNumber of affected) {
    const peers = after.filter((game) => (game.kind === 'dots' || game.kind === 'wolf' || game.kind === 'churchy')
      && game.groupNumber === groupNumber);
    const bases = peers.filter((game) => game.kind === 'wolf' || game.kind === 'churchy');
    if (bases.some((game) => game.kind === 'wolf' && hasConflictingSweep(after, game.id))) {
      throw new ApiError(400, 'INCOMPATIBLE_SWEEP_RULES');
    }
    if (bases.length > 1 || peers.some((game) => game.kind === 'churchy')
      && peers.some((game) => game.kind === 'dots')) throw new ApiError(400, 'INCOMPATIBLE_INTERNAL_GAMES');
    for (const game of peers) {
      if (game.kind !== 'dots') continue;
      const linked = game.mode === 'linked' ? after.find((entry) => entry.id === game.linkedGameId) : undefined;
      // Dots linked to Nines is checked separately: three golfers who each play alone.
      if (game.mode === 'linked' && linked?.kind === 'nines') {
        if (!linkedNinesGame(game, after, round.groups)) throw new ApiError(400, 'INVALID_DOTS_LINK');
        continue;
      }
      if (game.mode === 'linked' && (linked?.kind !== 'wolf' || linked.version !== 2
        || linked.groupNumber !== game.groupNumber || linked.playerIds.length !== game.playerIds.length
        || !linked.playerIds.every((id) => game.playerIds.includes(id))
        || after.filter((entry) => entry.kind === 'dots' && entry.mode === 'linked'
          && entry.linkedGameId === game.linkedGameId).length !== 1)) {
        throw new ApiError(400, 'INVALID_DOTS_LINK');
      }
    }
  }
}
