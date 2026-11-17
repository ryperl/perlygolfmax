import type { RoundGameDefinition } from './games.js';
import { sameGameDefinitions } from './games.js';

export function isPublicInternalGameDefinition(game: RoundGameDefinition): boolean {
  return game.kind === 'dots' || game.kind === 'wolf' && game.version === 2 || game.kind === 'churchy';
}

export function preservesProtectedGameDefinitions(
  before: readonly RoundGameDefinition[], after: readonly RoundGameDefinition[],
): boolean {
  return sameGameDefinitions(before.filter((game) => !isPublicInternalGameDefinition(game)),
    after.filter((game) => !isPublicInternalGameDefinition(game)))
    && after.every((game) => {
      const previous = before.find((entry) => entry.id === game.id);
      return !previous || previous.kind === game.kind;
    });
}
