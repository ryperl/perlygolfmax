import type {
  GameWriteResult, HoleScore, RoundScores, Scorecard, ScoreChange, ScoreHistoryPage, ScoreWriteResult,
} from '../domain/scoring.js';
import { maximumExactHoleStrokes } from '../domain/scoring.js';
import { boundedText, positiveInteger, isVersionId } from './catalog.js';
import { isEventRevision, isEventStatus, isRecord, isUuid } from './events.js';
import { isGameChange, isRoundGamesView } from './games.js';
import { handicapStrokesForHole, stablefordScorePoints } from '../domain/stableford.js';
import type { CourseHole } from '../domain/catalog.js';
import type { PlayerCourseHandicap } from '../domain/scoring.js';
import { isPlayerTeeProfiles } from './tees.js';
import type { ScoreActor } from '../domain/test-access.js';
import { isEventTesterIdentity } from './test-access.js';
import { isPublicScoreIdentity } from './public-access.js';
import { isStablefordGame, roundGameKinds } from '../domain/games.js';
import type { RoundGroup } from '../domain/setup.js';
import type { RoundGameScoringContext } from '../domain/game-declarations.js';
import { isNassauHoleRecord } from './nassau.js';
import { isWolfRecord } from './wolf.js';
import { isDotsHoleRecord } from './dots.js';
import { dotsSpecialCatalog } from '../domain/dots.js';
import { isDotAwardAudit } from './dot-audit.js';
import { calculateInternalSettlements } from '../domain/internal-games.js';
import { calculateStrokeGameResults } from '../domain/stroke-games.js';
import { sameJsonValue } from './round-context.js';
import { isChurchySpecials } from './churchy.js';
import { isRoundDifferentials } from './round-differential.js';
import { calculateChurchyResults, churchySpecialsMatchGame } from '../domain/churchy.js';
import { isKpConfiguration, isKpEntry } from './kp.js';
import { purseCurrencies } from '../domain/purse.js';
import { restoreLeanRoundGames } from './lean-round-scores.js';
import { hasCustomChurchyName } from './churchy-names.js';

export function isScoreActor(value: unknown): value is ScoreActor {
  return isPublicScoreIdentity(value) || isEventTesterIdentity(value) || isRecord(value) && !Object.hasOwn(value, 'kind')
    && isUuid(value.tenantId) && isUuid(value.objectId);
}

function instant(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function isCourseHandicap(value: unknown): value is PlayerCourseHandicap {
  if (!isRecord(value) || !isUuid(value.playerId)
    || !Object.keys(value).every((key) => ['playerId', 'courseHandicap', 'unavailableReason'].includes(key))) return false;
  return value.courseHandicap === null
    ? typeof value.unavailableReason === 'string'
      && ['missing-handicap-index', 'uncaptured-handicap-index', 'invalid-handicap-index', 'missing-tee-ratings'].includes(value.unavailableReason)
    : typeof value.courseHandicap === 'number' && Number.isSafeInteger(value.courseHandicap) && value.unavailableReason === undefined;
}

function isReviewWarnings(value: unknown): boolean {
  const codes = ['kp-review-required', 'purse-review-required', 'team-review-required', 'churchy-review-required'];
  return Array.isArray(value) && value.every((entry) => isRecord(entry) && Object.keys(entry).length === 2
    && typeof entry.code === 'string' && codes.includes(entry.code) && boundedText(entry.message, 240));
}

export function isHoleScore(value: unknown): value is HoleScore {
  if (!isRecord(value)) return false;
  if (value.churchy !== undefined && !isChurchySpecials(value.churchy)) return false;
  if (value.kp !== undefined && !isKpEntry(value.kp)) return false;
  if (value.nassau !== undefined && (!Array.isArray(value.nassau) || !value.nassau.every(isNassauHoleRecord)
    || new Set(value.nassau.map((record) => record.gameId)).size !== value.nassau.length)) return false;
  if (value.wolf !== undefined && (!Array.isArray(value.wolf) || !value.wolf.every(isWolfRecord)
    || new Set(value.wolf.map((record) => record.choice.gameId)).size !== value.wolf.length)) return false;
  if (value.dots !== undefined && (!Array.isArray(value.dots) || !value.dots.every(isDotsHoleRecord)
    || new Set(value.dots.map((record) => record.gameId)).size !== value.dots.length)) return false;
  const count = Object.keys(value).filter((key) => !['churchy', 'kp', 'nassau', 'wolf', 'dots'].includes(key)).length;
  if (value.kind === 'strokes') {
    return count === 2 && positiveInteger(value.strokes, maximumExactHoleStrokes);
  }
  if (value.kind === 'picked-up') {
    return count === 1
      || count === 2 && positiveInteger(value.reportedStrokes, maximumExactHoleStrokes);
  }
  return count === 1 && (value.kind === 'unplayed' || value.kind === 'did-not-finish');
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
  if (!value.holes.every((hole: unknown) => isRecord(hole) && positiveInteger(hole.number, 18) && isHoleScore(hole.score)
    && (hole.score.nassau ?? []).every((record) => record.number === hole.number)
    && (hole.score.wolf ?? []).every((record) => record.number === hole.number)
    && (hole.score.dots ?? []).every((record) => record.number === hole.number))) return false;
  const numbers = value.holes.map((hole: { readonly number: number }) => hole.number);
  return (count === 18 || numbers.every((number) => number <= 9) || numbers.every((number) => number >= 10))
    && new Set(numbers).size === count
    && (value.etag === null
      ? value.updatedAt === null && value.holes.every((hole: { readonly score: HoleScore }) => hole.score.kind === 'unplayed')
      : value.updatedAt !== null);
}

export function isRoundScores(value: unknown): value is RoundScores {
  return validateRoundScores(value);
}

/** New readers accept legacy full responses; tagged lean responses are strict and lossless. */
export function decodeRoundScores(value: unknown): RoundScores | null {
  if (!isRecord(value) || value.kind !== 'round-scores-lean') return isRoundScores(value) ? value : null;
  if (value.version !== 1 || Object.keys(value).length !== 3 || !isRecord(value.round)) return null;
  const round = { ...value.round };
  return validateRoundScores(round, true) ? round : null;
}

function validateRoundScores(value: unknown, lean = false): value is RoundScores {
  if (isRecord(value) && value.churchyCustomNames !== undefined && value.churchyCustomNames !== true) return false;
  if (isRecord(value) && value.dotsCallTargets !== undefined
    && (value.dotsCallTargets !== true || value.internalGamesSupported !== true
      || !Array.isArray(value.supportedGameKinds) || !value.supportedGameKinds.includes('dots')
      || isRecord(value.permissions) && value.permissions.role === 'tester')) return false;
  if (isRecord(value) && value.stringRulesVersion !== undefined && value.stringRulesVersion !== 2) return false;
  if (isRecord(value) && value.dotsCategorySweepsVersion !== undefined && value.dotsCategorySweepsVersion !== 1) return false;
  if (isRecord(value) && value.churchyMurphyTargets !== undefined
    && (value.churchyMurphyTargets !== true || value.churchyEnabled !== true
      || isRecord(value.permissions) && value.permissions.role === 'tester')) return false;
  if (isRecord(value) && value.churchyPareeTargets !== undefined
    && (value.churchyPareeTargets !== true || value.churchyEnabled !== true
      || isRecord(value.permissions) && value.permissions.role === 'tester')) return false;
  if (isRecord(value) && value.dotsSpecialKinds !== undefined && (!Array.isArray(value.dotsSpecialKinds)
    || !value.dotsSpecialKinds.every((kind: unknown) => dotsSpecialCatalog.some((entry) => entry.kind === kind))
    || new Set(value.dotsSpecialKinds).size !== value.dotsSpecialKinds.length)) return false;
  if (isRecord(value) && value.churchyRulesVersions !== undefined
    && (!Array.isArray(value.churchyRulesVersions)
      || !value.churchyRulesVersions.every((version: unknown) => version === 1 || version === 2 || version === 3)
      || new Set(value.churchyRulesVersions).size !== value.churchyRulesVersions.length
      || value.churchyRulesVersions.length > 0 && value.churchyEnabled !== true)) return false;
  if (isRecord(value) && (value.internalGamesSupported !== undefined && typeof value.internalGamesSupported !== 'boolean'
    || value.dotsIndividualPlayerCounts !== undefined && (!Array.isArray(value.dotsIndividualPlayerCounts)
      || !value.dotsIndividualPlayerCounts.every((count: unknown) => count === 1 || count === 2 || count === 3 || count === 4)
      || new Set(value.dotsIndividualPlayerCounts).size !== value.dotsIndividualPlayerCounts.length)
    || value.dotsRulesVersions !== undefined && (!Array.isArray(value.dotsRulesVersions)
      || !value.dotsRulesVersions.every((version: unknown) => version === 1 || version === 2)
      || new Set(value.dotsRulesVersions).size !== value.dotsRulesVersions.length)
    || value.wolfRulesVersions !== undefined && (!Array.isArray(value.wolfRulesVersions)
      || !value.wolfRulesVersions.every((version: unknown) => version === 1 || version === 2)
      || new Set(value.wolfRulesVersions).size !== value.wolfRulesVersions.length))) return false;
  if (isRecord(value) && value.supportedGameKinds !== undefined && (!Array.isArray(value.supportedGameKinds)
    || !value.supportedGameKinds.every((kind: unknown) => roundGameKinds.some((known) => known === kind))
    || new Set(value.supportedGameKinds).size !== value.supportedGameKinds.length
    || value.supportedGameKinds.includes('churchy') && value.churchyEnabled !== true)) return false;
  if (isRecord(value) && value.gameInputContext !== undefined && (!isRecord(value.gameInputContext)
    || Object.keys(value.gameInputContext).length !== 2 || !isVersionId(value.gameInputContext.courseVersionId)
    || !positiveInteger(value.gameInputContext.teeProfileId))) return false;
  if (isRecord(value) && (value.dotsManualSweep !== undefined && value.dotsManualSweep !== true
    || value.wolfHighLowSweep !== undefined && value.wolfHighLowSweep !== true
    || value.sweepRulesVersion !== undefined && value.sweepRulesVersion !== 2)) return false;
  if (isRecord(value) && value.quickRound !== undefined && value.quickRound !== true) return false;
  if (isRecord(value) && (value.kpEnabled !== undefined && typeof value.kpEnabled !== 'boolean'
    || value.kpCaptureIdentity !== undefined && (typeof value.kpCaptureIdentity !== 'string' || value.kpCaptureIdentity.length === 0)
    || value.kp !== undefined && !isKpConfiguration(value.kp))) return false;
  if (isRecord(value) && value.kpPot !== undefined) {
    const pot = value.kpPot;
    if (!isRecord(pot) || Object.keys(pot).length !== 2 || typeof pot.amountMinor !== 'number'
      || !Number.isSafeInteger(pot.amountMinor) || pot.amountMinor < 0
      || !purseCurrencies.some((currency) => currency === pot.currency)) return false;
  }
  if (isRecord(value) && value.churchyEnabled !== undefined && typeof value.churchyEnabled !== 'boolean') return false;
  if (isRecord(value) && value.teeStrokeAllocation !== undefined && typeof value.teeStrokeAllocation !== 'boolean') return false;
  if (isRecord(value) && value.inputRevision !== undefined && !isUuid(value.inputRevision)) return false;
  if (isRecord(value) && value.reviewWarnings !== undefined && !isReviewWarnings(value.reviewWarnings)) return false;
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
  if (!value.layout.every((hole: unknown): hole is CourseHole => isRecord(hole) && positiveInteger(hole.number, 18)
    && positiveInteger(hole.sourceId) && positiveInteger(hole.length, 2_000)
    && positiveInteger(hole.par, 10) && positiveInteger(hole.allocation, count))) return false;
  if (new Set(value.layout.map((hole: { readonly number: number }) => hole.number)).size !== count) return false;
  if (new Set(value.layout.map((hole: { readonly sourceId: number }) => hole.sourceId)).size !== count
    || new Set(value.layout.map((hole: { readonly allocation: number }) => hole.allocation)).size !== count) return false;
  const cards: Scorecard[] = value.cards;
  const cardsById = new Map(cards.map((card) => [card.playerId, card]));
  const layout = value.layout;
  if (count === 9 && !layout.every((hole) => hole.number <= 9) && !layout.every((hole) => hole.number >= 10)) return false;
  const persisted = cards.some((card) => card.etag !== null);
  if (value.setupLocked !== persisted || (persisted ? value.lastUpdatedAt === null : value.lastUpdatedAt !== null)) return false;
  const ids = cards.map((card) => card.playerId);
  const roster = new Set(ids);
  if (new Set(ids).size !== ids.length || cards.some((card) => card.holes.length !== count)) return false;
  if (value.roundDifferentials !== undefined) {
    if (count !== 18 || !isRoundDifferentials(value.roundDifferentials, ids)) return false;
    for (const result of value.roundDifferentials) {
      const card = cardsById.get(result.playerId);
      if (!card) return false;
      if (result.status === 'available') {
        if (card.holes.some((hole) => hole.score.kind !== 'strokes')) return false;
        const gross = card.holes.reduce((total, hole) =>
          total + BigInt(hole.score.kind === 'strokes' ? hole.score.strokes : 0), 0n);
        if (BigInt(result.adjustedGross) > gross) return false;
      } else if (result.status === 'pending'
        && (!card.holes.some((hole) => hole.score.kind === 'unplayed')
          || card.holes.some((hole) => hole.score.kind === 'picked-up' || hole.score.kind === 'did-not-finish'))) return false;
      else if (result.status === 'unavailable' && result.reason === 'non-numeric-score'
        && !card.holes.some((hole) => hole.score.kind === 'picked-up' || hole.score.kind === 'did-not-finish')) return false;
    }
  }
  if (value.permissions !== undefined) {
    const permission = value.permissions;
    if (!isRecord(permission) || typeof permission.role !== 'string'
      || !['owner', 'player', 'viewer', 'tester', 'public'].includes(permission.role)
      || !Object.keys(permission).every((key) => ['role', 'viewerPlayerId', 'writePlayerIds', 'canManageGames', 'canManageInternalGames'].includes(key))
      || !Array.isArray(permission.writePlayerIds) || !permission.writePlayerIds.every((id: unknown) => isUuid(id) && roster.has(id))
      || new Set(permission.writePlayerIds).size !== permission.writePlayerIds.length
      || typeof permission.canManageGames !== 'boolean'
      || permission.canManageInternalGames !== undefined && (typeof permission.canManageInternalGames !== 'boolean'
        || permission.canManageInternalGames && (value.eventStatus !== 'active' || value.internalGamesSupported !== true
          || permission.role !== 'owner' && permission.role !== 'public'))) return false;
    if (permission.role === 'owner') {
      if (permission.viewerPlayerId !== undefined || permission.canManageGames !== (value.eventStatus === 'active')
        || permission.writePlayerIds.length !== (value.eventStatus === 'active' ? cards.length : 0)) return false;
    } else if (permission.role === 'tester' || permission.role === 'public') {
      if (value.eventStatus !== 'active' || permission.viewerPlayerId !== undefined
        || permission.canManageGames && !(permission.role === 'public' && value.quickRound === true)
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
        if (typeof player.unavailableReason !== 'string'
          || !['missing-handicap-index', 'invalid-handicap-index', 'missing-tee-ratings', 'missing-stroke-index'].includes(player.unavailableReason)) return false;
      } else if (typeof player.playingHandicap !== 'number' || !Number.isSafeInteger(player.playingHandicap)
        || player.unavailableReason !== undefined) return false;
      seen.add(player.playerId);
    }
  }
  let courseHandicaps: readonly PlayerCourseHandicap[] | undefined;
  if (value.courseHandicaps !== undefined) {
    if (!Array.isArray(value.courseHandicaps) || value.courseHandicaps.length !== cards.length
      || !value.courseHandicaps.every(isCourseHandicap)) return false;
    courseHandicaps = value.courseHandicaps;
    const seen = new Set<string>();
    for (const player of value.courseHandicaps) {
      if (!isRecord(player) || !isUuid(player.playerId) || !roster.has(player.playerId) || seen.has(player.playerId)
        || !Object.keys(player).every((key) => ['playerId', 'courseHandicap', 'unavailableReason'].includes(key))) return false;
      if (player.courseHandicap === null) {
        if (typeof player.unavailableReason !== 'string'
          || !['missing-handicap-index', 'uncaptured-handicap-index', 'invalid-handicap-index', 'missing-tee-ratings'].includes(player.unavailableReason)) return false;
      } else if (typeof player.courseHandicap !== 'number' || !Number.isSafeInteger(player.courseHandicap)
        || player.unavailableReason !== undefined) return false;
      seen.add(player.playerId);
    }
  }
  if (value.playerTees !== undefined && !isPlayerTeeProfiles(value.playerTees, { holeCount: count, holes: layout }, ids)) return false;
  const playerLayouts = new Map(value.playerTees?.map((entry) => [entry.playerId, entry.profile.holes]));
  const playerAllocations = new Map(value.playerTees?.map((entry) => [entry.playerId, entry.profile.strokeAllocation]));
  const assigned: string[] = [];
  const groupNumbers = new Set<number>();
  const groups: RoundGroup[] = [];
  for (const group of value.groups) {
    if (!isRecord(group) || !positiveInteger(group.number, Number.MAX_SAFE_INTEGER) || !Array.isArray(group.playerIds)
      || group.startingHole !== undefined && (!positiveInteger(group.startingHole, 18)
        || !layout.some((hole) => hole.number === group.startingHole))
      || group.playerIds.length < 1 || group.playerIds.length > 4) return false;
    const players: unknown[] = group.playerIds;
    if (!players.every((id): id is string => isUuid(id) && roster.has(id))) return false;
    assigned.push(...players);
    groupNumbers.add(group.number);
    groups.push({ number: group.number, playerIds: players,
      ...(typeof group.startingHole === 'number' ? { startingHole: group.startingHole } : {}) });
  }
  if (groupNumbers.size !== value.groups.length || assigned.length !== ids.length || new Set(assigned).size !== ids.length) return false;
  if (value.games === undefined && cards.some((card) => card.holes.some((hole) =>
    hole.score.churchy?.version === 2 || hole.score.churchy?.version === 3))) return false;
  if (value.games !== undefined) {
    const context: RoundGameScoringContext = { roundId: value.roundId, groups, layout, cards,
      stringRulesVersion: value.stringRulesVersion === 2 ? 2 : 1,
      dotsCategorySweepsVersion: value.dotsCategorySweepsVersion === 1 ? 1 : 0,
      ...(value.playerTees ? { playerTees: value.playerTees } : {}), ...(courseHandicaps ? { courseHandicaps } : {}),
      ...(typeof value.teeStrokeAllocation === 'boolean' ? { teeStrokeAllocation: value.teeStrokeAllocation } : {}),
      ...(isRecord(value.gameInputContext) && typeof value.gameInputContext.courseVersionId === 'string'
        && typeof value.gameInputContext.teeProfileId === 'number'
        ? { gameInputContext: { courseVersionId: value.gameInputContext.courseVersionId, teeProfileId: value.gameInputContext.teeProfileId } } : {}),
      ...(typeof value.inputRevision === 'string' ? { inputRevision: value.inputRevision } : {}) };
    if (lean) {
      const games = restoreLeanRoundGames(value.games, context);
      if (games === null) return false;
      // Only decodeRoundScores passes lean=true, with a fresh enclosing object.
      value.games = games;
    }
    if (!isRoundGamesView(value.games, context) || value.games.configuration.eventId !== value.eventId
      || value.games.configuration.roundId !== value.roundId
      || value.games.results.some((result) => (!['churchy', 'wolf', 'nassau', 'match-play', 'dots'].includes(result.kind ?? '') && result.players.length !== cards.length) || result.players.some((player) => {
        const card = cardsById.get(player.playerId);
        if (!card && result.kind === 'churchy') return false;
        return !card || card.displayName !== player.displayName || player.totalHoles !== count
          || !player.holes.every((hole) => card.holes.some((entry) => entry.number === hole.number));
      }))) return false;
    if (value.churchyCustomNames !== true && value.games.configuration.games.some(hasCustomChurchyName)) return false;
    if (value.games.configuration.games.some((game) => game.kind === 'dots' && game.sweepRule !== undefined
      || game.kind === 'wolf' && game.highLowSweep !== undefined) && value.sweepRulesVersion !== 2) return false;
    for (const card of cards) {
      for (const hole of card.holes) {
        const extras = hole.score.churchy;
        if (!extras) continue;
        const game = value.games.configuration.games.find((entry) => entry.id === extras.gameId);
        if (extras.version !== 2 && extras.version !== 3
          && !(game?.kind === 'churchy' && game.version !== 1)) continue;
        if (game?.kind !== 'churchy' || !churchySpecialsMatchGame(extras, game)
          || !game.playerIds.includes(card.playerId)
          || extras.version === 3 && (game.version !== 3 || extras.number !== hole.number
            || groups.find((group) => group.number === game.groupNumber)?.playerIds[0] !== card.playerId)
          || !groups.some((group) => group.number === game.groupNumber && group.playerIds.length === 4
            && group.playerIds.every((id) => game.playerIds.includes(id)))) return false;
      }
    }
    if (value.internalSettlements !== undefined && !sameJsonValue(value.internalSettlements,
      calculateInternalSettlements(value.games.configuration.games, value.games.results, context))) return false;
    for (const result of value.games.results) {
      const game = value.games.configuration.games.find((entry) => entry.id === result.gameId);
      if (!game) return false;
      if (game.kind === 'wolf' || game.kind === 'nassau' || game.kind === 'match-play' || game.kind === 'dots') continue;
      if (game.kind === 'churchy') {
        const group: unknown = value.groups.find((entry: unknown) => isRecord(entry) && entry.number === game.groupNumber);
        const expected = calculateChurchyResults(game, cards.map((card) => {
          const published = courseHandicaps?.find((entry) => entry.playerId === card.playerId);
          return { playerId: card.playerId, displayName: card.displayName, layout: playerLayouts.get(card.playerId) ?? layout,
            handicap: !(playerAllocations.get(card.playerId) ?? value.teeStrokeAllocation)
              ? 'missing-stroke-index' : published?.courseHandicap ?? 'missing-handicap-index' };
        }), cards, isRecord(group) && Array.isArray(group.playerIds) && group.playerIds.length === 4
          && group.playerIds.every((id: unknown) => typeof id === 'string' && game.playerIds.includes(id)), groups, layout, context.stringRulesVersion);
        if (!sameJsonValue(result, expected)) return false;
        continue;
      }
      if (!isStablefordGame(game)) {
        const expected = calculateStrokeGameResults(game, result.players.map((player) => {
          const published = courseHandicaps?.find((entry) => entry.playerId === player.playerId);
          return { playerId: player.playerId, displayName: player.displayName,
            layout: playerLayouts.get(player.playerId) ?? layout,
            handicap: game.basis === 'gross' ? null : player.unavailableReason === 'missing-stroke-index'
              ? 'missing-stroke-index' : published ? published.courseHandicap
                ?? (published.unavailableReason === 'uncaptured-handicap-index' ? 'missing-handicap-index' : published.unavailableReason)
                ?? 'missing-handicap-index' : player.playingHandicap ?? player.unavailableReason ?? 'missing-handicap-index' };
        }), cards);
        if (!sameJsonValue(result, expected)) return false;
        continue;
      }
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
  return value.games !== undefined || value.internalSettlements === undefined
    || Array.isArray(value.internalSettlements) && value.internalSettlements.length === 0;
}

export function isScoreChange(value: unknown): value is ScoreChange {
  return isRecord(value) && isUuid(value.id) && isUuid(value.eventId) && isUuid(value.roundId)
    && isUuid(value.playerId) && positiveInteger(value.holeNumber, 18)
    && isHoleScore(value.before) && isHoleScore(value.after)
    && (value.expectedEtag === null || isEventRevision(value.expectedEtag))
    && (value.expectedInputRevision === undefined || isUuid(value.expectedInputRevision))
    && (value.dotAwardAudit === undefined || Array.isArray(value.dotAwardAudit) && value.dotAwardAudit.every(isDotAwardAudit))
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
