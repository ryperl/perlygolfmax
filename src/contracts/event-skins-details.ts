import type { EventSkinsDetails } from '../domain/event-skins-details.js';
import { boundedText } from './catalog.js';
import { isRecord, isUuid } from './events.js';

function keys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const nullable = (value: unknown): value is number | null => value === null || integer(value);
const unique = (values: readonly string[]) => new Set(values.map((value) => value.toLowerCase())).size === values.length;
const reason = (value: unknown) => value === undefined
  || ['round-context-mismatch', 'missing-score-data', 'missing-net-inputs', 'arithmetic-range'].some((entry) => entry === value);
function round(value: unknown): value is EventSkinsDetails['rounds'][number] {
  return isRecord(value) && keys(value, ['id', 'name']) && isUuid(value.id) && boundedText(value.name);
}
function player(value: unknown): value is EventSkinsDetails['players'][number] {
  return isRecord(value) && keys(value, ['playerId', 'displayName']) && isUuid(value.playerId) && boundedText(value.displayName);
}
export function isEventSkinsDetails(value: unknown): value is EventSkinsDetails {
  if (!isRecord(value) || !keys(value, ['version', 'eventId', 'eventName', 'status', 'rounds', 'players', 'holes'])
    || value.version !== 1 || !isUuid(value.eventId) || !boundedText(value.eventName)
    || !['disabled', 'complete', 'provisional', 'unavailable'].some((status) => status === value.status)
    || !Array.isArray(value.rounds) || !value.rounds.every(round)
    || !Array.isArray(value.players) || !value.players.every(player) || !Array.isArray(value.holes)) return false;
  const rounds = value.rounds;
  const players = value.players;
  const playerIds = players.map((entry) => entry.playerId);
  if (!unique(rounds.map((entry) => entry.id)) || !unique(playerIds)) return false;
  const holeKeys: string[] = [];
  for (const hole of value.holes) {
    if (!isRecord(hole) || !keys(hole, ['roundId', 'number', 'status', 'winnerId', 'contenderIds', 'grossUnderParPriority', 'players'], ['reason'])
      || !isUuid(hole.roundId) || !rounds.some((entry) => entry.id === hole.roundId)
      || !integer(hole.number) || hole.number < 1 || hole.number > 18 || !reason(hole.reason)
      || !['pending', 'unavailable', 'tied', 'awarded', 'ineligible'].some((status) => status === hole.status)
      || typeof hole.grossUnderParPriority !== 'boolean'
      || !Array.isArray(hole.contenderIds) || !hole.contenderIds.every(isUuid) || !unique(hole.contenderIds)
      || hole.contenderIds.some((id) => !playerIds.includes(id))
      || (hole.status === 'awarded' ? hole.contenderIds.length !== 1 || hole.contenderIds[0] !== hole.winnerId
        : hole.status === 'tied' ? hole.contenderIds.length < 2 : hole.contenderIds.length !== 0 || hole.grossUnderParPriority)
      || (hole.status === 'awarded' ? !isUuid(hole.winnerId) || !playerIds.includes(hole.winnerId) : hole.winnerId !== null)
      || !Array.isArray(hole.players) || hole.players.length !== players.length) return false;
    holeKeys.push(`${hole.roundId}:${String(hole.number)}`);
    const seen: string[] = [];
    for (const entry of hole.players) {
      if (!isRecord(entry) || !keys(entry,
        ['playerId', 'disposition', 'par', 'gross', 'net', 'strokesReceived', 'outcome'], ['reason'])
        || !isUuid(entry.playerId) || !playerIds.includes(entry.playerId) || !reason(entry.reason)
        || !['strokes', 'unplayed', 'picked-up', 'did-not-finish', 'unavailable'].some((kind) => kind === entry.disposition)
        || !['won', 'covered', 'beaten', 'pending', 'ineligible', 'unavailable'].some((outcome) => outcome === entry.outcome)
        || !nullable(entry.par) || entry.par !== null && entry.par < 1
        || !nullable(entry.gross) || entry.gross !== null && entry.gross < 1
        || !nullable(entry.net) || !nullable(entry.strokesReceived)
        || entry.outcome === 'won' && hole.winnerId !== entry.playerId
        || ['won', 'covered', 'beaten'].includes(String(entry.outcome)) && (entry.net === null || hole.status !== 'awarded' && hole.status !== 'tied')
        || entry.outcome === 'ineligible' && entry.disposition !== 'picked-up' && entry.disposition !== 'did-not-finish'
        || (entry.net === null) !== (entry.strokesReceived === null)
        || entry.disposition !== 'strokes' && entry.net !== null
        || entry.net !== null && (entry.gross === null || entry.strokesReceived === null
          || BigInt(entry.gross) - BigInt(entry.strokesReceived) !== BigInt(entry.net))) return false;
      seen.push(entry.playerId);
    }
    if (!unique(seen) || hole.players.filter((entry: unknown) => isRecord(entry) && entry.outcome === 'won').length
      !== (hole.status === 'awarded' ? 1 : 0)) return false;
  }
  const expectedStatus = value.holes.some((hole: unknown) => isRecord(hole) && hole.status === 'unavailable') || !holeKeys.length
    ? 'unavailable' : value.holes.some((hole: unknown) => isRecord(hole) && hole.status === 'pending') ? 'provisional' : 'complete';
  return unique(holeKeys) && (value.status === 'disabled' ? holeKeys.length === 0 : value.status === expectedStatus);
}
