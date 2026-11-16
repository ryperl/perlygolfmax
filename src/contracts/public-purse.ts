import type { PublicPursePool, PublicPurseSummary } from '../domain/public-purse.js';
import { purseCurrencies } from '../domain/purse.js';
import { isRecord, isUuid } from './events.js';
import { boundedText } from './catalog.js';

function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
const money = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const unique = (values: readonly string[]) => new Set(values.map((value) => value.toLowerCase())).size === values.length;

function round(value: unknown): value is PublicPurseSummary['rounds'][number] {
  return isRecord(value) && keys(value, ['id', 'label']) && isUuid(value.id) && boundedText(value.label, 303);
}

function pool(value: unknown): value is PublicPursePool {
  return isRecord(value) && keys(value, ['id', 'name', 'roundId', 'status', 'awardUnit', 'prizes', 'potMinor'])
    && isUuid(value.id) && boundedText(value.name) && (value.roundId === null || isUuid(value.roundId))
    && typeof value.status === 'string' && ['calculated', 'pending', 'unavailable'].includes(value.status)
    && typeof value.awardUnit === 'string' && ['per-golfer', 'per-team', 'pot'].includes(value.awardUnit)
    && Array.isArray(value.prizes) && value.prizes.every((prize: unknown) =>
      isRecord(prize) && keys(prize, ['place', 'amountMinor']) && money(prize.place) && prize.place > 0 && money(prize.amountMinor))
    && (value.awardUnit === 'pot' ? money(value.potMinor) && value.prizes.length === 0 : value.potMinor === null);
}

export function isPublicPurseSummary(value: unknown): value is PublicPurseSummary {
  if (!isRecord(value) || !keys(value, ['version', 'eventId', 'eventName', 'currency', 'needsReview', 'rounds', 'pools', 'players'])
    || value.version !== 1 || !isUuid(value.eventId) || !boundedText(value.eventName) || typeof value.needsReview !== 'boolean'
    || value.currency !== null && !purseCurrencies.some((currency) => currency === value.currency)
    || !Array.isArray(value.rounds) || !value.rounds.every(round)
    || !Array.isArray(value.pools) || !value.pools.every(pool) || !Array.isArray(value.players)) return false;
  const rounds = value.rounds;
  const pools = value.pools;
  if (!unique(rounds.map((round) => round.id)) || !unique(pools.map((entry) => entry.id))
    || pools.some((entry) => entry.roundId !== null && !rounds.some((round) => round.id === entry.roundId))
    || value.currency === null && pools.length > 0) return false;
  const playerIds: string[] = [];
  for (const player of value.players) {
    if (!isRecord(player) || !keys(player, ['playerId', 'displayName', 'amountMinor', 'poolIds'])
      || !isUuid(player.playerId) || !boundedText(player.displayName)
      || player.amountMinor !== null && !money(player.amountMinor) || !Array.isArray(player.poolIds)
      || !player.poolIds.every(isUuid)) return false;
    playerIds.push(player.playerId);
    if (!unique(player.poolIds) || player.poolIds.some((poolId) => !pools.some((entry) => entry.id === poolId && entry.status === 'calculated'))
      || player.amountMinor === 0 && player.poolIds.length > 0
      || typeof player.amountMinor === 'number' && player.amountMinor > 0 && player.poolIds.length === 0
      || value.currency === null && (player.amountMinor !== null || player.poolIds.length > 0)) return false;
  }
  return unique(playerIds);
}
