import type { GamePlayerResult, NewRoundGameDefinition, RoundGameResult, StrokeGameHole } from '../domain/games.js';
import { aggregateStrokeGameResults } from '../domain/stroke-games.js';
import { boundedText } from './catalog.js';
import { isRecord, isUuid } from './events.js';
import { sameJsonValue } from './round-context.js';

function keys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}

function nullableInteger(value: unknown): value is number | null {
  return value === null || typeof value === 'number' && Number.isSafeInteger(value);
}

function isHole(value: unknown, number: number): value is StrokeGameHole {
  return isRecord(value) && keys(value, ['number', 'par', 'status', 'grossToPar', 'netToPar', 'value', 'countingPlayerIds'])
    && value.number === number && typeof value.par === 'number' && Number.isInteger(value.par) && value.par >= 1 && value.par <= 10
    && typeof value.status === 'string' && ['complete', 'pending', 'ineligible', 'unavailable'].includes(value.status)
    && nullableInteger(value.grossToPar) && nullableInteger(value.netToPar) && nullableInteger(value.value)
    && Array.isArray(value.countingPlayerIds) && value.countingPlayerIds.every(isUuid)
    && new Set(value.countingPlayerIds).size === value.countingPlayerIds.length;
}

function isPlayer(value: unknown, game: NewRoundGameDefinition): value is GamePlayerResult {
  if (!isRecord(value) || !keys(value, ['playerId', 'displayName', 'playingHandicap', 'status', 'holes',
    'holesScored', 'totalHoles', 'frontPoints', 'backPoints', 'totalPoints', 'strokeGame'], ['unavailableReason'])
    || !isUuid(value.playerId) || !boundedText(value.displayName) || !nullableInteger(value.playingHandicap)
    || typeof value.status !== 'string' || !['complete', 'in-progress', 'unavailable'].includes(value.status)
    || value.frontPoints !== null || value.backPoints !== null || value.totalPoints !== null
    || !Array.isArray(value.holes) || ![9, 18].includes(value.holes.length)
    || value.totalHoles !== value.holes.length || typeof value.holesScored !== 'number' || !Number.isInteger(value.holesScored)
    || value.holesScored < 0 || value.holesScored > value.totalHoles
    || !isRecord(value.strokeGame)) return false;
  const score = value.strokeGame;
  const reasons = ['missing-score-data', 'missing-handicap-index', 'invalid-handicap-index', 'missing-tee-ratings',
    'missing-stroke-index', 'arithmetic-range', 'invalid-stroke-score'];
  if (!keys(score, ['kind', 'version', 'holes', 'frontTotal', 'backTotal', 'total'], ['unavailableReason'])
    || score.kind !== game.kind || score.version !== 1
    || !nullableInteger(score.frontTotal) || !nullableInteger(score.backTotal) || !nullableInteger(score.total)
    || score.unavailableReason !== undefined && (typeof score.unavailableReason !== 'string' || !reasons.includes(score.unavailableReason))
    || value.unavailableReason !== undefined && (typeof value.unavailableReason !== 'string' || !reasons.includes(value.unavailableReason))
    || !Array.isArray(score.holes) || score.holes.length !== value.totalHoles
    || !score.holes.every((hole: unknown, index: number) => isHole(hole, index + 1))) return false;
  const holes: StrokeGameHole[] = score.holes;
  const received: number[] = [];
  for (const [index, hole] of value.holes.entries()) {
    if (!isRecord(hole) || !keys(hole, ['number', 'points', 'strokesReceived'])
      || hole.number !== index + 1 || hole.points !== null || !nullableInteger(hole.strokesReceived)) return false;
    const raw = holes[index];
    if (!raw) return false;
    if (game.kind === 'ball-drop' && (raw.value !== null || raw.countingPlayerIds.length)) return false;
    if (game.basis === 'gross' && (value.playingHandicap !== null || raw.netToPar !== null
      || hole.strokesReceived !== 0 && hole.strokesReceived !== null)) return false;
    if (raw.status === 'complete' && (raw.grossToPar === null || game.basis === 'net' && raw.netToPar === null)) return false;
    if ((raw.status === 'pending' || raw.status === 'ineligible') && (raw.grossToPar !== null || raw.netToPar !== null)) return false;
    if (raw.grossToPar !== null && raw.netToPar !== null && hole.strokesReceived !== null
      && BigInt(raw.grossToPar) - BigInt(raw.netToPar) !== BigInt(hole.strokesReceived)) return false;
    if (hole.strokesReceived !== null) received.push(hole.strokesReceived);
  }
  if (game.basis === 'net' && value.playingHandicap !== null) {
    const count = value.totalHoles;
    const quotient = Math.floor(value.playingHandicap / count);
    if (received.length !== count || received.some((stroke) => stroke !== quotient && stroke !== quotient + 1)
      || received.reduce((sum, stroke) => sum + BigInt(stroke), 0n) !== BigInt(value.playingHandicap)) return false;
  } else if (game.basis === 'net' && score.unavailableReason === undefined) return false;
  if (game.kind === 'ball-drop') {
    const count = holes.filter((hole) => hole.status === 'complete' || hole.status === 'ineligible').length;
    if (score.frontTotal !== null || score.backTotal !== null || score.total !== null || count !== value.holesScored
      || value.status !== (score.unavailableReason || holes.some((hole) => hole.status === 'unavailable')
        ? 'unavailable' : count === value.totalHoles ? 'complete' : 'in-progress')) return false;
  }
  return true;
}

export function isStrokeGameResult(value: unknown, game: NewRoundGameDefinition): value is RoundGameResult {
  if (!isRecord(value) || !Array.isArray(value.players) || value.players.length === 0
    || !value.players.every((player: unknown) => isPlayer(player, game))
    || new Set(value.players.map((player: GamePlayerResult) => player.playerId)).size !== value.players.length
    || new Set(value.players.map((player: GamePlayerResult) => player.totalHoles)).size !== 1) return false;
  return sameJsonValue(value, aggregateStrokeGameResults(game, value.players));
}
