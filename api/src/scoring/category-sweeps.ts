import type { RoundGameDefinition } from '../../../src/domain/games.js';
import { CategorySweepsClientUpdateRequired, hasCategorySweeps } from '../../../src/contracts/category-sweeps.js';

export function requireCategorySweeps(games: readonly RoundGameDefinition[], supported: boolean): void {
  if (!supported && hasCategorySweeps(games)) throw new CategorySweepsClientUpdateRequired();
}
