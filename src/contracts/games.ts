import type {
  GameChange, GameConfiguration, GamePlayerResult, GameTeamResult, RoundGameDefinition, RoundGamesView, StablefordGameDefinition,
} from '../domain/games.js';
import {
  gameTeamsMatchRoster, isStablefordGame, isTeamGameDefinition, maximumExactGamePoints, maximumExactPointsForGame,
  maximumGamesPerRound, maximumPointsRows, teamCountingSize, teamSize,
} from '../domain/games.js';
import { aggregateTeamGameResults } from '../domain/team-games.js';
import { boundedText, isDateOnly } from './catalog.js';
import { isEventRevision, isRecord, isUuid } from './events.js';
import { isStrokeGameResult } from './stroke-games.js';
import { isChurchyDefinition, isChurchyResult } from './churchy.js';

function keys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}

function points(value: unknown, maximum = maximumExactGamePoints): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= maximum;
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function pointsTable(value: unknown, maximum: number): boolean {
  if (!isRecord(value) || !keys(value, ['rows', 'betterScorePoints', 'worseScorePoints'])
    || !points(value.betterScorePoints, maximum) || !points(value.worseScorePoints, maximum)
    || !Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > maximumPointsRows) return false;
  let previous: number | undefined;
  for (const row of value.rows) {
    if (!isRecord(row) || !keys(row, ['scoreToPar', 'points']) || !integer(row.scoreToPar) || !points(row.points, maximum)
      || previous !== undefined && BigInt(row.scoreToPar) !== BigInt(previous) + 1n) return false;
    previous = row.scoreToPar;
  }
  return true;
}

export function isRoundGameDefinition(value: unknown): value is RoundGameDefinition {
  if (isRecord(value) && value.kind === 'churchy') return isChurchyDefinition(value);
  if (isRecord(value) && (value.kind === 'ball-drop' || value.kind === 'skins')) {
    if (!isUuid(value.id) || !boundedText(value.name) || value.version !== 1
      || value.basis !== 'gross' && value.basis !== 'net') return false;
    if (value.kind === 'skins') return keys(value, ['id', 'name', 'kind', 'version', 'basis', 'carryovers'])
      && typeof value.carryovers === 'boolean';
    if (!keys(value, ['id', 'name', 'kind', 'version', 'basis', 'format', 'teams'])
      || !['ball-drop-net-gross', 'ball-drop-two-net', 'ball-drop-two-gross'].includes(String(value.format))
      || value.basis !== (value.format === 'ball-drop-two-gross' ? 'gross' : 'net')
      || !Array.isArray(value.teams) || value.teams.length === 0) return false;
    const ids = new Set<string>();
    const members = new Set<string>();
    for (const team of value.teams) {
      if (!isRecord(team) || !keys(team, ['id', 'name', 'playerIds']) || !isUuid(team.id) || ids.has(team.id)
        || !boundedText(team.name) || !Array.isArray(team.playerIds) || team.playerIds.length !== 4) return false;
      ids.add(team.id);
      for (const id of team.playerIds) {
        if (!isUuid(id) || members.has(id)) return false;
        members.add(id);
      }
    }
    return true;
  }
  if (!isRecord(value) || !isUuid(value.id) || !boundedText(value.name)
    || value.preset !== 'standard' && value.preset !== 'modified'
    || value.basis !== 'gross' && value.basis !== 'net'
    || !integer(value.handicapAllowancePercent) || value.handicapAllowancePercent < 1 || value.handicapAllowancePercent > 100) return false;
  const common = ['id', 'name', 'preset', 'basis', 'handicapAllowancePercent', 'points'];
  if (value.kind !== undefined && value.kind !== 'stableford') return false;
  if (!Object.hasOwn(value, 'format')) return keys(value, common, ['kind']) && pointsTable(value.points, maximumExactGamePoints);
  if (!keys(value, [...common, 'format', 'teams'], ['kind']) || value.basis !== 'net'
    || value.format !== 'two-net-better-ball' && value.format !== 'two-net-aggregate' && value.format !== 'four-two-net'
    || !Array.isArray(value.teams)) return false;
  const size = teamSize(value.format);
  const ids = new Set<string>();
  const members = new Set<string>();
  for (const team of value.teams) {
    if (!isRecord(team) || !keys(team, ['id', 'name', 'playerIds']) || !isUuid(team.id) || ids.has(team.id)
      || !boundedText(team.name) || !Array.isArray(team.playerIds) || team.playerIds.length !== size) return false;
    ids.add(team.id);
    for (const id of team.playerIds) {
      if (!isUuid(id) || members.has(id)) return false;
      members.add(id);
    }
  }
  return members.size >= size
    && pointsTable(value.points, Math.floor(Number.MAX_SAFE_INTEGER / (18 * teamCountingSize(value.format))));
}

export function isRoundGameDefinitions(value: unknown): value is readonly RoundGameDefinition[] {
  return Array.isArray(value) && value.length <= maximumGamesPerRound && value.every(isRoundGameDefinition)
    && value.filter((game: RoundGameDefinition) => game.kind === 'churchy').length <= 1
    && new Set(value.map((game: RoundGameDefinition) => game.id)).size === value.length;
}

export function isGameConfiguration(value: unknown): value is GameConfiguration {
  return isRecord(value) && keys(value, ['eventId', 'roundId', 'etag', 'games'])
    && isUuid(value.eventId) && isUuid(value.roundId) && isRoundGameDefinitions(value.games)
    && (value.games.length === 0 ? value.etag === null : isEventRevision(value.etag));
}

export function isGameChange(value: unknown): value is GameChange {
  return isRecord(value)
    && keys(value, ['id', 'eventId', 'roundId', 'expectedEtag', 'before', 'after', 'recordedAt', 'recordedBy'])
    && isUuid(value.id) && isUuid(value.eventId) && isUuid(value.roundId)
    && isRoundGameDefinitions(value.before) && isRoundGameDefinitions(value.after) && value.after.length > 0
    && (value.before.length === 0 ? value.expectedEtag === null : isEventRevision(value.expectedEtag))
    && typeof value.recordedAt === 'string' && value.recordedAt.length <= 40
    && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value.recordedAt)
    && isDateOnly(value.recordedAt.slice(0, 10))
    && Number.isFinite(Date.parse(value.recordedAt))
    && isRecord(value.recordedBy) && keys(value.recordedBy, ['tenantId', 'objectId'])
    && isUuid(value.recordedBy.tenantId) && isUuid(value.recordedBy.objectId);
}

function total(holes: GamePlayerResult['holes']): number | null {
  const scored = holes.filter((hole) => hole.points !== null);
  return scored.length ? scored.reduce((sum, hole) => sum + (hole.points ?? 0), 0) : null;
}

function isPlayerResult(value: unknown, game: StablefordGameDefinition): value is GamePlayerResult {
  if (!isRecord(value)
    || !keys(value, ['playerId', 'displayName', 'playingHandicap', 'status', 'holes', 'holesScored',
      'totalHoles', 'frontPoints', 'backPoints', 'totalPoints'], ['unavailableReason'])
    || !isUuid(value.playerId) || !boundedText(value.displayName)
    || !Array.isArray(value.holes) || ![9, 18].includes(value.holes.length)
    || value.totalHoles !== value.holes.length || !integer(value.holesScored)) return false;
  const allowedPoints = new Set([game.points.betterScorePoints, game.points.worseScorePoints,
    ...game.points.rows.map((row) => row.points)]);
  const unavailable = value.status === 'unavailable';
  if (unavailable) {
    const reasons = game.basis === 'gross' ? ['missing-score-data'] : [
      'missing-score-data', 'missing-handicap-index', 'invalid-handicap-index',
      'missing-tee-ratings', 'missing-stroke-index',
    ];
    if (typeof value.unavailableReason !== 'string' || !reasons.includes(value.unavailableReason)
      || value.playingHandicap !== null) return false;
  } else if (value.unavailableReason !== undefined
    || value.status !== 'complete' && value.status !== 'in-progress'
    || (game.basis === 'gross' ? value.playingHandicap !== null : !integer(value.playingHandicap))) return false;
  const holes: GamePlayerResult['holes'][number][] = [];
  for (const [index, hole] of value.holes.entries()) {
    if (!isRecord(hole) || !keys(hole, ['number', 'points', 'strokesReceived']) || hole.number !== index + 1
      || (hole.points !== null && (!points(hole.points, maximumExactPointsForGame(game)) || !allowedPoints.has(hole.points)))
      || (hole.strokesReceived !== null && !integer(hole.strokesReceived))) return false;
    if (unavailable ? hole.points !== null || hole.strokesReceived !== null
      : game.basis === 'gross' ? hole.strokesReceived !== 0 : hole.strokesReceived === null) return false;
    holes.push({ number: index + 1, points: hole.points, strokesReceived: hole.strokesReceived });
  }
  const scored = holes.filter((hole) => hole.points !== null).length;
  if (value.holesScored !== scored || value.frontPoints !== total(holes.slice(0, 9))
    || value.backPoints !== total(holes.slice(9)) || value.totalPoints !== total(holes)
    || !unavailable && value.status !== (scored === holes.length ? 'complete' : 'in-progress')) return false;
  if (!unavailable && game.basis === 'net' && integer(value.playingHandicap)) {
    const handicap = BigInt(value.playingHandicap);
    const count = BigInt(holes.length);
    const remainder = ((handicap % count) + count) % count;
    const quotient = (handicap - remainder) / count;
    if (holes.some((hole) => hole.strokesReceived === null
      || BigInt(hole.strokesReceived) !== quotient && BigInt(hole.strokesReceived) !== quotient + 1n)
      || holes.reduce((sum, hole) => sum + BigInt(hole.strokesReceived ?? 0), 0n) !== handicap) return false;
  }
  return true;
}

function matchesTeamResult(value: unknown, expected: GameTeamResult): boolean {
  return isRecord(value)
    && keys(value, ['teamId', 'displayName', 'playerIds', 'status', 'holes', 'holesScored',
      'totalHoles', 'frontPoints', 'backPoints', 'totalPoints'],
    expected.status === 'unavailable' ? ['unavailableReason'] : [])
    && value.teamId === expected.teamId && value.displayName === expected.displayName
    && value.status === expected.status && value.unavailableReason === expected.unavailableReason
    && (expected.status !== 'unavailable' || Object.hasOwn(value, 'unavailableReason'))
    && value.holesScored === expected.holesScored && value.totalHoles === expected.totalHoles
    && value.frontPoints === expected.frontPoints && value.backPoints === expected.backPoints
    && value.totalPoints === expected.totalPoints
    && Array.isArray(value.playerIds) && value.playerIds.length === expected.playerIds.length
    && value.playerIds.every((id: unknown, index: number) => id === expected.playerIds[index])
    && Array.isArray(value.holes) && value.holes.length === expected.holes.length
    && value.holes.every((hole: unknown, index: number) => isRecord(hole) && keys(hole, ['number', 'points'])
      && hole.number === expected.holes[index]?.number && hole.points === expected.holes[index]?.points);
}

export function isRoundGamesView(value: unknown): value is RoundGamesView {
  if (!isRecord(value) || !keys(value, ['configuration', 'results']) || !isGameConfiguration(value.configuration)
    || !Array.isArray(value.results) || value.results.length !== value.configuration.games.length) return false;
  const seen = new Set<string>();
  const players = new Map<string, GamePlayerResult>();
  const names = new Map<string, string>();
  let expectedIds: string | undefined;
  let totalHoles: number | undefined;
  for (const result of value.results) {
    if (!isRecord(result) || !isUuid(result.gameId) || seen.has(result.gameId)) return false;
    const game = value.configuration.games.find((candidate) => candidate.id === result.gameId);
    if (game?.kind === 'churchy') {
      if (!isChurchyResult(result, game)) return false;
      seen.add(result.gameId);
      continue;
    }
    if (game && !isStablefordGame(game)) {
      if (!isStrokeGameResult(result, game)) return false;
      const ids = result.players.map((player) => player.playerId).sort().join(',');
      if (expectedIds !== undefined && expectedIds !== ids) return false;
      expectedIds = ids;
      for (const player of result.players) {
        if (totalHoles !== undefined && totalHoles !== player.totalHoles) return false;
        totalHoles = player.totalHoles;
        const previous = names.get(player.playerId);
        if (previous !== undefined && previous !== player.displayName) return false;
        names.set(player.playerId, player.displayName);
      }
      seen.add(result.gameId);
      continue;
    }
    if (!game || !keys(result, isTeamGameDefinition(game) ? ['gameId', 'players', 'teams'] : ['gameId', 'players'],
      isTeamGameDefinition(game) ? ['teamSetupRequired'] : [])
      || !Array.isArray(result.players) || result.players.length < 1) return false;
    const ids = new Set<string>();
    const components: GamePlayerResult[] = [];
    for (const player of result.players) {
      if (!isPlayerResult(player, game) || ids.has(player.playerId)) return false;
      const name = names.get(player.playerId);
      if (name !== undefined && name !== player.displayName) return false;
      names.set(player.playerId, player.displayName);
      if (totalHoles !== undefined && totalHoles !== player.totalHoles) return false;
      totalHoles = player.totalHoles;
      ids.add(player.playerId);
      components.push(player);
      const previous = players.get(player.playerId);
      if (previous && (previous.displayName !== player.displayName || previous.totalHoles !== player.totalHoles
        || previous.status !== 'unavailable' && player.status !== 'unavailable'
        && previous.holes.some((hole, index) => (hole.points === null) !== (player.holes[index]?.points === null)))) return false;
      if (!previous || previous.status === 'unavailable') players.set(player.playerId, player);
    }
    const fingerprint = [...ids].sort().join(',');
    if (expectedIds !== undefined && expectedIds !== fingerprint) return false;
    expectedIds = fingerprint;
    if (isTeamGameDefinition(game)) {
      if (!Array.isArray(result.teams)) return false;
      if (!gameTeamsMatchRoster(game, [...ids])) {
        if (result.teamSetupRequired !== true || result.teams.length !== 0) return false;
      } else {
        if (Object.hasOwn(result, 'teamSetupRequired') || result.teams.length !== game.teams.length) return false;
        const expected = aggregateTeamGameResults(game, components, components[0]?.holes.map((hole) => hole.number) ?? []);
        const teams: unknown[] = result.teams;
        if (!expected.every((team, index) => matchesTeamResult(teams[index], team))) return false;
      }
    }
    seen.add(result.gameId);
  }
  return true;
}
