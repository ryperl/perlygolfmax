import type { ChurchyGameDefinition, ChurchySpecials } from '../domain/churchy.js';
import type { RoundGameResult } from '../domain/games.js';
import { isEventRevision, isRecord, isUuid } from './events.js';
import { boundedText } from './catalog.js';
import { churchyPairs, churchySettlement } from '../domain/churchy.js';
import { sameJsonValue } from './round-context.js';

function exact(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function nullable(value: unknown): value is number | null {
  return value === null || exact(value);
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).length === allowed.length && allowed.every((key) => Object.hasOwn(value, key));
}

export function isChurchyDefinition(value: unknown): value is ChurchyGameDefinition {
  return isRecord(value) && Object.keys(value).length === 9
    && isUuid(value.id) && value.name === 'Churchy Game' && value.kind === 'churchy' && value.version === 1
    && value.basis === 'net' && value.currency === 'USD'
    && typeof value.groupNumber === 'number' && Number.isSafeInteger(value.groupNumber) && value.groupNumber > 0
    && typeof value.amountPerDotMinor === 'number' && Number.isSafeInteger(value.amountPerDotMinor) && value.amountPerDotMinor >= 0
    && Array.isArray(value.playerIds) && value.playerIds.length === 4 && value.playerIds.every(isUuid)
    && new Set(value.playerIds).size === 4;
}

export function isChurchySpecials(value: unknown): value is ChurchySpecials {
  return isRecord(value) && Object.keys(value).length === 7 && isUuid(value.gameId) && isEventRevision(value.gameEtag)
    && typeof value.paree === 'boolean' && typeof value.murphy === 'boolean'
    && typeof value.sandy === 'boolean' && typeof value.pully === 'boolean'
    && (value.murphyPresses === 0 || value.murphyPresses === 1 || value.murphyPresses === 2)
    && (value.murphy || value.murphyPresses === 0);
}

/** Full receipts are recomputed against captured round inputs in isRoundScores. */
export function isChurchyResult(value: unknown, game: ChurchyGameDefinition): value is RoundGameResult {
  if (!isRecord(value) || value.kind !== 'churchy' || value.version !== 1 || value.gameId !== game.id
    || Object.keys(value).length !== 5 || !isRecord(value.churchy) || !Array.isArray(value.players)
    || value.players.length !== 4) return false;
  const data = value.churchy;
  if (!keys(data, ['holes', 'status', 'unawardedHigh', 'unawardedLow', 'settlement'])
    || typeof data.status !== 'string' || !['complete', 'in-progress', 'unavailable'].includes(data.status)
    || !nullable(data.unawardedHigh) || !nullable(data.unawardedLow)
    || !Array.isArray(data.holes) || ![9, 18].includes(data.holes.length)
    || !Array.isArray(data.settlement) || data.settlement.length !== 4) return false;
  const count = data.holes.length;
  const holes: unknown[] = data.holes;
  const players: unknown[] = value.players;
  for (const [index, player] of players.entries()) {
    if (!isRecord(player) || !keys(player, ['playerId', 'displayName', 'playingHandicap', 'status', 'holes',
      'holesScored', 'totalHoles', 'frontPoints', 'backPoints', 'totalPoints'])
      || player.playerId !== game.playerIds[index] || !boundedText(player.displayName)
      || !nullable(player.playingHandicap) || player.status !== data.status || player.totalHoles !== count
      || !exact(player.holesScored) || player.holesScored > count
      || !nullable(player.frontPoints) || !nullable(player.backPoints) || !nullable(player.totalPoints)
      || !Array.isArray(player.holes) || player.holes.length !== count
      || !player.holes.every((hole: unknown, index: number) => isRecord(hole)
        && keys(hole, ['number', 'points', 'strokesReceived']) && hole.number === index + 1
        && nullable(hole.points) && nullable(hole.strokesReceived))) return false;
  }
  function winners(value: unknown): boolean {
    return Array.isArray(value) && (value.length === 0 || value.length === 2)
      && value.every((id: unknown) => typeof id === 'string' && game.playerIds.includes(id)) && new Set(value).size === value.length;
  }
  for (const [index, hole] of holes.entries()) {
    if (!isRecord(hole) || !keys(hole, ['number', 'stake', 'pairs', 'high', 'low', 'specials', 'specialStatus', 'dotStatus', 'awards'])
      || hole.number !== index + 1 || hole.stake !== index % 3 + 1
      || !sameJsonValue(hole.pairs, churchyPairs(game.playerIds, index + 1))
      || typeof hole.specialStatus !== 'string' || !['complete', 'pending', 'unavailable'].includes(hole.specialStatus)
      || typeof hole.dotStatus !== 'string' || !['complete', 'partial', 'pending', 'unavailable'].includes(hole.dotStatus)
      || !Array.isArray(hole.specials) || hole.specials.length > 21
      || !Array.isArray(hole.awards) || hole.awards.length !== 4) return false;
    for (const lane of [hole.high, hole.low]) {
      if (!isRecord(lane) || !keys(lane, ['status', 'winners', 'dots', 'carry'])
        || typeof lane.status !== 'string' || !['won', 'tied', 'pending', 'unavailable'].includes(lane.status)
        || !winners(lane.winners) || !nullable(lane.dots) || !nullable(lane.carry)) return false;
      const pairs = churchyPairs(game.playerIds, index + 1);
      if (lane.status === 'won' ? !pairs?.some((pair) => sameJsonValue(pair, lane.winners))
        || !exact(lane.dots) || lane.dots === 0 || lane.carry !== 0
        : !sameJsonValue(lane.winners, []) || (lane.status === 'tied' ? lane.dots !== 0 || !exact(lane.carry)
          : lane.dots !== null || lane.carry !== null)) return false;
    }
    for (const [index, player] of players.entries()) {
      if (!isRecord(player) || !Array.isArray(player.holes)) return false;
      const awarded = holes.map((hole) => {
        const entry: unknown = isRecord(hole) && Array.isArray(hole.awards) ? hole.awards[index] : undefined;
        return isRecord(entry) && typeof entry.dots === 'number' ? entry.dots : null;
      });
      const sum = (values: readonly (number | null)[]) => values.every((value) => value === null) ? null
        : values.reduce<number>((total, value) => total + (value ?? 0), 0);
      if (player.frontPoints !== sum(awarded.slice(0, 9)) || player.backPoints !== sum(awarded.slice(9))
        || player.totalPoints !== sum(awarded)
        || !player.holes.every((hole: unknown, index: number) => isRecord(hole) && hole.points === awarded[index])) return false;
    }
    if (!hole.specials.every((award: unknown) => isRecord(award)
      && keys(award, ['special', 'playerId', 'outcome', 'winners', 'dots'])
      && typeof award.special === 'string' && ['Paree', 'Murphy', 'Sandy', 'Pully', 'Birdie', 'Sweep'].includes(award.special)
      && (award.playerId === null || typeof award.playerId === 'string' && game.playerIds.includes(award.playerId))
      && (award.outcome === 'made' || award.outcome === 'missed' || award.outcome === 'ineligible')
      && winners(award.winners) && exact(award.dots)
      && (award.outcome === 'ineligible' ? award.dots === 0 : award.dots >= 1 && award.dots <= 3))
      || !hole.awards.every((award: unknown, index: number) => isRecord(award)
        && keys(award, ['playerId', 'dots']) && award.playerId === game.playerIds[index] && nullable(award.dots))) return false;
  }
  const totals = players.map((entry) => isRecord(entry) && typeof entry.totalPoints === 'number' ? entry.totalPoints : null);
  const balances = churchySettlement(data.status === 'unavailable' ? totals.map(() => null) : totals, game.amountPerDotMinor);
  return data.settlement.every((entry: unknown, index: number) => isRecord(entry)
    && keys(entry, ['playerId', 'paysMinor', 'collectsMinor']) && entry.playerId === game.playerIds[index]
    && entry.paysMinor === (balances[index] == null ? null : Math.max(0, -(balances[index] ?? 0)))
    && entry.collectsMinor === (balances[index] == null ? null : Math.max(0, balances[index] ?? 0)));
}
