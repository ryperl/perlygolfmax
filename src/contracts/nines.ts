/**
 * Network validation for Nines definitions and results, shared by the browser and the API.
 * With the published round available, results are recalculated and must match exactly; otherwise
 * they are checked for internal consistency (every complete hole totals 9, totals add up).
 */
import type { RoundGameScoringContext } from '../domain/game-declarations.js';
import type { GamePlayerResult, RoundGameResult } from '../domain/games.js';
import { calculateNinesFromScores, ninesPlayerCount } from '../domain/nines.js';
import type { NinesGameDefinition, NinesHole } from '../domain/nines.js';
import { boundedText } from './catalog.js';
import { isRecord, isUuid } from './events.js';
import { sameJsonValue } from './round-context.js';

const pointsPerHole = 9;

function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allRequiredPresent = required.every((key) => Object.hasOwn(value, key));
  return allRequiredPresent && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}

function wholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isThreeDistinctGolfers(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length === ninesPlayerCount && value.every(isUuid)
    && new Set(value).size === ninesPlayerCount;
}

export function isNinesDefinition(value: unknown): value is NinesGameDefinition {
  if (!isRecord(value) || value.kind !== 'nines' || value.version !== 1) return false;
  const required = ['id', 'name', 'kind', 'version', 'basis', 'groupNumber', 'playerIds', 'stakeMinor'];
  if (!hasExactKeys(value, required, ['handicapRule'])) return false;
  if (!isUuid(value.id) || !boundedText(value.name)) return false;
  if (!wholeNumber(value.groupNumber) || value.groupNumber < 1) return false;
  if (!isThreeDistinctGolfers(value.playerIds)) return false;
  if (value.stakeMinor !== null && (!wholeNumber(value.stakeMinor) || value.stakeMinor < 0)) return false;
  // Gross needs no handicap rule; net must say whether it plays full CH or strokes off the low golfer.
  if (value.basis === 'gross') return !Object.hasOwn(value, 'handicapRule');
  if (value.basis !== 'net') return false;
  return value.handicapRule === 'full-course-v1' || value.handicapRule === 'group-low-v1';
}

function isHole(value: unknown, game: NinesGameDefinition): value is NinesHole {
  if (!isRecord(value) || !hasExactKeys(value, ['number', 'status', 'points'])) return false;
  if (!wholeNumber(value.number) || value.number < 1 || value.number > 18 || !Array.isArray(value.points)) return false;
  if (value.status === 'pending' || value.status === 'unavailable') return value.points.length === 0;
  if (value.status !== 'complete' || value.points.length !== ninesPlayerCount) return false;
  let total = 0;
  const golfers = new Set<string>();
  for (const entry of value.points) {
    if (!isRecord(entry) || !hasExactKeys(entry, ['playerId', 'points'])) return false;
    if (typeof entry.playerId !== 'string' || !game.playerIds.includes(entry.playerId)) return false;
    if (!wholeNumber(entry.points) || entry.points < 1 || entry.points > 5) return false;
    golfers.add(entry.playerId);
    total += entry.points;
  }
  return golfers.size === ninesPlayerCount && total === pointsPerHole;
}

function pointsTotal(holes: readonly { readonly points: number | null }[]): number | null {
  const scored = holes.filter((hole) => hole.points !== null);
  return scored.length ? scored.reduce((sum, hole) => sum + (hole.points ?? 0), 0) : null;
}

function isConsistentPlayer(value: unknown, holes: readonly NinesHole[], game: NinesGameDefinition): value is GamePlayerResult {
  if (!isRecord(value) || typeof value.playerId !== 'string' || !game.playerIds.includes(value.playerId)) return false;
  if (!hasExactKeys(value, ['playerId', 'displayName', 'playingHandicap', 'status', 'holes', 'holesScored', 'totalHoles',
    'frontPoints', 'backPoints', 'totalPoints'], ['unavailableReason'])) return false;
  if (!boundedText(value.displayName) || !Array.isArray(value.holes) || value.holes.length !== holes.length) return false;
  const playerId = value.playerId;
  const expectedHoles = holes.map((hole) => ({
    number: hole.number, points: hole.points.find((entry) => entry.playerId === playerId)?.points ?? null,
  }));
  const holesMatch = value.holes.every((hole: unknown, index) => isRecord(hole)
    && hasExactKeys(hole, ['number', 'points', 'strokesReceived'])
    && (hole.strokesReceived === null || wholeNumber(hole.strokesReceived))
    && hole.number === expectedHoles[index]?.number && hole.points === expectedHoles[index]?.points);
  const complete = holes.filter((hole) => hole.status === 'complete').length;
  return holesMatch && value.holesScored === complete && value.totalHoles === holes.length
    && value.totalPoints === pointsTotal(expectedHoles)
    && value.frontPoints === pointsTotal(expectedHoles.filter((hole) => hole.number <= 9))
    && value.backPoints === pointsTotal(expectedHoles.filter((hole) => hole.number > 9));
}

/** Checks a Nines result. With the published round, it must equal an exact recalculation. */
export function isNinesResult(value: unknown, game: NinesGameDefinition, round?: RoundGameScoringContext): value is RoundGameResult {
  if (!isRecord(value) || !hasExactKeys(value, ['gameId', 'kind', 'version', 'nines', 'players'])) return false;
  if (value.gameId !== game.id || value.kind !== 'nines' || value.version !== 1) return false;
  const nines = value.nines;
  if (!isRecord(nines) || !hasExactKeys(nines, ['version', 'groupNumber', 'status', 'holes'])) return false;
  if (nines.version !== 1 || nines.groupNumber !== game.groupNumber) return false;
  if (nines.status !== 'ready' && nines.status !== 'stale-group') return false;
  if (!Array.isArray(nines.holes) || !nines.holes.every((hole) => isHole(hole, game))) return false;
  const holes: readonly NinesHole[] = nines.holes;
  if (!Array.isArray(value.players) || value.players.length > ninesPlayerCount) return false;
  if (!value.players.every((player) => isConsistentPlayer(player, holes, game))) return false;
  if (!round) return true;
  const names = new Map(value.players.flatMap((player: unknown) => isRecord(player)
    && typeof player.playerId === 'string' && typeof player.displayName === 'string'
    ? [[player.playerId, player.displayName] as const] : []));
  return sameJsonValue(value, calculateNinesFromScores(game, round, names));
}
