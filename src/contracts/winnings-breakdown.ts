import type { PlayerWinningsBreakdown, WinningsPart } from '../domain/winnings-breakdown.js';
import { purseCurrencies } from '../domain/purse.js';
import { boundedText } from './catalog.js';
import { isRecord, isUuid } from './events.js';

const money = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const positive = (value: unknown): value is number => money(value) && value > 0;
function keys(value: Record<string, unknown>, expected: readonly string[]) {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
function part(value: unknown): value is WinningsPart {
  if (!isRecord(value) || !positive(value.amountMinor)) return false;
  switch (value.kind) {
    case 'place': return keys(value, ['kind', 'amountMinor', 'rank', 'teamName', 'memberCount', 'tiedEntrants', 'tiePolicy', 'awardPlace'])
      && positive(value.rank) && (value.teamName === null || boundedText(value.teamName))
      && positive(value.memberCount) && positive(value.tiedEntrants) && positive(value.awardPlace)
      && (value.tiePolicy === 'pooled' || value.tiePolicy === 'organizer');
    case 'kp': return keys(value, ['kind', 'amountMinor', 'holeNumber', 'distanceInches', 'splitCount', 'resolution'])
      && positive(value.holeNumber) && value.holeNumber <= 18 && money(value.distanceInches) && positive(value.splitCount)
      && ['unique', 'selected', 'split'].some((entry) => entry === value.resolution)
      && (value.resolution === 'split' ? value.splitCount > 1 : value.splitCount === 1);
    case 'event-skins': return keys(value, ['kind', 'amountMinor', 'skins', 'perSkinMinor'])
      && positive(value.skins) && positive(value.perSkinMinor)
      && BigInt(value.skins) * BigInt(value.perSkinMinor) === BigInt(value.amountMinor);
    case 'manual': return keys(value, ['kind', 'amountMinor', 'recipientCount']) && positive(value.recipientCount);
    default: return false;
  }
}
export function isPlayerWinningsBreakdown(value: unknown): value is PlayerWinningsBreakdown {
  if (!isRecord(value) || !keys(value, ['version', 'eventId', 'playerId', 'displayName', 'currency', 'amountMinor',
    'needsReview', 'pendingPools', 'unavailablePools', 'awards'])
    || value.version !== 1 || !isUuid(value.eventId) || !isUuid(value.playerId) || !boundedText(value.displayName)
    || value.currency !== null && !purseCurrencies.some((entry) => entry === value.currency)
    || value.amountMinor !== null && !money(value.amountMinor) || typeof value.needsReview !== 'boolean'
    || !money(value.pendingPools) || !money(value.unavailablePools) || !Array.isArray(value.awards)) return false;
  const ids = new Set<string>();
  let total = 0n;
  for (const award of value.awards) {
    if (!isRecord(award) || !keys(award, ['poolId', 'poolName', 'roundName', 'amountMinor', 'parts'])
      || !isUuid(award.poolId) || ids.has(award.poolId) || !boundedText(award.poolName)
      || award.roundName !== null && !boundedText(award.roundName) || !positive(award.amountMinor)
      || !Array.isArray(award.parts) || !award.parts.every(part)
      || !value.needsReview && award.parts.reduce((sum, entry) => sum + BigInt(entry.amountMinor), 0n) !== BigInt(award.amountMinor)) return false;
    ids.add(award.poolId);
    total += BigInt(award.amountMinor);
  }
  return (value.amountMinor === null || total === BigInt(value.amountMinor))
    && (value.currency !== null || value.amountMinor === null && ids.size === 0);
}
