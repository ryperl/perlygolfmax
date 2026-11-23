import type { RoundGameDefinition } from '../domain/games.js';
import type { RoundScores } from '../domain/scoring.js';
import { isRecord } from './events.js';

export class DotsRulesV3ClientUpdateRequired extends Error {
  readonly status = 426;
  readonly code = 'DOTS_RULES_V3_CLIENT_UPDATE_REQUIRED';
  constructor() { super('Refresh before using rotating Dots order and High/Low rules.'); }
}

export function requireDotsRulesV3(games: readonly RoundGameDefinition[], supported: boolean): void {
  requireDotsRulesV3InValue(games, supported);
}

export function requireDotsRulesV3InValue(value: unknown, supported = false): void {
  if (supported) return;
  if (Array.isArray(value)) {
    for (const entry of value) requireDotsRulesV3InValue(entry);
  } else if (isRecord(value)) {
    if (value.kind === 'dots' && value.version === 3
      || isRecord(value.highLow) && value.highLow.version === 2) throw new DotsRulesV3ClientUpdateRequired();
    for (const entry of Object.values(value)) requireDotsRulesV3InValue(entry);
  }
}

export function dotsRulesV3RoundScores(round: RoundScores, supported = false): RoundScores {
  requireDotsRulesV3InValue(round, supported);
  if (supported) return round;
  return {
    ...round,
    ...(round.dotsRulesVersions ? { dotsRulesVersions: round.dotsRulesVersions.filter((version) => version !== 3) } : {}),
    ...(round.dotsHighLowVersion === 2 ? { dotsHighLowVersion: 1 } : {}),
  };
}
