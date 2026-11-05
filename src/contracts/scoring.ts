import type {
  GameWriteResult, HoleScore, RoundScores, Scorecard, ScoreChange, ScoreHistoryPage, ScoreWriteResult,
} from '../domain/scoring.js';
import { maximumExactHoleStrokes } from '../domain/scoring.js';
import { boundedText, positiveInteger } from './catalog.js';
import { isEventRevision, isEventStatus, isRecord, isUuid } from './events.js';
import { isGameChange, isRoundGamesView } from './games.js';
import { handicapStrokesForHole, stablefordScorePoints } from '../domain/stableford.js';
import type { CourseHole } from '../domain/catalog.js';
import { isPlayerTeeProfiles } from './tees.js';
import type { ScoreActor } from '../domain/test-access.js';
import { isEventTesterIdentity } from './test-access.js';

export function isScoreActor(value: unknown): value is ScoreActor {
  return isEventTesterIdentity(value) || isRecord(value) && !Object.hasOwn(value, 'kind')
    && isUuid(value.tenantId) && isUuid(value.objectId);
}

function instant(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

export function isHoleScore(value: unknown): value is HoleScore {
  if (!isRecord(value)) return false;
  if (value.kind === 'strokes') {
    return Object.keys(value).length === 2 && positiveInteger(value.strokes, maximumExactHoleStrokes);
  }
  if (value.kind === 'picked-up') {
    return Object.keys(value).length === 1
      || Object.keys(value).length === 2 && positiveInteger(value.reportedStrokes, maximumExactHoleStrokes);
  }
  return Object.keys(value).length === 1 && (value.kind === 'unplayed' || value.kind === 'did-not-finish');
}

export function parseScoreEntry(text: string): HoleScore | null {
  const value = text.trim();
  if (!value) return { kind: 'unplayed' };
  if (/^DNF$/i.test(value)) return { kind: 'did-not-finish' };
  if (/^X$/i.test(value)) return { kind: 'picked-up' };
  const pickup = /^X(\d+)$/i.exec(value);
  const digits = pickup?.[1] ?? (/^\d+$/.test(value) ? value : null);
  if (digits === null) return null;
  const strokes = Number(digits);
  if (!positiveInteger(strokes, maximumExactHoleStrokes)) return null;
  return pickup ? { kind: 'picked-up', reportedStrokes: strokes } : { kind: 'strokes', strokes };
}

export function scoreEntryText(score: HoleScore): string {
  switch (score.kind) {
    case 'unplayed': return '';
    case 'strokes': return String(score.strokes);
    case 'picked-up': return score.reportedStrokes === undefined ? 'X' : `X${String(score.reportedStrokes)}`;
    case 'did-not-finish': return 'DNF';
  }
}

export function isScorecard(value: unknown): value is Scorecard {
  if (!isRecord(value) || !isUuid(value.playerId) || !boundedText(value.displayName)
    || value.etag !== null && !isEventRevision(value.etag)
    || value.updatedAt !== null && !instant(value.updatedAt)
    || !Array.isArray(value.holes) || ![9, 18].includes(value.holes.length)) return false;
  const count = value.holes.length;
  if (!value.holes.every((hole: unknown) => isRecord(hole) && positiveInteger(hole.number, count) && isHoleScore(hole.score))) return false;
  return new Set(value.holes.map((hole: { readonly number: number }) => hole.number)).size === count
    && (value.etag === null
      ? value.updatedAt === null && value.holes.every((hole: { readonly score: HoleScore }) => hole.score.kind === 'unplayed')
      : value.updatedAt !== null);
}

export function isRoundScores(value: unknown): value is RoundScores {
  if (!isRecord(value) || !isUuid(value.eventId) || !isUuid(value.roundId) || !isEventStatus(value.eventStatus)
    || !boundedText(value.eventName) || !boundedText(value.roundName) || !boundedText(value.courseName, 200)
    || !boundedText(value.teeName) || !boundedText(value.teeCategory, 40)
    || typeof value.setupLocked !== 'boolean'
    || value.lastUpdatedAt !== null && !instant(value.lastUpdatedAt)
    || !Array.isArray(value.layout) || ![9, 18].includes(value.layout.length)
    || !Array.isArray(value.cards) || value.cards.length < 1 || !value.cards.every(isScorecard)
    || !Array.isArray(value.groups) || value.groups.length < 1) return false;
  if (value.teeRatings !== undefined) {
    if (!Array.isArray(value.teeRatings) || value.teeRatings.length !== 3
      || !value.teeRatings.every((rating: unknown) => isRecord(rating)
        && (rating.type === 'Total' || rating.type === 'Front' || rating.type === 'Back')
        && typeof rating.course === 'number' && Number.isFinite(rating.course) && rating.course > 0 && rating.course <= 150
        && positiveInteger(rating.slope, 300) && typeof rating.bogey === 'number'
        && Number.isFinite(rating.bogey) && rating.bogey > 0 && rating.bogey <= 200)
      || new Set(value.teeRatings.map((rating: { readonly type: string }) => rating.type)).size !== 3) return false;
  }
  const count = value.layout.length;
  if (!value.layout.every((hole: unknown): hole is CourseHole => isRecord(hole) && positiveInteger(hole.number, count)
    && positiveInteger(hole.sourceId) && positiveInteger(hole.length, 2_000)
    && positiveInteger(hole.par, 10) && positiveInteger(hole.allocation, count))) return false;
  if (new Set(value.layout.map((hole: { readonly number: number }) => hole.number)).size !== count) return false;
  if (new Set(value.layout.map((hole: { readonly sourceId: number }) => hole.sourceId)).size !== count
    || new Set(value.layout.map((hole: { readonly allocation: number }) => hole.allocation)).size !== count) return false;
  const cards: Scorecard[] = value.cards;
  const cardsById = new Map(cards.map((card) => [card.playerId, card]));
  const layout = value.layout;
  const persisted = cards.some((card) => card.etag !== null);
  if (value.setupLocked !== persisted || (persisted ? value.lastUpdatedAt === null : value.lastUpdatedAt !== null)) return false;
  const ids = cards.map((card) => card.playerId);
  const roster = new Set(ids);
  if (new Set(ids).size !== ids.length || cards.some((card) => card.holes.length !== count)) return false;
  if (value.permissions !== undefined) {
    const permission = value.permissions;
    if (!isRecord(permission) || !['owner', 'player', 'viewer', 'tester'].includes(String(permission.role))
      || !Object.keys(permission).every((key) => ['role', 'viewerPlayerId', 'writePlayerIds', 'canManageGames'].includes(key))
      || !Array.isArray(permission.writePlayerIds) || !permission.writePlayerIds.every((id: unknown) => isUuid(id) && roster.has(id))
      || new Set(permission.writePlayerIds).size !== permission.writePlayerIds.length
      || typeof permission.canManageGames !== 'boolean') return false;
    if (permission.role === 'owner') {
      if (permission.viewerPlayerId !== undefined || permission.canManageGames !== (value.eventStatus === 'active')
        || permission.writePlayerIds.length !== (value.eventStatus === 'active' ? cards.length : 0)) return false;
    } else if (permission.role === 'tester') {
      if (value.eventStatus !== 'active' || permission.viewerPlayerId !== undefined || permission.canManageGames
        || permission.writePlayerIds.length !== cards.length) return false;
    } else if (permission.role === 'viewer') {
      if (permission.viewerPlayerId !== undefined || permission.writePlayerIds.length || permission.canManageGames) return false;
    } else {
      if (!isUuid(permission.viewerPlayerId) || !roster.has(permission.viewerPlayerId) || permission.canManageGames) return false;
      const group: unknown = value.groups.find((entry: unknown) => isRecord(entry)
        && Array.isArray(entry.playerIds) && entry.playerIds.includes(permission.viewerPlayerId));
      if (!isRecord(group) || !Array.isArray(group.playerIds)) return false;
      const members: readonly unknown[] = group.playerIds;
      if (permission.writePlayerIds.length !== (value.eventStatus === 'active' ? members.length : 0)
        || permission.writePlayerIds.some((id: unknown) => !members.includes(id))) return false;
    }
  }
  if (value.overallHandicaps !== undefined) {
    const published = value.overallHandicaps;
    if (!isRecord(published) || Object.keys(published).length !== 2
      || !positiveInteger(published.allowancePercent, 100) || !Array.isArray(published.players)
      || published.players.length !== cards.length) return false;
    const seen = new Set<string>();
    for (const player of published.players) {
      if (!isRecord(player) || !isUuid(player.playerId) || !roster.has(player.playerId) || seen.has(player.playerId)
        || !Object.keys(player).every((key) => ['playerId', 'playingHandicap', 'unavailableReason'].includes(key))) return false;
      if (player.playingHandicap === null) {
        if (!['missing-handicap-index', 'invalid-handicap-index', 'missing-tee-ratings', 'missing-stroke-index'].includes(String(player.unavailableReason))) return false;
      } else if (typeof player.playingHandicap !== 'number' || !Number.isSafeInteger(player.playingHandicap)
        || player.unavailableReason !== undefined) return false;
      seen.add(player.playerId);
    }
  }
  if (value.playerTees !== undefined && !isPlayerTeeProfiles(value.playerTees, { holeCount: count, holes: layout }, ids)) return false;
  const playerLayouts = new Map(value.playerTees?.map((entry) => [entry.playerId, entry.profile.holes]));
  if (value.games !== undefined) {
    if (!isRoundGamesView(value.games) || value.games.configuration.eventId !== value.eventId
      || value.games.configuration.roundId !== value.roundId
      || value.games.results.some((result) => result.players.length !== cards.length || result.players.some((player) => {
        const card = cardsById.get(player.playerId);
        return !card || card.displayName !== player.displayName || player.totalHoles !== count
          || !player.holes.every((hole) => card.holes.some((entry) => entry.number === hole.number));
      }))) return false;
    for (const result of value.games.results) {
      const game = value.games.configuration.games.find((entry) => entry.id === result.gameId);
      if (!game) return false;
      const minimum = Math.min(game.points.betterScorePoints, game.points.worseScorePoints, ...game.points.rows.map((row) => row.points));
      for (const player of result.players) {
        if (player.status === 'unavailable') continue;
        const card = cardsById.get(player.playerId);
        if (!card) return false;
        for (const hole of player.holes) {
          const sourceHole = (playerLayouts.get(player.playerId) ?? layout).find((entry) => entry.number === hole.number);
          const saved = card.holes.find((entry) => entry.number === hole.number);
          if (!sourceHole || !saved) return false;
          const received = handicapStrokesForHole(player.playingHandicap ?? 0, sourceHole.allocation, count);
          const expected = saved.score.kind === 'unplayed' ? null : saved.score.kind === 'strokes'
            ? stablefordScorePoints(game.points, saved.score.strokes - received - sourceHole.par) : minimum;
          if (hole.strokesReceived !== received || hole.points !== expected) return false;
        }
      }
    }
  }
  const assigned: string[] = [];
  const groupNumbers = new Set<number>();
  for (const group of value.groups) {
    if (!isRecord(group) || !positiveInteger(group.number, Number.MAX_SAFE_INTEGER) || !Array.isArray(group.playerIds)
      || group.playerIds.length < 1 || group.playerIds.length > 4) return false;
    const players: unknown[] = group.playerIds;
    if (!players.every((id): id is string => isUuid(id) && roster.has(id))) return false;
    assigned.push(...players);
    groupNumbers.add(group.number);
  }
  return groupNumbers.size === value.groups.length && assigned.length === ids.length && new Set(assigned).size === ids.length;
}

export function isScoreChange(value: unknown): value is ScoreChange {
  return isRecord(value) && isUuid(value.id) && isUuid(value.eventId) && isUuid(value.roundId)
    && isUuid(value.playerId) && positiveInteger(value.holeNumber, 18)
    && isHoleScore(value.before) && isHoleScore(value.after)
    && (value.expectedEtag === null || isEventRevision(value.expectedEtag))
    && instant(value.recordedAt) && isScoreActor(value.recordedBy)
    && (!('kind' in value.recordedBy) || value.recordedBy.eventId === value.eventId);
}

export function isScoreWriteResult(value: unknown): value is ScoreWriteResult {
  if (!isRecord(value) || !isRoundScores(value.round) || !isScoreChange(value.change)) return false;
  const { round, change } = value;
  return change.eventId === round.eventId && change.roundId === round.roundId
    && round.cards.some((card) => card.playerId === change.playerId && card.etag !== null)
    && round.layout.some((hole) => hole.number === change.holeNumber);
}

export function isGameWriteResult(value: unknown): value is GameWriteResult {
  return isRecord(value) && isRoundScores(value.round) && value.round.games !== undefined
    && isGameChange(value.change) && value.change.eventId === value.round.eventId
    && value.change.roundId === value.round.roundId && value.round.games.configuration.etag !== null;
}

export function isScoreHistoryPage(value: unknown): value is ScoreHistoryPage {
  return isRecord(value) && Array.isArray(value.changes) && value.changes.length <= 50
    && value.changes.every(isScoreChange)
    && (value.continuationToken === undefined || typeof value.continuationToken === 'string' && value.continuationToken.length <= 2048);
}
