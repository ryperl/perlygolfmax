import type { RoundGroup } from './setup.js';
import type { GameUnavailableReason } from './games.js';

export type GameHandicapRule = 'full-course-v1' | 'group-low-v1';

export interface GameHandicapSettings {
  readonly handicapRule?: GameHandicapRule;
}

export interface CapturedGameHandicap {
  readonly playerId: string;
  readonly handicap: number | null | string;
}

/** Inputs are already-calculated captured CH, including nine-hole and personal tees. */
export function gameHandicap(
  rule: GameHandicapRule, playerId: string, inputs: readonly CapturedGameHandicap[], groups: readonly RoundGroup[],
): number | GameUnavailableReason {
  function captured(id: string): number | GameUnavailableReason {
    const matches = inputs.filter((input) => input.playerId === id);
    const value = matches[0]?.handicap;
    if (matches.length !== 1) return 'missing-score-data';
    if (typeof value !== 'number') return value === 'missing-stroke-index' || value === 'missing-tee-ratings'
      || value === 'invalid-handicap-index' ? value : 'missing-handicap-index';
    return Number.isSafeInteger(value) ? value : 'invalid-handicap-index';
  }
  const value = captured(playerId);
  if (typeof value !== 'number' || rule === 'full-course-v1') return value;
  const matches = groups.filter((group) => group.playerIds.includes(playerId));
  const group = matches[0];
  if (matches.length !== 1 || !group || new Set(group.playerIds).size !== group.playerIds.length) return 'missing-score-data';
  const values: number[] = [];
  for (const id of group.playerIds) {
    const handicap = captured(id);
    if (typeof handicap !== 'number') return handicap;
    values.push(handicap);
  }
  const minimum = values.reduce((low, handicap) => Math.min(low, handicap), value);
  const relative = BigInt(value) - BigInt(minimum);
  return relative <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(relative) : 'invalid-handicap-index';
}
