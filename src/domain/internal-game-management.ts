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

type GameKind = NonNullable<RoundGameDefinition['kind']> | 'stableford';

/** Wolf, Dots and Churchie share sides or money, so an existing game cannot become one of them. */
const sharedSideKinds: readonly GameKind[] = ['dots', 'wolf', 'churchy'];

/**
 * Whether a saved game may be resaved, under the same ID, as another kind. An existing game cannot
 * become Wolf, Dots or Churchie, and a saved Wolf, Dots or Churchie game cannot become Nines, which
 * would leave a Dots game linked to it with the wrong golfers. Other changes keep working as before.
 */
export function savedGameKindChangeAllowed(saved: GameKind, next: GameKind): boolean {
  if (saved === next) return true;
  if (sharedSideKinds.includes(next)) return false;
  return !(next === 'nines' && sharedSideKinds.includes(saved));
}
