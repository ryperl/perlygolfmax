import type { RoundGameDefinition } from '../domain/games.js';
import type { RoundScores } from '../domain/scoring.js';
import { isRecord } from './events.js';

export class SweepRulesClientUpdateRequired extends Error {
  readonly status = 426;
  readonly code = 'SWEEP_RULES_CLIENT_UPDATE_REQUIRED';
  constructor() { super('Refresh the client before using independent Sweep rules.'); }
}

export function hasIndependentSweep(game: RoundGameDefinition): boolean {
  return game.kind === 'dots' && game.sweepRule === 'manual-v1'
    || game.kind === 'wolf' && game.highLowSweep === true;
}

export function requireSweepRules(games: readonly RoundGameDefinition[], supported: boolean): void {
  if (!supported && games.some(hasIndependentSweep)) throw new SweepRulesClientUpdateRequired();
}

/** Check immutable configurations and raw declarations, including nested history/aggregate wrappers. */
export function requireSweepRulesInValue(value: unknown): void {
  if (Array.isArray(value)) value.forEach(requireSweepRulesInValue);
  else if (isRecord(value)) {
    if (value.kind === 'dots' && Object.hasOwn(value, 'sweepRule')
      || value.kind === 'wolf' && Object.hasOwn(value, 'highLowSweep')
      || isRecord(value.counts) && Object.hasOwn(value.counts, 'sweep')
      || value.sweepRulesVersion === 2) throw new SweepRulesClientUpdateRequired();
    Object.values(value).forEach(requireSweepRulesInValue);
  }
}

export function sweepRulesRoundScores(round: RoundScores, supported = false): RoundScores {
  if (supported) return round;
  requireSweepRules(round.games?.configuration.games ?? [], false);
  const legacy = { ...round };
  delete legacy.sweepRulesVersion;
  requireSweepRulesInValue(legacy);
  return legacy;
}
