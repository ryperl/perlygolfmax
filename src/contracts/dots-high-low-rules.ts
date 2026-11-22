import type { RoundGameDefinition } from '../domain/games.js';
import type { RoundScores } from '../domain/scoring.js';
import { isRecord } from './events.js';

export class DotsHighLowClientUpdateRequired extends Error {
  readonly status = 426;
  readonly code = 'DOTS_HIGH_LOW_CLIENT_UPDATE_REQUIRED';
  constructor() { super('Refresh before using Modified Sixes High/Low.'); }
}

export function requireDotsHighLow(games: readonly RoundGameDefinition[], supported: boolean): void {
  if (!supported && games.some((game) => game.kind === 'dots' && game.version === 2 && game.highLow !== undefined)) {
    throw new DotsHighLowClientUpdateRequired();
  }
}

export function dotsHighLowRoundScores(round: RoundScores, supported = false): RoundScores {
  requireDotsHighLowInValue(round, supported);
  if (supported) return round;
  const legacy = { ...round };
  delete legacy.dotsHighLowVersion;
  return legacy;
}

export function requireDotsHighLowInValue(value: unknown, supported = false): void {
  if (supported) return;
  if (Array.isArray(value)) {
    for (const entry of value) requireDotsHighLowInValue(entry);
  } else if (isRecord(value)) {
    if (value.kind === 'dots' && value.highLow !== undefined || value.dotsHighLow !== undefined) {
      throw new DotsHighLowClientUpdateRequired();
    }
    for (const entry of Object.values(value)) requireDotsHighLowInValue(entry);
  }
}
