import type { RoundDifferential } from '../domain/round-differential.js';
import { isRecord, isUuid } from './events.js';

const unavailableReasons = [
  'unsupported-hole-count', 'invalid-tee-layout', 'missing-tee-ratings', 'uncaptured-handicap-index',
  'missing-handicap-index', 'invalid-handicap-index', 'missing-stroke-index', 'non-numeric-score',
  'invalid-score-data', 'arithmetic-range',
] as const;

/** Strict allowlist: no observation, actor, score input, or invented method fields. */
export function isRoundDifferential(value: unknown): value is RoundDifferential {
  if (!isRecord(value) || !isUuid(value.playerId) || value.method !== 'estimated-18-hole' || value.pcc !== 0) return false;
  const keys = ['playerId', 'method', 'pcc', 'status', 'differentialTenths', 'adjustedGross'];
  if (value.status !== 'available') keys.push('reason');
  if (Object.keys(value).length !== keys.length
    || !keys.every((key) => Object.hasOwn(value, key))) return false;
  if (value.status === 'available') {
    // Eighteen positive numeric holes; source par <= 10 and NDB <= par + 5.
    return typeof value.differentialTenths === 'number' && Number.isSafeInteger(value.differentialTenths)
      && !Object.is(value.differentialTenths, -0)
      && typeof value.adjustedGross === 'number' && Number.isSafeInteger(value.adjustedGross)
      && value.adjustedGross >= 18 && value.adjustedGross <= 270
      // Source ratings are > 0 and <= 150, slope is an integer >= 1.
      && value.differentialTenths >= Math.min(0, 1130 * (value.adjustedGross - 150))
      && value.differentialTenths <= 1130 * value.adjustedGross;
  }
  return value.differentialTenths === null && value.adjustedGross === null
    && (value.status === 'pending' ? value.reason === 'incomplete-card'
      : value.status === 'unavailable' && unavailableReasons.some((reason) => value.reason === reason));
}

/** Optionally binds all rows to the round roster; order is presentation, not rank. */
export function isRoundDifferentials(
  value: unknown, playerIds?: readonly string[],
): value is readonly RoundDifferential[] {
  if (!Array.isArray(value) || !value.every(isRoundDifferential)) return false;
  const ids = value.map((row) => row.playerId.toLowerCase());
  if (new Set(ids).size !== ids.length) return false;
  if (playerIds === undefined) return true;
  const expected = new Set(playerIds.map((id) => id.toLowerCase()));
  return expected.size === playerIds.length && ids.length === expected.size && ids.every((id) => expected.has(id));
}
