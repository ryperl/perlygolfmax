import type { ChurchyGameDefinition, ChurchySpecials } from '../domain/churchy.js';
import type { RoundGameResult } from '../domain/games.js';
import { isEventRevision, isRecord, isUuid } from './events.js';
import { boundedText } from './catalog.js';
import { calculateChurchyInternalSettlement, churchyPairs, churchySettlement, defaultChurchySpecials } from '../domain/churchy.js';
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

function earnedDots(hole: Record<string, unknown>, playerId: unknown): bigint {
  const specials: readonly unknown[] = Array.isArray(hole.specials) ? hole.specials : [];
  const sources: readonly unknown[] = [hole.high, hole.low, ...specials];
  return sources.reduce<bigint>((sum, source) =>
    isRecord(source) && Array.isArray(source.winners) && source.winners.includes(playerId)
    && exact(source.dots) ? sum + BigInt(source.dots) : sum, 0n);
}

export function isChurchyDefinition(value: unknown): value is ChurchyGameDefinition {
  return isRecord(value) && keys(value, value.version === 2
    ? ['id', 'name', 'kind', 'version', 'basis', 'currency', 'groupNumber', 'amountPerDotMinor', 'playerIds', 'enabledSpecials']
    : ['id', 'name', 'kind', 'version', 'basis', 'currency', 'groupNumber', 'amountPerDotMinor', 'playerIds'])
    && isUuid(value.id) && value.name === 'Churchy Game' && value.kind === 'churchy'
    && (value.version === 1 || value.version === 2 && Array.isArray(value.enabledSpecials)
      && value.enabledSpecials.every((key: unknown) => defaultChurchySpecials.some((special) => special === key))
      && new Set(value.enabledSpecials).size === value.enabledSpecials.length)
    && value.basis === 'net' && value.currency === 'USD'
    && typeof value.groupNumber === 'number' && Number.isSafeInteger(value.groupNumber) && value.groupNumber > 0
    && typeof value.amountPerDotMinor === 'number' && Number.isSafeInteger(value.amountPerDotMinor) && value.amountPerDotMinor >= 0
    && Array.isArray(value.playerIds) && value.playerIds.length === 4 && value.playerIds.every(isUuid)
    && new Set(value.playerIds).size === 4;
}

export function isChurchySpecials(value: unknown): value is ChurchySpecials {
  return isRecord(value) && keys(value, value.version === 2
    ? ['version', 'gameId', 'gameEtag', 'paree', 'murphy', 'murphyPresses', 'sandyCount', 'pully', 'sticky', 'otherDots']
    : ['gameId', 'gameEtag', 'paree', 'murphy', 'murphyPresses', 'sandy', 'pully'])
    && isUuid(value.gameId) && isEventRevision(value.gameEtag)
    && typeof value.paree === 'boolean' && typeof value.murphy === 'boolean'
    && (value.version === 2 ? exact(value.sandyCount) && exact(value.otherDots) && typeof value.sticky === 'boolean'
      : typeof value.sandy === 'boolean') && typeof value.pully === 'boolean'
    && (value.murphyPresses === 0 || value.murphyPresses === 1 || value.murphyPresses === 2)
    && (value.murphy || value.murphyPresses === 0);
}

/** Full receipts are recomputed against captured round inputs in isRoundScores. */
export function isChurchyResult(value: unknown, game: ChurchyGameDefinition): value is RoundGameResult {
  if (!isChurchyResultShape(value, game)) return false;
  if (game.version === 1) return true;
  const data = value.churchy;
  if (!data) return false;
  const expected = calculateChurchyInternalSettlement(game, value.players, data.holes, data.status);
  return sameJsonValue(data.internalSettlement, expected)
    && data.settlement.every((entry, index) => {
      const balance = expected.players[index]?.netMinor;
      return entry.paysMinor === (balance == null ? null : Math.max(0, -balance))
        && entry.collectsMinor === (balance == null ? null : Math.max(0, balance));
    });
}

function isChurchyResultShape(value: unknown, game: ChurchyGameDefinition): value is RoundGameResult {
  if (!isRecord(value) || value.kind !== 'churchy' || value.version !== game.version || value.gameId !== game.id
    || Object.keys(value).length !== 5 || !isRecord(value.churchy) || !Array.isArray(value.players)
    || value.players.length !== 4) return false;
  const data = value.churchy;
  if (!keys(data, ['holes', 'status', 'unawardedHigh', 'unawardedLow', 'settlement',
    ...(game.version === 2 ? ['internalSettlement'] : [])])
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
      || !Array.isArray(hole.specials) || hole.specials.length > (game.version === 2 ? 29 : 21)
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
      const sum = (values: readonly (number | null)[], offset = 0) => {
        if (game.version === 2 && holes.slice(offset, offset + values.length).some((hole) =>
          isRecord(hole) && earnedDots(hole, player.playerId) > BigInt(Number.MAX_SAFE_INTEGER))) return null;
        if (values.every((value) => value === null)) return null;
        if (values.some((value) => value !== null && !exact(value))) return undefined;
        const total = values.reduce<bigint>((total, value) => total + BigInt(value ?? 0), 0n);
        return total > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(total);
      };
      if (player.frontPoints !== sum(awarded.slice(0, 9)) || player.backPoints !== sum(awarded.slice(9), 9)
        || player.totalPoints !== sum(awarded)
        || !player.holes.every((hole: unknown, index: number) => isRecord(hole) && hole.points === awarded[index])) return false;
    }
    if (!hole.specials.every((award: unknown) => isRecord(award)
      && keys(award, ['special', 'playerId', 'outcome', 'winners', 'dots'])
      && typeof award.special === 'string' && ['Paree', 'Murphy', 'Sandy', 'Pully', 'Birdie', 'Sweep',
        ...(game.version === 2 ? ['Eagle', 'Sticky', 'Other'] : [])].includes(award.special)
      && (award.playerId === null || typeof award.playerId === 'string' && game.playerIds.includes(award.playerId))
      && (award.outcome === 'made' || award.outcome === 'missed' || award.outcome === 'ineligible')
      && winners(award.winners) && exact(award.dots)
      && (game.version === 2 ? validV2Award(award, game, index + 1)
        : award.outcome === 'ineligible' ? award.dots === 0 : award.dots >= 1 && award.dots <= 3))
      || !hole.awards.every((award: unknown, index: number) => isRecord(award)
        && keys(award, ['playerId', 'dots']) && award.playerId === game.playerIds[index] && nullable(award.dots))) return false;
    if (game.version === 2) {
      const identities = hole.specials.map((award: unknown) =>
        isRecord(award) ? `${String(award.special)}:${String(award.playerId)}` : '');
      if (new Set(identities).size !== identities.length) return false;
      if (game.playerIds.some((id) => identities.includes(`Birdie:${id}`) && identities.includes(`Eagle:${id}`))) return false;
      const specials: readonly unknown[] = hole.specials;
      if (specials.some((award) => isRecord(award) && award.special === 'Sweep'
        && (!isRecord(hole.high) || !isRecord(hole.low) || hole.high.status !== 'won' || hole.low.status !== 'won'
          || !sameJsonValue(hole.high.winners, award.winners) || !sameJsonValue(hole.low.winners, award.winners)))) return false;
      for (const award of hole.awards) {
        if (!isRecord(award)) return false;
        const earned = earnedDots(hole, award.playerId);
        const expected = earned > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(earned);
        if (award.dots !== null && award.dots !== expected || award.dots === null && earned > 0n
          && expected !== null || hole.dotStatus === 'complete' && award.dots !== expected) return false;
      }
    }
  }
  const totals = players.map((entry) => isRecord(entry) && typeof entry.totalPoints === 'number' ? entry.totalPoints : null);
  if (game.version === 2) return data.settlement.every((entry: unknown, index: number) => isRecord(entry)
    && keys(entry, ['playerId', 'paysMinor', 'collectsMinor']) && entry.playerId === game.playerIds[index]
    && nullable(entry.paysMinor) && nullable(entry.collectsMinor));
  const balances = churchySettlement(data.status === 'unavailable' ? totals.map(() => null) : totals, game.amountPerDotMinor);
  return data.settlement.every((entry: unknown, index: number) => isRecord(entry)
    && keys(entry, ['playerId', 'paysMinor', 'collectsMinor']) && entry.playerId === game.playerIds[index]
    && entry.paysMinor === (balances[index] == null ? null : Math.max(0, -(balances[index] ?? 0)))
    && entry.collectsMinor === (balances[index] == null ? null : Math.max(0, balances[index] ?? 0)));
}

function validV2Award(award: Record<string, unknown>, game: ChurchyGameDefinition, number: number): boolean {
  if (game.version !== 2 || typeof award.special !== 'string') return false;
  const special = award.special.toLowerCase();
  const key = defaultChurchySpecials.find((key) => key === special);
  if (award.special !== 'Other' && (key === undefined || !game.enabledSpecials.includes(key))) return false;
  const pairs = churchyPairs(game.playerIds, number);
  if (!pairs) return false;
  if (award.special === 'Sweep') return award.playerId === null && award.outcome === 'made'
    && award.dots === (number - 1) % 3 + 1 && pairs.some((pair) => sameJsonValue(award.winners, pair));
  if (typeof award.playerId !== 'string') return false;
  const id = award.playerId;
  if (award.outcome === 'ineligible') return (award.special === 'Sandy' || award.special === 'Pully')
    && award.dots === 0 && sameJsonValue(award.winners, []);
  if (award.outcome === 'missed' && award.special !== 'Paree' && award.special !== 'Murphy') return false;
  const expected = pairs.find((pair) => pair.includes(id) === (award.outcome === 'made'));
  if (!sameJsonValue(award.winners, expected) || !exact(award.dots) || award.dots < 1) return false;
  if (award.special === 'Other' || award.special === 'Sandy') return true;
  if (award.special === 'Birdie') return award.dots === 2;
  if (award.special === 'Eagle') return award.dots === 4;
  if (award.special === 'Murphy') return exact(award.dots) && award.dots <= 3;
  return award.dots === 1;
}
