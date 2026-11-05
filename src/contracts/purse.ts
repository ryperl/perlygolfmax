import type {
  PurseCalculation, PurseFunding, PursePlan, PursePlacePrize, PursePool, PurseTieResolution, PurseView,
} from '../domain/purse.js';
import { calculatePurse, purseCurrencies, validatePursePlanContext } from '../domain/purse.js';
import type { RoundScores } from '../domain/scoring.js';
import type { EventWorkspace } from '../domain/setup.js';
import { isRecord, isUuid } from './events.js';

function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
function money(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function ids(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isUuid)
    && new Set(value.map((id: string) => id.toLowerCase())).size === value.length;
}
function funding(value: unknown): value is PurseFunding {
  return isRecord(value) && (value.kind === 'fixed' && keys(value, ['kind', 'budgetMinor']) && money(value.budgetMinor)
    || value.kind === 'buy-in' && keys(value, ['kind', 'buyInMinor']) && money(value.buyInMinor));
}
function prize(value: unknown): value is PursePlacePrize {
  return isRecord(value) && keys(value, ['place', 'amountMinor'])
    && typeof value.place === 'number' && Number.isSafeInteger(value.place) && value.place >= 1 && money(value.amountMinor);
}
function pool(value: unknown): value is PursePool {
  if (!isRecord(value) || !isUuid(value.id) || typeof value.name !== 'string'
    || !value.name.trim() || value.name !== value.name.trim() || value.name.length > 100 || !isRecord(value.source)) return false;
  const source = value.source;
  if (source.kind === 'manual') {
    return keys(source, ['kind']) && keys(value, ['id', 'name', 'source', 'awardUnit', 'amountMinor', 'recipientIds'])
      && value.awardUnit === 'pot' && money(value.amountMinor) && ids(value.recipientIds);
  }
  if (!(source.kind === 'overall' && keys(source, ['kind'])
    || source.kind === 'round-game' && keys(source, ['kind', 'roundId', 'gameId'])
      && isUuid(source.roundId) && isUuid(source.gameId))) return false;
  if (!keys(value, ['id', 'name', 'source', 'awardUnit', 'prizes', 'tiePolicy'])
    || !(value.awardUnit === 'per-golfer' || value.awardUnit === 'per-team' && source.kind === 'round-game')
    || !['pooled', 'organizer'].includes(String(value.tiePolicy))
    || !Array.isArray(value.prizes) || !value.prizes.every(prize)) return false;
  return new Set(value.prizes.map((entry: PursePlacePrize) => entry.place)).size === value.prizes.length;
}

/** Shape only: transport size limits belong to the caller, not golfer/prize count caps. */
export function isPursePlan(value: unknown): value is PursePlan {
  if (!isRecord(value) || !keys(value, ['eventId', 'currency', 'funding', 'pools']) || !isUuid(value.eventId)
    || !purseCurrencies.some((currency) => currency === value.currency) || !funding(value.funding)
    || !Array.isArray(value.pools) || !value.pools.every(pool)) return false;
  return new Set(value.pools.map((entry: PursePool) => entry.id.toLowerCase())).size === value.pools.length;
}

/** Saved source configurations must be supplied even when no holes have been played. */
export function isPursePlanForWorkspace(
  value: unknown, workspace: EventWorkspace, roundScores: readonly RoundScores[],
): value is PursePlan {
  return isPursePlan(value) && validatePursePlanContext(value, workspace, roundScores).length === 0;
}

export function isPurseTieResolution(value: unknown): value is PurseTieResolution {
  return isRecord(value) && keys(value, ['poolId', 'rank', 'orderedEntrantIds']) && isUuid(value.poolId)
    && typeof value.rank === 'number' && Number.isSafeInteger(value.rank) && value.rank >= 1
    && ids(value.orderedEntrantIds) && value.orderedEntrantIds.length >= 2;
}

/** Rejects unknown pools, duplicate decisions and decisions for a no-longer-current tied set. */
export function isPurseTieResolutions(
  value: unknown, plan: PursePlan, workspace: EventWorkspace, roundScores: readonly RoundScores[],
): value is readonly PurseTieResolution[] {
  return isPursePlan(plan) && Array.isArray(value) && value.every(isPurseTieResolution)
    && !calculatePurse(plan, workspace, roundScores, value).issues.some((entry) => entry.code === 'invalid-resolution');
}

function same(value: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(value) && value.length === expected.length
      && expected.every((entry: unknown, index: number) => same(value[index], entry));
  }
  if (isRecord(expected)) {
    return isRecord(value) && keys(value, Object.keys(expected))
      && Object.keys(expected).every((key) => same(value[key], expected[key]));
  }
  return value === expected;
}

/** Context is authoritative and separately validated; never trust source data embedded in a response. */
export function isPurseCalculation(
  value: unknown, plan: PursePlan, workspace: EventWorkspace, roundScores: readonly RoundScores[],
  resolutions: readonly PurseTieResolution[] = [],
): value is PurseCalculation {
  // Stored decisions may become stale after legitimate score changes. Reads must preserve
  // the unavailable result so organizers can inspect and repair them; writes use the strict guard.
  return isPursePlan(plan) && Array.isArray(resolutions) && resolutions.every(isPurseTieResolution)
    && same(value, calculatePurse(plan, workspace, roundScores, resolutions));
}

export function isPurseView(
  value: unknown, workspace: EventWorkspace, roundScores: readonly RoundScores[],
): value is PurseView {
  return isRecord(value) && keys(value, ['plan', 'resolutions', 'calculation']) && isPursePlan(value.plan)
    && value.plan.eventId === workspace.event.id
    && Array.isArray(value.resolutions) && value.resolutions.every(isPurseTieResolution)
    && isPurseCalculation(value.calculation, value.plan, workspace, roundScores, value.resolutions);
}
