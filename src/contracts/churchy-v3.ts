import type { ChurchyGameDefinitionV3 } from '../domain/churchy.js';
import { calculateChurchyInternalSettlement } from '../domain/churchy.js';
import type { RoundGameResult } from '../domain/games.js';
import { dotsSpecialCatalog } from '../domain/dots.js';
import { isDotsRotationStart } from './dots.js';
import { isRecord } from './events.js';
import { boundedText } from './catalog.js';
import { sameJsonValue } from './round-context.js';
import { isDotAward } from './dot-audit.js';

const exact = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nullable = (value: unknown) => value === null || exact(value);
const keys = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) =>
  required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));

/** Captured-input recomputation in isRoundScores additionally binds the actual group circuit. */
function isChurchyV3ResultShape(value: unknown, game: ChurchyGameDefinitionV3): value is RoundGameResult {
  if (!isRecord(value) || !keys(value, ['gameId', 'kind', 'version', 'players', 'churchy'])
    || value.gameId !== game.id || value.kind !== 'churchy' || value.version !== 3 || !Array.isArray(value.players)
    || value.players.length !== 4 || !isRecord(value.churchy)) return false;
  const data = value.churchy;
  if (!keys(data, ['holes', 'status', 'unawardedHigh', 'unawardedLow', 'settlement', 'internalSettlement', 'awards'], ['order'])
    || !['complete', 'in-progress', 'unavailable'].includes(String(data.status))
    || !nullable(data.unawardedHigh) || !nullable(data.unawardedLow) || !Array.isArray(data.holes)
    || ![9, 18].includes(data.holes.length) || !Array.isArray(data.settlement) || data.settlement.length !== 4
    || !data.settlement.every((entry: unknown, index: number) => isRecord(entry)
      && keys(entry, ['playerId', 'paysMinor', 'collectsMinor']) && entry.playerId === game.playerIds[index]
      && nullable(entry.paysMinor) && nullable(entry.collectsMinor))
    || !Array.isArray(data.awards) || !data.awards.every(isDotAward)
    || data.order !== undefined && (!isDotsRotationStart(data.order)
      || !data.order.playerIds.every((id) => game.playerIds.includes(id)))) return false;
  const order = isDotsRotationStart(data.order) ? data.order.playerIds : [];
  const holes: readonly unknown[] = data.holes;
  if (new Set(holes.map((hole) => isRecord(hole) ? hole.number : null)).size !== holes.length) return false;
  for (const [index, raw] of holes.entries()) {
    if (!isRecord(raw) || !keys(raw, ['number', 'stake', 'pairs', 'high', 'low', 'specials', 'specialStatus', 'dotStatus', 'awards'])
      || !exact(raw.number) || raw.number < 1 || raw.number > 18 || raw.stake !== index % 3 + 1
      || !Array.isArray(raw.specials) || !Array.isArray(raw.awards) || raw.awards.length !== 4
      || !['complete', 'pending', 'unavailable'].includes(String(raw.specialStatus))
      || !['complete', 'partial', 'pending', 'unavailable'].includes(String(raw.dotStatus))) return false;
    const [a, b, c, d] = order;
    const block = Math.floor(index / 3) % 3;
    const pairs = order.length === 4 ? block === 0 ? [[a, d], [b, c]] : block === 1 ? [[a, c], [b, d]] : [[a, b], [c, d]] : [];
    if (!sameJsonValue(raw.pairs, pairs)) return false;
    const winners = (value: unknown) => Array.isArray(value)
      && value.every((id: unknown) => typeof id === 'string' && game.playerIds.includes(id))
      && new Set(value).size === value.length && (value.length === 0 || value.length === 1
      || pairs.some((pair) => pair.length === value.length && pair.every((id) => value.includes(id))));
    for (const lane of [raw.high, raw.low]) {
      if (!isRecord(lane) || !keys(lane, ['status', 'winners', 'dots', 'carry'])
        || !winners(lane.winners) || !nullable(lane.dots) || !nullable(lane.carry)
        || (lane.status === 'won' ? !pairs.some((pair) => sameJsonValue(pair, lane.winners))
          || !exact(lane.dots) || lane.dots < 1 || lane.carry !== 0
          : lane.status === 'tied' ? !sameJsonValue(lane.winners, []) || lane.dots !== 0 || !exact(lane.carry)
            : !['pending', 'unavailable'].includes(String(lane.status)) || lane.dots !== null
              || lane.carry !== null || !sameJsonValue(lane.winners, []))) return false;
    }
    const specials: readonly unknown[] = raw.specials;
    if (!specials.every((award) => isRecord(award)
      && keys(award, ['special', 'playerId', 'outcome', 'winners', 'dots'])
      && game.specials.some((selection) => award.special === (selection.kind === 'dime' ? 'Sticky'
        : dotsSpecialCatalog.find((entry) => entry.kind === selection.kind)?.label))
      && (award.playerId === null || typeof award.playerId === 'string' && game.playerIds.includes(award.playerId))
      && award.outcome === 'made' && winners(award.winners) && exact(award.dots))) return false;
    for (const [i, award] of raw.awards.entries()) {
      if (!isRecord(award) || !keys(award, ['playerId', 'dots']) || award.playerId !== game.playerIds[i]
        || !nullable(award.dots)) return false;
      const earned = [raw.high, raw.low, ...specials].reduce<bigint>((sum, source) =>
        isRecord(source) && Array.isArray(source.winners) && source.winners.includes(award.playerId)
          && exact(source.dots) ? sum + BigInt(source.dots) : sum, 0n);
      if (award.dots !== null && BigInt(award.dots) !== earned) return false;
      if (award.dots === null && earned <= BigInt(Number.MAX_SAFE_INTEGER)
        && (earned > 0n || raw.dotStatus === 'complete')) return false;
    }
  }
  for (const [index, player] of value.players.entries()) {
    if (!isRecord(player) || !keys(player, ['playerId', 'displayName', 'playingHandicap', 'status', 'holes',
      'holesScored', 'totalHoles', 'frontPoints', 'backPoints', 'totalPoints'])
      || player.playerId !== game.playerIds[index] || !boundedText(player.displayName)
      || !nullable(player.playingHandicap) || player.status !== data.status || !exact(player.holesScored)
      || player.holesScored > holes.length || player.totalHoles !== holes.length || !Array.isArray(player.holes)
      || player.holes.length !== holes.length || !nullable(player.frontPoints) || !nullable(player.backPoints)
      || !nullable(player.totalPoints)) return false;
    for (const [i, hole] of player.holes.entries()) {
      const receipt = holes[i];
      const awards: readonly unknown[] = isRecord(receipt) && Array.isArray(receipt.awards) ? receipt.awards : [];
      const award = awards[index];
      if (!isRecord(hole) || !keys(hole, ['number', 'points', 'strokesReceived']) || !isRecord(receipt)
        || hole.number !== receipt.number || !isRecord(award) || hole.points !== award.dots
        || !nullable(hole.strokesReceived)) return false;
    }
    const subtotal = (selected: readonly unknown[]) => {
      const values: number[] = [];
      for (const raw of selected) {
        if (!isRecord(raw) || !Array.isArray(raw.awards)) return null;
        const awards: readonly unknown[] = raw.awards;
        const award = awards[index];
        const specials: readonly unknown[] = Array.isArray(raw.specials) ? raw.specials : [];
        const earned = [raw.high, raw.low, ...specials].reduce<bigint>((sum, source) =>
          isRecord(source) && Array.isArray(source.winners) && source.winners.includes(player.playerId)
            && exact(source.dots) ? sum + BigInt(source.dots) : sum, 0n);
        if (earned > BigInt(Number.MAX_SAFE_INTEGER)) return null;
        if (isRecord(award) && exact(award.dots)) values.push(award.dots);
      }
      if (!values.length) return null;
      const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
      return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
    };
    if (player.frontPoints !== subtotal(holes.filter((hole) => isRecord(hole) && exact(hole.number) && hole.number <= 9))
      || player.backPoints !== subtotal(holes.filter((hole) => isRecord(hole) && exact(hole.number) && hole.number > 9))
      || player.totalPoints !== subtotal(holes)) return false;
  }
  return true;
}

export function isChurchyV3Result(value: unknown, game: ChurchyGameDefinitionV3): value is RoundGameResult {
  if (!isChurchyV3ResultShape(value, game)) return false;
  const data = value.churchy;
  if (!data) return false;
  const expected = calculateChurchyInternalSettlement(game, value.players, data.holes, data.status);
  return sameJsonValue(data.internalSettlement, expected) && data.settlement.length === 4
    && data.settlement.every((entry, index) => {
      const player = expected.players[index];
      return entry.playerId === game.playerIds[index] && entry.paysMinor === (player?.netMinor == null ? null : Math.max(0, -player.netMinor))
        && entry.collectsMinor === (player?.netMinor == null ? null : Math.max(0, player.netMinor));
    });
}
