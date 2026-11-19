import type { RoundGameDefinition } from '../../../src/domain/games.js';
import { ApiError } from '../errors.js';

/** Old writers cannot acknowledge a correction whose derived String awards they cannot decode. */
export function requireStringRules(games: readonly RoundGameDefinition[], supported: boolean): void {
  if (!supported && games.some((game) => (game.kind === 'dots' || game.kind === 'churchy' && game.version === 3)
    && game.specials.some((special) => special.kind === 'string' || special.kind === 'birdy-string'))) {
    throw new ApiError(426, 'STRING_RULES_CLIENT_UPDATE_REQUIRED');
  }
}
