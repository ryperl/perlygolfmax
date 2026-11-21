import type { RoundGameDefinition } from '../domain/games.js';
import type { RoundScores } from '../domain/scoring.js';
import { isRecord } from './events.js';
import type { GameHandicapRule } from '../domain/game-handicaps.js';

export function isGameHandicapValue(value: unknown, rule: GameHandicapRule | undefined): value is number | null {
  return value === null || typeof value === 'number' && Number.isSafeInteger(value)
    && (rule === 'full-course-v1' || value >= 0);
}

export function isGameHandicapSettings(value: Record<string, unknown>): boolean {
  return !Object.hasOwn(value, 'handicapRule') || (value.handicapRule === 'full-course-v1'
    || value.handicapRule === 'group-low-v1' && value.basis === 'net') && value.kind !== 'dots';
}

export function hasGameHandicapRules(game: RoundGameDefinition): boolean {
  return 'handicapRule' in game
    || game.kind === 'skins' && game.carryOrder !== undefined
    || game.kind === 'nassau' && game.playOrder !== undefined;
}

export class GameHandicapClientUpdateRequired extends Error {
  readonly status = 426;
  readonly code = 'GAME_HANDICAP_CLIENT_UPDATE_REQUIRED';
  constructor() { super('Refresh the client before using explicit game handicap and carry-order rules.'); }
}

export function requireGameHandicapRules(games: readonly RoundGameDefinition[], supported: boolean): void {
  if (!supported && games.some(hasGameHandicapRules)) throw new GameHandicapClientUpdateRequired();
}

export function requireGameHandicapRulesInValue(value: unknown): void {
  if (Array.isArray(value)) value.forEach(requireGameHandicapRulesInValue);
  else if (isRecord(value)) {
    if (Object.hasOwn(value, 'handicapRule') || Object.hasOwn(value, 'carryOrder') || Object.hasOwn(value, 'playOrder')) throw new GameHandicapClientUpdateRequired();
    Object.values(value).forEach(requireGameHandicapRulesInValue);
  }
}

export function gameHandicapRoundScores(round: RoundScores, supported = false): RoundScores {
  if (supported) return round;
  requireGameHandicapRules(round.games?.configuration.games ?? [], false);
  const legacy = { ...round };
  delete legacy.gameHandicapRules;
  return legacy;
}
