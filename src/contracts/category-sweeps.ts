import type { RoundScores } from '../domain/scoring.js';
import type { RoundGameDefinition } from '../domain/games.js';
import { calculateInternalGameResults } from '../domain/internal-games.js';
import { sameJsonValue } from './round-context.js';

export class CategorySweepsClientUpdateRequired extends Error {
  readonly status = 426;
  readonly code = 'CATEGORY_SWEEPS_CLIENT_UPDATE_REQUIRED';
  constructor() { super('Refresh the client before using automatic Dots category sweeps.'); }
}

export function hasCategorySweeps(games: readonly RoundGameDefinition[]): boolean {
  return games.some((game) => game.kind === 'dots'
    && game.specials.some((special) => special.kind === 'long-drive')
    && game.specials.some((special) => special.kind === 'blue-plate'));
}

/** Unmarked old responses remain readable; never publish different successful legacy totals. */
export function categorySweepRoundScores(round: RoundScores, negotiated = false): RoundScores {
  if (negotiated) return round;
  const legacy = { ...round };
  delete legacy.dotsCategorySweepsVersion;
  if (round.dotsCategorySweepsVersion !== 1) return legacy;
  const games = round.games?.configuration.games ?? [];
  if (!hasCategorySweeps(games)) return legacy;
  const expected = calculateInternalGameResults(games, { ...round,
    stringRulesVersion: round.stringRulesVersion ?? 1, dotsCategorySweepsVersion: 0 });
  for (const result of round.games?.results ?? []) {
    if ((result.kind === 'dots' || result.kind === 'wolf') && !sameJsonValue(result, expected.get(result.gameId))) {
      throw new CategorySweepsClientUpdateRequired();
    }
  }
  return legacy;
}
