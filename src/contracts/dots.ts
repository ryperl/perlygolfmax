import { calculateDots, dotsManualKinds, dotsSpecialCatalog } from '../domain/dots.js';
import type { DotsGameDefinition, DotsHoleRecord, DotsResults, DotsRotationStart, DotsSpecialKind } from '../domain/dots.js';
import type { DotHoleContext, DotRoundInput } from '../domain/dot-context.js';
import { isEventRevision, isRecord, isUuid } from './events.js';
import { sameJsonValue } from './round-context.js';
export { dotsDefinitionMatchesRound, dotsRecordsMatchGame } from '../domain/dots.js';

function keys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const positive = (value: unknown): value is number => integer(value) && value > 0;
const distinct = (values: readonly unknown[]) => new Set(values).size === values.length;
const special = (value: unknown): value is DotsSpecialKind => dotsSpecialCatalog.some((entry) => entry.kind === value);
const members = (value: unknown, individual = false): value is string[] => Array.isArray(value)
  && (individual ? value.length >= 1 && value.length <= 4 : value.length === 4) && value.every(isUuid) && distinct(value);

export function isDotsDefinition(value: unknown): value is DotsGameDefinition {
  if (!isRecord(value) || !keys(value, ['id', 'name', 'kind', 'version', 'groupNumber', 'playerIds', 'specials', 'mode'],
    ['stakeMinor', 'partnerIds', 'linkedGameId', 'rotationHoles']) || !isUuid(value.id) || !text(value.name)
    || value.kind !== 'dots' || value.version !== 1 && value.version !== 2 || !positive(value.groupNumber)
    || !members(value.playerIds, value.version === 1 && value.mode === 'individual')
    || !Array.isArray(value.specials) || !value.specials.every((entry: unknown) =>
      isRecord(entry) && keys(entry, ['kind', 'units']) && special(entry.kind) && positive(entry.units))
    || !distinct(value.specials.map((entry: { readonly kind: DotsSpecialKind }) => entry.kind))) return false;
  const kinds = value.specials.map((entry: { readonly kind: DotsSpecialKind }) => entry.kind);
  if (value.mode === 'individual' && kinds.includes('assassin') || value.mode !== 'linked' && kinds.includes('sweep')) return false;
  if (value.version === 2) return value.mode === 'rotating' && (value.rotationHoles === 3 || value.rotationHoles === 6)
    && Object.hasOwn(value, 'stakeMinor') && (value.stakeMinor === null || integer(value.stakeMinor))
    && !Object.hasOwn(value, 'partnerIds') && !Object.hasOwn(value, 'linkedGameId');
  if (Object.hasOwn(value, 'rotationHoles')) return false;
  if (value.mode === 'linked') return isUuid(value.linkedGameId) && value.linkedGameId !== value.id
    && !Object.hasOwn(value, 'stakeMinor') && !Object.hasOwn(value, 'partnerIds');
  if (value.mode !== 'individual' && value.mode !== 'fixed'
    || value.stakeMinor !== null && !integer(value.stakeMinor) || !Object.hasOwn(value, 'stakeMinor')
    || Object.hasOwn(value, 'linkedGameId')) return false;
  const playerIds = value.playerIds;
  return value.mode === 'individual' ? !Object.hasOwn(value, 'partnerIds')
    && (playerIds.length !== 1 || value.stakeMinor === null || value.stakeMinor === 0)
    : members(value.partnerIds) && value.partnerIds.every((id) => playerIds.includes(id));
}

export function isDotsRotationStart(value: unknown): value is DotsRotationStart {
  return isRecord(value) && keys(value, ['playerIds'], ['recordedLate']) && members(value.playerIds)
    && (!Object.hasOwn(value, 'recordedLate') || value.recordedLate === true);
}

export function isDotsHoleRecord(value: unknown): value is DotsHoleRecord {
  return validateDotsHoleRecord(value, false);
}

export function isChurchyV3HoleRecord(value: unknown): value is DotsHoleRecord {
  return validateDotsHoleRecord(value, true);
}

function validateDotsHoleRecord(value: unknown, churchyTargets: boolean): value is DotsHoleRecord {
  if (!isRecord(value) || !keys(value, ['number', 'gameId', 'gameEtag', 'players', 'contests'], ['rotation'])
    || !positive(value.number) || value.number > 18 || !isUuid(value.gameId) || !isEventRevision(value.gameEtag)
    || !Array.isArray(value.players) || !Array.isArray(value.contests)
    || Object.hasOwn(value, 'rotation') && !isDotsRotationStart(value.rotation)) return false;
  const playerIds: string[] = [], callIds: string[] = [], contests: string[] = [];
  for (const player of value.players) {
    if (!isRecord(player) || !keys(player, ['playerId', 'counts', 'calls']) || !isUuid(player.playerId)
      || !isRecord(player.counts) || !Array.isArray(player.calls)) return false;
    playerIds.push(player.playerId);
    for (const [kind, count] of Object.entries(player.counts)) {
      if (!dotsManualKinds.some((manual) => manual === kind) || !integer(count)) return false;
    }
    if (Number(player.counts.dime ?? 0) > 0 && Number(player.counts['super-dime'] ?? 0) > 0) return false;
    for (const call of player.calls) {
      if (!isRecord(call) || !keys(call, ['id', 'kind', 'result'], ['murphyPresses', ...(churchyTargets ? ['murphyTarget', 'pareeTarget'] : [])]) || !isUuid(call.id)
        || !['paree', 'murphy', 'pully-murphy'].includes(String(call.kind))
        || !['pending', 'success', 'failure'].includes(String(call.result))
        || Object.hasOwn(call, 'murphyPresses') && (call.kind !== 'murphy'
          || call.murphyPresses !== 0 && call.murphyPresses !== 1 && call.murphyPresses !== 2)
        || Object.hasOwn(call, 'murphyTarget') && (call.kind !== 'murphy' || call.result !== 'pending'
          || call.murphyTarget !== 'par' && call.murphyTarget !== 'birdie')
        || Object.hasOwn(call, 'pareeTarget') && (call.kind !== 'paree' || call.result !== 'pending'
          || call.pareeTarget !== 'par')) return false;
      callIds.push(call.id);
    }
  }
  for (const contest of value.contests) {
    if (!isRecord(contest) || !keys(contest, ['kind', 'status'], ['winnerId', 'secondId'])
      || !['kp', 'blue-plate', 'long-drive'].includes(String(contest.kind))) return false;
    contests.push(String(contest.kind));
    if (contest.status === 'awarded') {
      if (!isUuid(contest.winnerId) || contest.secondId !== undefined && (!isUuid(contest.secondId)
        || contest.secondId === contest.winnerId)) return false;
    } else if (contest.status !== 'no-qualifier' || Object.hasOwn(contest, 'winnerId') || Object.hasOwn(contest, 'secondId')) return false;
  }
  return distinct(playerIds) && distinct(callIds) && distinct(contests);
}

export function isDotsResults(
  value: unknown, game: DotsGameDefinition, round: DotRoundInput, records: readonly DotsHoleRecord[],
  contexts: readonly DotHoleContext[] = [],
): value is DotsResults {
  return sameJsonValue(value, calculateDots(game, round, records, contexts));
}
