import type { RoundGameDefinition } from '../domain/games.js';
import type { RoundScores } from '../domain/scoring.js';
import { isChurchyDefinition } from './churchy.js';
import { isRecord } from './events.js';

export class ChurchyNamesClientUpdateRequired extends Error {
  readonly status = 426;
  readonly code = 'CHURCHY_NAMES_CLIENT_UPDATE_REQUIRED';
  constructor() { super('Refresh the client before using custom Churchie game names.'); }
}

export function hasCustomChurchyName(game: RoundGameDefinition): boolean {
  return game.kind === 'churchy' && (game.version === 3
    ? game.name !== 'Churchie' && game.name !== 'Churcie' : game.name !== 'Churchy Game');
}

export function requireChurchyNames(games: readonly RoundGameDefinition[], supported: boolean): void {
  if (!supported && games.some(hasCustomChurchyName)) throw new ChurchyNamesClientUpdateRequired();
}

/** Historical configurations are immutable; refuse an unreadable response instead of rewriting their names. */
export function requireChurchyNamesInValue(value: unknown): void {
  if (isChurchyDefinition(value)) requireChurchyNames([value], false);
  else if (Array.isArray(value)) value.forEach(requireChurchyNamesInValue);
  else if (isRecord(value)) Object.values(value).forEach(requireChurchyNamesInValue);
}

export function churchyNamesRoundScores(round: RoundScores, supported = false): RoundScores {
  if (supported) return round.churchyCustomNames === true ? round : { ...round, churchyCustomNames: true };
  requireChurchyNames(round.games?.configuration.games ?? [], false);
  const legacy = { ...round };
  delete legacy.churchyCustomNames;
  return legacy;
}
