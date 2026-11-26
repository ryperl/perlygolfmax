import type { TableClient, TransactionAction } from '@azure/data-tables';
import { linkedNinesGame, ninesDotsContexts } from '../../../src/domain/linked-dots.js';
import type { DotHoleContext } from '../../../src/domain/dot-context.js';
import { clientSupportsAllNinesRules, clientSupportsNines, requireNinesSupport } from '../nines-negotiation.js';
import type { PublicScoreIdentity } from '../../../src/domain/public-access.js';
import type { AccountIdentity } from '../../../src/domain/events.js';
import type { ScoreActor } from '../../../src/domain/test-access.js';
import type { EventWorkspace, RoundPlayerSnapshot, RoundSnapshot } from '../../../src/domain/setup.js';
import type { GameWriteResult, HoleScore, RoundScores, Scorecard, ScoreChange, ScoreHistoryPage, ScoreWriteResult } from '../../../src/domain/scoring.js';
import { createHash } from 'node:crypto';
import { retainMurphyTargets } from './murphy-write.js';
import type { GameChange, GameConfiguration, RoundGameDefinition, RoundGameResult } from '../../../src/domain/games.js';
import type { DotsGameDefinition } from '../../../src/domain/dots.js';
import { gameTeamsMatchRoster, isStablefordGame, sameGameDefinitions, roundGameKinds } from '../../../src/domain/games.js';
import { maximumPrivateWriteBytes } from '../../../src/contracts/private-values.js';
import { calculateGameResults } from '../../../src/domain/stableford.js';
import { isGameChange, isRoundGameDefinitions } from '../../../src/contracts/games.js';
import { isEventRevision, isRecord, isUuid } from '../../../src/contracts/events.js';
import { isHoleScore, isScorecard, isScoreChange } from '../../../src/contracts/scoring.js';
import { preserveScoreExtras, sameHoleScore, sameScoreActor, scoreActor } from '../../../src/domain/scoring.js';
import { canonical, decode, isConflict, optionalRow, page, revision } from '../catalog/entities.js';
import { ApiError } from '../errors.js';
import type { TableWorkspaceStore } from '../setup/store.js';
import { scoringLock } from './lock.js';
import { calculateEventSkins, calculateEventSkinsDetails } from '../../../src/domain/event-skins.js';
import type { EventSkinsConfiguration } from '../../../src/domain/event-skins.js';
import type { ScoringLock, StoredScoringLock } from './lock.js';
import { configuredGameRounds, gameChangeKey, gameConfigurationContent, gameConfigurationKey, readGameConfiguration } from './games.js';
import type { EventLeaderboardView } from '../../../src/domain/event-leaderboard.js';
import { calculateEventStandings } from '../../../src/domain/event-leaderboard.js';
import { privateContent, stagePrivateContent } from '../private-values.js';
import { receivePrivateWrite } from '../private-transport.js';
import { assertEventAccessUnchanged, readEventAccess } from '../event-access.js';
import type { EventAccess } from '../event-access.js';
import { publishedCourseHandicaps, publishedPlayingHandicaps } from '../../../src/domain/playing-handicaps.js';
import { activeTesterLink, testerLinkKey } from '../test-access/authority.js';
import { churchySpecialsMatchGame, sameChurchySpecials, churchyV3Records, churchyV3RecordsMatchGame } from '../../../src/domain/churchy.js';
import type { KpSelection, KpWriteResult } from '../../../src/domain/kp.js';
import { calculateKp, calculateKpPayout, kpContext, sameKpEntry } from '../../../src/domain/kp.js';
import { isKpSelection } from '../../../src/contracts/kp.js';
import { configuredKpRounds, readKpPot } from './kp.js';
import { GameDeclarationConflictError, dotsRecordsFor, gameAnchorPlayerId, nassauRecordsFor, sameDotsRecords, sameNassauRecords, sameWolfRecords, scoreMatchesIntent } from '../../../src/domain/game-declarations.js';
import { nassauConfigurationIssues, validateNassauManualPress } from '../../../src/domain/nassau.js';
import { nassauRecordsMatchGame } from '../../../src/contracts/nassau.js';
import { wolfForHole, wolfGroupMatchesRound, wolfOrder } from '../../../src/domain/wolf.js';
import { ninesGroupMatches } from '../../../src/domain/nines.js';
import { requireWolfOrders, requireWolfOrdersInValue } from '../../../src/contracts/wolf-orders.js';
import { requireDotsHighLow, requireDotsHighLowInValue } from '../../../src/contracts/dots-high-low-rules.js';
import { requireDotsRulesV3, requireDotsRulesV3InValue } from '../../../src/contracts/dots-rules-v3.js';
import { dotsDefinitionMatchesRound, dotsRecordsMatchGame } from '../../../src/contracts/dots.js';
import { dotsAutomaticWriteConflicts, dotsCoexistenceWriteConflicts, dotsDeclarationIssues, dotsDeclarationWriteIssues, dotsFirstPlayedHole, dotsSpecialCatalog } from '../../../src/domain/dots.js';
import { DotsCoexistenceClientUpdateRequired } from '../../../src/contracts/dot-coexistence.js';
import { dotRound, definitionCards, validateInternalGameChanges } from './internal-games.js';
import { buildDotAwardAudit } from './dot-audit.js';
import { requireStringRules } from './string-rules.js';
import { requireCategorySweeps } from './category-sweeps.js';
import { hasCategorySweeps } from '../../../src/contracts/category-sweeps.js';
import { hasCustomChurchyName, requireChurchyNames } from '../../../src/contracts/churchy-names.js';
import { hasIndependentSweep, requireSweepRules, requireSweepRulesInValue } from '../../../src/contracts/sweep-rules.js';
import { GameHandicapClientUpdateRequired, requireGameHandicapRules, requireGameHandicapRulesInValue } from '../../../src/contracts/game-handicaps.js';
import { requireGameCalculations } from '../../../src/contracts/game-calculations.js';
import { requirePullyMurphyTargets } from '../../../src/contracts/pully-murphy.js';
import { skinsCarryCircuit } from '../../../src/domain/round-navigation.js';
import { changesSkinsCarryRules } from '../../../src/domain/games.js';
import { DotsCallsClientUpdateRequired, murphyRoundScores, requireLegacyDotsCalls } from '../../../src/domain/murphy-transport.js';
import { groupStartingHole } from '../../../src/domain/round-navigation.js';
import { calculateInternalSettlements } from '../../../src/domain/internal-games.js';
import { calculateRoundDifferentials } from '../../../src/domain/round-differential.js';

function withoutMatchDeclarations(score: HoleScore): HoleScore {
  const raw: HoleScore = score.kind === 'strokes' ? { kind: score.kind, strokes: score.strokes }
    : score.kind === 'picked-up' ? { kind: score.kind, ...(score.reportedStrokes !== undefined ? { reportedStrokes: score.reportedStrokes } : {}) }
      : { kind: score.kind };
  return { ...raw, ...(score.churchy && !('version' in score.churchy) ? { churchy: score.churchy } : {}),
    ...(score.kp !== undefined ? { kp: score.kp } : {}) };
}

function matchesScoreIntent(saved: HoleScore, intent: HoleScore): boolean {
  if (!scoreMatchesIntent(saved, intent)) return false;
  return sameHoleScore(saved, preserveScoreExtras(intent, saved));
}

function cardKey(roundId: string, playerId: string): string {
  return `score-card:${roundId}:${playerId}`;
}
function roundKpContext(round: RoundSnapshot): string {
  return kpContext(round.teeProfile.holes, round.players.map((player) => player.playerId),
    kpCaptureIdentity(round));
}
function hasDotsCallPolicy(cards: readonly Scorecard[]): boolean {
  return cards.some((card) => card.holes.some((hole) => hole.score.dots?.some((record) =>
    record.players.some((player) => player.calls.some((call) =>
      call.murphyTarget !== undefined || call.pareeTarget !== undefined || call.murphyPresses !== undefined)))));
}
const kpCaptureIdentity = (round: RoundSnapshot) => `${round.id}:${round.courseId}:${round.courseVersionId}:${String(round.teeProfile.id)}`;

type StoredCard = Omit<Scorecard, 'etag'>;

function isStoredCard(value: unknown): value is StoredCard {
  return isRecord(value) && !('etag' in value) && isScorecard({ ...value, etag: 'validation-only' });
}

function projectChange(change: ScoreChange, includeAudit = true): ScoreChange {
  return {
    id: change.id, eventId: change.eventId, roundId: change.roundId, playerId: change.playerId,
    holeNumber: change.holeNumber, before: change.before, after: change.after, expectedEtag: change.expectedEtag,
    recordedAt: change.recordedAt, ...(change.expectedInputRevision ? { expectedInputRevision: change.expectedInputRevision } : {}),
    ...(includeAudit && change.dotAwardAudit ? { dotAwardAudit: change.dotAwardAudit } : {}),
    recordedBy: scoreActor(change.recordedBy),
  };
}

/**
 * The sides a linked Dots declaration is checked against: Wolf's saved pairs (unchanged), or, for
 * Nines, every golfer alone. Unlinked Dots needs none.
 */
function linkedDotsWriteContexts(game: DotsGameDefinition, games: readonly RoundGameDefinition[],
  results: readonly RoundGameResult[], round: RoundSnapshot): readonly DotHoleContext[] {
  if (game.mode !== 'linked') return [];
  const nines = linkedNinesGame(game, games, round.groups);
  if (nines) return ninesDotsContexts(nines, round.teeProfile.holes.map((hole) => hole.number));
  return results.find((result) => result.gameId === game.linkedGameId)?.wolf?.contexts ?? [];
}

export class TableScoreStore {
  constructor(private readonly table: TableClient, private readonly workspace: TableWorkspaceStore,
    private readonly churchyEnabled: () => boolean = () => true) {}

  private async requireDotsCalls(eventId: string, state: Awaited<ReturnType<TableScoreStore['snapshot']>>, supported: boolean): Promise<void> {
    if (supported || state.testerLink || !state.games?.games.some((game) => game.kind === 'dots')) return;
    const cards = await this.cards(eventId, state.round, state.lock);
    if (!hasDotsCallPolicy(cards)) return;
    requireLegacyDotsCalls(cards.flatMap((card) => card.holes.map((hole) => hole.score)));
    murphyRoundScores(await this.projection(state.workspace, state.round, cards, state, state.games), true, true, false);
  }

private async kpProjection(eventId: string, roundId: string, configured: unknown) {
  const row = await optionalRow(this.table, eventId, `round-kp:${roundId}`);
  if (Boolean(row) !== configuredKpRounds(configured).includes(roundId)) throw new ApiError(503, 'INVALID_STORED_KP');
  return row ? { kp: { ...decode(await privateContent(this.table, eventId, `round-kp:${roundId}`, row.content), isKpSelection), etag: revision(row) } } : {};
}

async receiveKp(identity: AccountIdentity, eventId: string, roundId: string, body: unknown, expected: string | null, requestId: string, stringRules = true, dotsCalls = true, categorySweeps = true, churchyNames = true, sweepRules = true, gameHandicaps = true, gameCalculations = true, wolfOrders = true, dotsHighLow = true, dotsRulesV3 = true) {
  await this.requireCalculationWriter(identity, eventId, roundId, gameCalculations);
  const state = await this.snapshot(identity, eventId, roundId, true);
  requireWolfOrders(state.games?.games ?? [], wolfOrders);
  requireWolfOrdersInValue(body, wolfOrders);
  requireDotsRulesV3(state.games?.games ?? [], dotsRulesV3);
  requireNinesSupport(state.games?.games ?? []);
  requireDotsHighLow(state.games?.games ?? [], dotsHighLow);
  requireDotsRulesV3InValue(body, dotsRulesV3);
  requireDotsHighLowInValue(body, dotsHighLow);
  if (state.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
  requireStringRules(state.games?.games ?? [], stringRules);
  requireCategorySweeps(state.games?.games ?? [], categorySweeps);
  requireChurchyNames(state.games?.games ?? [], churchyNames);
  requireSweepRules(state.games?.games ?? [], sweepRules);
  requireGameHandicapRules(state.games?.games ?? [], gameHandicaps);
  await this.requireDotsCalls(eventId, state, dotsCalls);
  return receivePrivateWrite(this.table, identity, eventId, `round-kp:${roundId}`, expected, requestId, body);
}

async saveKp(identity: AccountIdentity, eventId: string, roundId: string, selection: KpSelection,
  expectedEtag: string | null, requestId: string, stringRules = true, dotsCalls = true, categorySweeps = true, churchyNames = true, sweepRules = true, gameHandicaps = true, gameCalculations = true, wolfOrders = true, dotsHighLow = true, dotsRulesV3 = true): Promise<KpWriteResult> {
  await this.requireCalculationWriter(identity, eventId, roundId, gameCalculations);
  if (!isUuid(requestId) || !isKpSelection(selection)
    || expectedEtag !== null && !isEventRevision(expectedEtag)) throw new ApiError(400, 'INVALID_KP_SETUP');
  const state = await this.snapshot(identity, eventId, roundId, true);
  requireWolfOrders(state.games?.games ?? [], wolfOrders);
  requireDotsRulesV3(state.games?.games ?? [], dotsRulesV3);
  requireNinesSupport(state.games?.games ?? []);
  requireDotsHighLow(state.games?.games ?? [], dotsHighLow);
  requireStringRules(state.games?.games ?? [], stringRules);
  requireCategorySweeps(state.games?.games ?? [], categorySweeps);
  requireChurchyNames(state.games?.games ?? [], churchyNames);
  requireSweepRules(state.games?.games ?? [], sweepRules);
  requireGameHandicapRules(state.games?.games ?? [], gameHandicaps);
  await this.requireDotsCalls(eventId, state, dotsCalls);
  const grant = this.writer(state);
  if (state.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
  const receiptKey = `kp-change:${requestId}`;
  const actor = { tenantId: identity.tenantId, objectId: identity.objectId };
  const request = canonical({ roundId, selection, expectedEtag, actor });
  const replay = async () => {
    const receipt = await optionalRow(this.table, eventId, receiptKey);
    if (!receipt) return undefined;
    const stored = decode(await privateContent(this.table, eventId, receiptKey, receipt.content), isRecord);
    if (stored.request !== request) throw new ApiError(409, 'KP_REQUEST_CONFLICT');
    return { round: await this.get(identity, eventId, roundId), requestId, expectedEtag, selection };
  };
  const previous = await replay();
  if (previous) return previous;
  const row = await optionalRow(this.table, eventId, `round-kp:${roundId}`);
  const configuredRounds = configuredKpRounds(state.event.kpRoundIds);
  if (Boolean(row) !== configuredRounds.includes(roundId)) throw new ApiError(503, 'INVALID_STORED_KP');
  const before = row ? decode(await privateContent(this.table, eventId, `round-kp:${roundId}`, row.content), isKpSelection) : null;
  if ((row ? revision(row) : null) !== expectedEtag) throw new ApiError(409, 'KP_CHANGED');
  if (!state.round.teeProfile.holes.some((hole) => hole.par === 3)
    || selection.context !== roundKpContext(state.round)) {
    throw new ApiError(409, 'KP_CONTEXT_CHANGED');
  }
  // Never rebind measurements to a changed saved layout/roster.
  if (before && before.context !== selection.context) throw new ApiError(409, 'KP_CONTEXT_CHANGED');
  const cards = await this.cards(eventId, state.round, state.lock);
  const result = calculateKp({ layout: state.round.teeProfile.holes, cards, kpCaptureIdentity: kpCaptureIdentity(state.round), kp: { ...selection, etag: 'validation' } });
  const pot = await readKpPot(this.table, eventId, roundId, state.event.purseConfigured);
  const payout = pot ? calculateKpPayout({ layout: state.round.teeProfile.holes, cards, kpCaptureIdentity: kpCaptureIdentity(state.round),
    kp: { ...selection, status: 'closed', etag: 'validation' } }, pot.amountMinor) : null;
  if (selection.decisions.some((decision) => {
    const hole = result.holes.find((entry) => entry.number === decision.holeNumber);
    return !hole || hole.closestPlayerIds.length < 2 || hole.proof !== decision.proof
      || decision.holeAmountMinor !== payout?.holes.find((entry) => entry.number === hole.number)?.amountMinor
      || decision.playerIds.some((id) => !hole.closestPlayerIds.includes(id))
      || decision.kind === 'split' && decision.playerIds.length !== hole.closestPlayerIds.length
      || decision.kind === 'winner' && decision.extraCentPlayerIds.length > 0
      || decision.extraCentPlayerIds.some((id) => !decision.playerIds.includes(id))
      || decision.extraCentPlayerIds.length !== decision.holeAmountMinor % decision.playerIds.length;
  })) throw new ApiError(409, 'KP_DECISION_CHANGED');
  const entity = { partitionKey: eventId, rowKey: `round-kp:${roundId}`,
    content: await stagePrivateContent(this.table, eventId, `round-kp:${roundId}`, identity, canonical(selection)) };
  const recordedAt = new Date().toISOString();
  const receiptContent = await stagePrivateContent(this.table, eventId, receiptKey, identity,
    canonical({ request, before, after: selection, recordedAt, recordedBy: actor, requestId }));
  try {
    await this.table.submitTransaction([
      ['update', { partitionKey: eventId, rowKey: 'event', kpUpdatedAt: recordedAt,
        kpRoundIds: canonical(configuredRounds.includes(roundId) ? configuredRounds : [...configuredRounds, roundId]) }, 'Merge', { etag: state.summary.etag }],
      ['update', { partitionKey: eventId, rowKey: `member:${identity.objectId}`, ...actor, role: 'owner' }, 'Merge', { etag: grant.etag }],
      row ? ['update', entity, 'Replace', { etag: revision(row) }] : ['create', entity],
      ['create', { partitionKey: eventId, rowKey: receiptKey, content: receiptContent }],
    ]);
  } catch (error) {
    const committed = await replay();
    if (committed) return committed;
    if (isConflict(error)) throw new ApiError(409, 'KP_CHANGED');
    throw error;
  }
  return { round: await this.get(identity, eventId, roundId), requestId, expectedEtag, selection };
}

  private async access(identity: ScoreActor, eventId: string, ownerOnly = false) {
    if (!isUuid(eventId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
    const access = await readEventAccess(this.table, identity, eventId);
    if (access.summary.role !== 'owner' && (ownerOnly || !access.admittedPlayer && !access.testerLink && !access.publicAccess)) throw new ApiError(403, 'SCORES_OWNER_REQUIRED');
    return { ...access, gameRoundIds: configuredGameRounds(access.event.gameRoundIds) };
  }

  private async snapshot(identity: ScoreActor, eventId: string, roundId: string, ownerOnly = false) {
    if (!isUuid(roundId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
    const access = await this.access(identity, eventId, ownerOnly);
    const workspace = await this.workspace.getForScoring(identity, eventId);
    if (access.summary.etag !== workspace.etag) throw new ApiError(409, 'EVENT_CHANGED');
    const round = workspace.rounds.find((entry) => entry.id === roundId);
    if (!round) throw new ApiError(404, 'ROUND_NOT_FOUND');
    if (access.gameRoundIds.some((id) => !workspace.rounds.some((entry) => entry.id === id))) throw new ApiError(503, 'INVALID_STORED_GAMES');
    if (configuredKpRounds(access.event.kpRoundIds).some((id) => !workspace.rounds.some((entry) => entry.id === id))) throw new ApiError(503, 'INVALID_STORED_KP');
    const lock = await scoringLock(this.table, eventId, roundId);
    if ((round.scoringStarted === true) !== (lock !== undefined)) throw new ApiError(409, 'EVENT_CHANGED');
    const games = await readGameConfiguration(this.table, eventId, roundId, access.gameRoundIds);
    return { ...access, workspace, round, lock, games };
  }

  private async unchanged(identity: ScoreActor, eventId: string, before: EventAccess): Promise<void> {
    await assertEventAccessUnchanged(this.table, identity, eventId, before);
  }

  private async requireCalculationWriter(identity: ScoreActor, eventId: string, roundId: string,
    supported: boolean, games?: readonly RoundGameDefinition[]): Promise<void> {
    if (supported) return;
    const round = await this.get(identity, eventId, roundId);
    requireGameCalculations(round, false, games, true);
  }

  private writer(state: EventAccess & { readonly round: RoundSnapshot }, playerId?: string, manageGames = false,
    validatedInternalGames = false) {
    if (state.publicAccess) {
      if (!playerId && !(manageGames && (state.event.quickRound === true || validatedInternalGames))) throw new ApiError(403, 'SCORES_OWNER_REQUIRED');
      return { etag: state.summary.etag, role: 'public' as const };
    }
    if (state.testerLink) {
      if (!playerId) throw new ApiError(403, 'SCORES_OWNER_REQUIRED');
      return { etag: revision(state.testerLink), role: 'tester' as const };
    }
    if (state.summary.role !== 'owner') {
      const group = state.round.groups.find((entry) => state.viewerPlayerId && entry.playerIds.includes(state.viewerPlayerId));
      if (!playerId || !state.viewerPlayerId || state.summary.role !== 'member' || !group?.playerIds.includes(playerId)) {
        throw new ApiError(403, 'GROUP_SCORE_PERMISSION_REQUIRED');
      }
    }
    if (!state.member || !state.memberEtag || (state.member.role !== 'owner' && state.member.role !== 'member')) {
      throw new ApiError(503, 'INVALID_SCORING_GRANT');
    }
    return { etag: state.memberEtag, role: state.summary.role };
  }

  private async card(eventId: string, round: RoundSnapshot, player: RoundPlayerSnapshot, writtenIds: ReadonlySet<string>): Promise<Scorecard> {
    const playerId = player.playerId;
    const row = await optionalRow(this.table, eventId, cardKey(round.id, playerId));
    const written = writtenIds.has(playerId);
    if (!row && written || row && !written) throw new ApiError(503, 'INVALID_STORED_SCORECARD');
    if (!row) return {
      playerId, displayName: player.displayName, etag: null, updatedAt: null,
      holes: round.teeProfile.holes.map((hole) => ({ number: hole.number, score: { kind: 'unplayed' } })),
    };
    const stored = decode(await privateContent(this.table, eventId, cardKey(round.id, playerId), row.content), isStoredCard);
    const card: Scorecard = {
      playerId: stored.playerId, displayName: stored.displayName, etag: revision(row), updatedAt: stored.updatedAt,
      holes: stored.holes.map((hole) => ({ number: hole.number, score: hole.score })),
    };
    if (!round.scoringStarted || card.playerId !== playerId || card.displayName !== player.displayName
      || card.holes.length !== round.teeProfile.holes.length
      || !round.teeProfile.holes.every((hole) => card.holes.some((entry) => entry.number === hole.number))) {
      throw new ApiError(503, 'INVALID_STORED_SCORECARD');
    }
    return card;
  }

  private async projection(capturedWorkspace: EventWorkspace, capturedRound: RoundSnapshot, capturedCards: readonly Scorecard[], access: EventAccess, games?: GameConfiguration): Promise<RoundScores> {
    const workspace = await this.workspace.forDisplay(capturedWorkspace);
    const round = workspace.rounds.find((item) => item.id === capturedRound.id);
    if (!round) throw new ApiError(503, 'INVALID_STORED_WORKSPACE');
    const names = new Map(round.players.map((player) => [player.playerId, player.displayName]));
    const cards = capturedCards.map((card) => {
      const displayName = names.get(card.playerId);
      if (displayName === undefined) throw new ApiError(503, 'INVALID_STORED_SCORECARD');
      return { ...card, displayName, ...(access.testerLink
        ? { holes: card.holes.map((hole) => ({ ...hole, score: withoutMatchDeclarations(hole.score) })) } : {}) };
    });
    const timestamps = cards.flatMap((card) => card.updatedAt === null ? [] : [card.updatedAt]).sort();
    const owner = access.summary.role === 'owner';
    const viewerPlayerId = round.players.some((player) => player.playerId === access.viewerPlayerId) ? access.viewerPlayerId : undefined;
    const ownGroup = round.groups.find((group) => viewerPlayerId && group.playerIds.includes(viewerPlayerId));
    const active = workspace.event.status === 'active';
    const competition = workspace.overallCompetition;
    const kpProjection = await this.kpProjection(workspace.event.id, round.id, access.event.kpRoundIds);
    const kpPot = access.testerLink || !kpProjection.kp ? undefined : await readKpPot(this.table, workspace.event.id, round.id, access.event.purseConfigured);
    const visibleGames = access.testerLink && games ? games.games.filter((game) =>
      game.kind !== 'wolf' && game.kind !== 'nassau' && game.kind !== 'match-play' && game.kind !== 'dots'
      && game.kind !== 'nines' && !(game.kind === 'churchy' && game.version !== 1)) : games?.games;
    const projection: RoundScores = {
      gameHandicapRules: 1,
      gameCalculationsVersion: 2,
      ...(!access.testerLink ? { dotsCoexistenceRulesVersion: 2 as const } : {}),
      ...(visibleGames?.some(hasCustomChurchyName) ? { churchyCustomNames: true as const } : {}),
      ...(visibleGames?.some(hasIndependentSweep) ? { sweepRulesVersion: 2 as const } : {}),
      stringRulesVersion: 2,
      ...(hasCategorySweeps(visibleGames ?? []) ? { dotsCategorySweepsVersion: 1 as const } : {}),
      ...(access.event.quickRound === true ? { quickRound: true as const } : {}),
      kpEnabled: true,
      kpCaptureIdentity: kpCaptureIdentity(capturedRound),
      ...(access.testerLink && kpProjection.kp ? { kp: { ...kpProjection.kp, decisions: [] } } : kpProjection),
      ...(kpPot ? { kpPot } : {}),
      churchyEnabled: this.churchyEnabled(),
      ...(!access.testerLink && this.churchyEnabled() ? { churchyRulesVersions: [1, 2, 3] as const } : {}),
      ...(!access.testerLink ? { wolfRulesVersions: [1, 2] as const, dotsRulesVersions: [1, 2, 3] as const,
        wolfOrderVersion: 1 as const,
        dotsHighLowVersion: 2 as const,
        dotsIndividualPlayerCounts: [1, 2, 3, 4] as const,
        dotsManualSweep: true as const, wolfHighLowSweep: true as const, ninesLinkedDots: true as const,
        dotsSpecialKinds: dotsSpecialCatalog.map((entry) => entry.kind),
        internalGamesSupported: true, pullyMurphyTargets: true as const } : {}),
      supportedGameKinds: roundGameKinds.filter((kind) => (kind !== 'churchy' || this.churchyEnabled())
        && (kind !== 'nines' || clientSupportsNines() && !access.testerLink)
        && (!access.testerLink || kind !== 'wolf' && kind !== 'nassau' && kind !== 'match-play' && kind !== 'dots')),
      gameInputContext: { courseVersionId: capturedRound.courseVersionId, teeProfileId: capturedRound.teeProfile.id },
      teeStrokeAllocation: round.teeProfile.strokeAllocation,
      eventId: workspace.event.id, eventName: workspace.event.name, eventStatus: workspace.event.status,
      roundId: round.id, roundName: round.name, courseName: round.course.name,
      teeName: round.teeProfile.name, teeCategory: round.teeProfile.category, layout: round.teeProfile.holes,
      ...(round.playerTees?.length ? { playerTees: round.playerTees } : {}),
      teeRatings: round.teeProfile.ratings.map((rating) => ({
        type: rating.type, course: rating.course, slope: rating.slope, bogey: rating.bogey,
      })),
      groups: round.groups, cards, setupLocked: round.scoringStarted === true,
      ...(capturedRound.inputRevision ? { inputRevision: capturedRound.inputRevision } : {}),
      ...(capturedRound.reviewWarnings?.length ? { reviewWarnings: capturedRound.reviewWarnings } : {}),
      courseHandicaps: publishedCourseHandicaps(capturedRound),
      ...(!access.testerLink && capturedRound.teeProfile.holes.length === 18
        ? { roundDifferentials: calculateRoundDifferentials(capturedRound, capturedCards) } : {}),
      permissions: { role: access.publicAccess ? 'public' : access.testerLink ? 'tester' : owner ? 'owner' : viewerPlayerId ? 'player' : 'viewer',
        ...(viewerPlayerId ? { viewerPlayerId } : {}),
        writePlayerIds: !active ? [] : owner || access.testerLink || access.publicAccess ? round.players.map((player) => player.playerId) : ownGroup?.playerIds ?? [],
        canManageGames: active && (owner || access.publicAccess === true && access.event.quickRound === true),
        ...(!access.testerLink ? { canManageInternalGames: active && !round.scoringStarted && (owner || access.publicAccess === true) } : {}) },
      ...(competition?.kind === 'stroke-play' && competition.basis === 'net'
        ? { overallHandicaps: publishedPlayingHandicaps(round, competition.handicapAllowancePercent) } : {}),
      lastUpdatedAt: timestamps.at(-1) ?? null,
      ...(games && visibleGames ? { games: { configuration: { ...games, games: visibleGames,
        etag: visibleGames.length ? games.etag : null }, results: calculateGameResults(visibleGames, round, cards) } } : {}),
    };
    return visibleGames && projection.games && !access.testerLink
      ? { ...projection, internalSettlements: calculateInternalSettlements(visibleGames, projection.games.results, projection) }
      : projection;
  }

  private async cards(eventId: string, round: RoundSnapshot, lock: StoredScoringLock | undefined): Promise<readonly Scorecard[]> {
    const cards: Scorecard[] = [];
    const written = new Set(lock?.writtenPlayerIds);
    for (let index = 0; index < round.players.length; index += 16) {
      cards.push(...await Promise.all(round.players.slice(index, index + 16).map((player) => this.card(eventId, round, player, written))));
    }
    return cards;
  }

  async get(identity: ScoreActor, eventId: string, roundId: string): Promise<RoundScores> {
    const state = await this.snapshot(identity, eventId, roundId);
    const cards = await this.cards(eventId, state.round, state.lock);
    const projection = await this.projection(state.workspace, state.round, cards, state, state.games);
    await this.unchanged(identity, eventId, state);
    return projection;
  }

  private async leaderboardSources(identity: ScoreActor, eventId: string, chargeRead: (units: number) => Promise<void>,
    skinsOnly = false): Promise<Pick<EventLeaderboardView, 'workspace' | 'roundScores'>> {
    const access = await this.access(identity, eventId);
    if (access.testerLink) throw new ApiError(403, 'SCORES_OWNER_REQUIRED');
    const workspace = await this.workspace.get(identity, eventId);
    if (workspace.etag !== access.summary.etag) throw new ApiError(409, 'EVENT_CHANGED');
    const roundScores: RoundScores[] = [];
    if (workspace.eventSkins || !skinsOnly && workspace.overallCompetition) {
      if (workspace.rounds.length > 0) await chargeRead(workspace.rounds.length);
      for (let index = 0; index < workspace.rounds.length; index += 3) {
        const batch = await Promise.all(workspace.rounds.slice(index, index + 3).map((round) => this.get(identity, eventId, round.id)));
        roundScores.push(...batch);
      }
    }
    await this.unchanged(identity, eventId, access);
    return { workspace, roundScores };
  }

  async skinsDetails(identity: ScoreActor, eventId: string, chargeRead: (units: number) => Promise<void>) {
    const { workspace, roundScores } = await this.leaderboardSources(identity, eventId, chargeRead, true);
    return calculateEventSkinsDetails(workspace, roundScores);
  }

  async leaderboard(identity: ScoreActor, eventId: string, chargeRead: (units: number) => Promise<void>): Promise<EventLeaderboardView> {
    const { workspace, roundScores } = await this.leaderboardSources(identity, eventId, chargeRead);
    return { workspace, roundScores, standings: calculateEventStandings(workspace, roundScores),
      ...(workspace.eventSkins ? { eventSkins: calculateEventSkins(workspace, roundScores) } : {}) };
  }

  async saveEventSkins(identity: AccountIdentity, eventId: string,
    selection: EventSkinsConfiguration | null, etag: string, requestId: string) {
    return this.workspace.saveEventSkins(identity, eventId, selection, etag, requestId);
  }

  private async gameReceipt(eventId: string, roundId: string, requestId: string): Promise<GameChange | undefined> {
    const row = await optionalRow(this.table, eventId, gameChangeKey(roundId, requestId));
    if (!row) return undefined;
    const change = decode(await privateContent(this.table, eventId, gameChangeKey(roundId, requestId), row.content), isGameChange);
    if (row.kind !== 'game-change' || row.roundId !== roundId || change.eventId !== eventId
      || change.roundId !== roundId || change.id !== requestId) throw new ApiError(503, 'INVALID_STORED_GAMES');
    return change;
  }

  private async gameAcknowledgement(identity: AccountIdentity | PublicScoreIdentity, change: GameChange): Promise<GameWriteResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        const round = await this.get(identity, change.eventId, change.roundId);
        if (!round.games) throw new ApiError(503, 'INVALID_STORED_GAMES');
        return { round, change };
      } catch (error) {
        if (attempt < 2 && error instanceof ApiError && error.code === 'EVENT_CHANGED') continue;
        throw error;
      }
    }
  }

  private async replayGames(identity: AccountIdentity | PublicScoreIdentity, eventId: string, roundId: string,
    games: readonly RoundGameDefinition[], expectedEtag: string | null, requestId: string): Promise<GameWriteResult | undefined> {
    const change = await this.gameReceipt(eventId, roundId, requestId);
    if (!change) return undefined;
    if (change.expectedEtag !== expectedEtag || !sameScoreActor(change.recordedBy, identity)
      || canonical(change.after) !== canonical(games)) {
      throw new ApiError(409, 'GAME_REQUEST_CONFLICT');
    }
    const result = await this.gameAcknowledgement(identity, change);
    if (result.round.eventStatus !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    return result;
  }

  async saveGames(identity: AccountIdentity | PublicScoreIdentity, eventId: string, roundId: string, games: readonly RoundGameDefinition[],
    expectedEtag: string | null, requestId: string, stringRules = true, dotsCalls = true, categorySweeps = true, churchyNames = true, sweepRules = true, gameHandicaps = true, gameCalculations = true, wolfOrders = true, dotsHighLow = true, dotsRulesV3 = true): Promise<GameWriteResult> {
    if (!isUuid(requestId) || !isRoundGameDefinitions(games) || games.length === 0
      || expectedEtag !== null && !isEventRevision(expectedEtag)) throw new ApiError(400, 'INVALID_GAME_SETUP');
    if (Buffer.byteLength(JSON.stringify({ games }), 'utf8') > maximumPrivateWriteBytes) {
      throw new ApiError(413, 'REQUEST_TOO_LARGE');
    }
    const state = await this.snapshot(identity, eventId, roundId);
    await this.requireCalculationWriter(identity, eventId, roundId, gameCalculations,
      [...state.games?.games ?? [], ...games]);
    requireStringRules([...state.games?.games ?? [], ...games], stringRules);
    requireWolfOrders([...state.games?.games ?? [], ...games], wolfOrders);
    requireDotsRulesV3([...state.games?.games ?? [], ...games], dotsRulesV3);
    requireNinesSupport([...state.games?.games ?? [], ...games]);
    requireDotsHighLow([...state.games?.games ?? [], ...games], dotsHighLow);
    requireCategorySweeps([...state.games?.games ?? [], ...games], categorySweeps);
    requireChurchyNames([...state.games?.games ?? [], ...games], churchyNames);
    requireSweepRules([...state.games?.games ?? [], ...games], sweepRules);
    requireGameHandicapRules([...state.games?.games ?? [], ...games], gameHandicaps);
    await this.requireDotsCalls(eventId, state, dotsCalls);
    if (state.summary.role !== 'owner' && !state.publicAccess) throw new ApiError(403, 'SCORES_OWNER_REQUIRED');
    if (state.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    const replay = await this.replayGames(identity, eventId, roundId, games, expectedEtag, requestId);
    if (replay) return replay;
    for (const game of games) {
      const previous = state.games?.games.find((entry) => entry.id === game.id);
      const rule = 'handicapRule' in game ? game.handicapRule : undefined;
      const previousRule = previous && 'handicapRule' in previous ? previous.handicapRule : undefined;
      const order = game.kind === 'skins' ? game.carryOrder : game.kind === 'nassau' ? game.playOrder : undefined;
      const previousOrder = previous?.kind === 'skins' ? previous.carryOrder : previous?.kind === 'nassau' ? previous.playOrder : undefined;
      if (state.round.scoringStarted && (rule !== previousRule || order !== previousOrder)) {
        throw new ApiError(409, 'GAME_HANDICAP_SETUP_LOCKED');
      }
      if (changesSkinsCarryRules(game, previous) && game.kind === 'skins'
        && game.carryOrder === undefined) throw new GameHandicapClientUpdateRequired();
      if (game.kind === 'skins' && game.carryovers && game.carryOrder === 'shared-group-v1'
        && !skinsCarryCircuit(state.round.teeProfile.holes.map((hole) => hole.number), state.round.groups,
          state.round.players.map((player) => player.playerId))) throw new ApiError(400, 'SKINS_FOURSOME_REQUIRED');
    }
    validateInternalGameChanges(state.games?.games ?? [], games, state.round,
      state.publicAccess === true && state.event.quickRound !== true);
    const grant = this.writer(state, undefined, true, true);
    // Money games lock once scoring starts, so stakes and opponents cannot change mid-round.
    const lockedKinds: readonly string[] = ['nassau', 'match-play', 'wolf', 'dots', 'nines'];
    const previousMatches = state.games?.games.filter((game) => lockedKinds.includes(game.kind ?? 'stableford')) ?? [];
    if (state.round.scoringStarted && (
      previousMatches.some((previous) => !games.some((game) => sameGameDefinitions([game], [previous])))
      || games.some((game) => lockedKinds.includes(game.kind ?? 'stableford')
        && !previousMatches.some((previous) => sameGameDefinitions([game], [previous]))))) {
      throw new ApiError(409, 'MATCH_SETUP_LOCKED');
    }
    for (const game of games) {
      const previous = state.games?.games.find((entry) => entry.id === game.id);
      if (previous && previous.kind !== game.kind && (previous.kind === 'match-play'
        || game.kind === 'match-play')) throw new ApiError(400, 'MATCH_KIND_FIXED');
      if (previous && sameGameDefinitions([game], [previous])) continue;
      if ((game.kind === 'nassau' || game.kind === 'match-play') && nassauConfigurationIssues(game, state.round).length) throw new ApiError(400, 'INVALID_NASSAU_GROUP');
      if (game.kind === 'wolf' && !wolfGroupMatchesRound(game, { layout: state.round.teeProfile.holes, groups: state.round.groups })) {
        throw new ApiError(400, 'INVALID_WOLF_GROUP');
      }
      if (game.kind === 'nines' && !ninesGroupMatches(game, state.round.groups)) throw new ApiError(400, 'INVALID_NINES_GROUP');
    }
    const savedChurchy = state.games?.games.filter((game) => game.kind === 'churchy') ?? [];
    const nextChurchy = games.filter((game) => game.kind === 'churchy');
    if (!this.churchyEnabled() && !sameGameDefinitions(savedChurchy, nextChurchy)) {
      throw new ApiError(403, 'CHURCHY_DISABLED');
    }
    for (const game of nextChurchy) {
      const previous = savedChurchy.find((entry) => entry.id === game.id);
      if (state.round.scoringStarted && (game.version === 3 || previous?.version === 3)
        && (!previous || !sameGameDefinitions([game], [previous]))) throw new ApiError(409, 'CHURCHY_SETUP_LOCKED');
      if (!previous && state.games?.games.some((saved) => saved.id === game.id)) {
        throw new ApiError(400, 'CHURCHY_REQUIRES_NEW_GAME');
      }
      const group = state.round.groups.find((entry) => entry.number === game.groupNumber);
      if (!group || group.playerIds.length !== 4 || !group.playerIds.every((id) => game.playerIds.includes(id))) {
        if (!previous || !sameGameDefinitions([game], [previous])) throw new ApiError(400, 'INVALID_CHURCHY_GROUP');
      }
      if (state.round.scoringStarted && previous
        && (previous.name !== game.name || previous.groupNumber !== game.groupNumber || previous.playerIds.some((id, index) => id !== game.playerIds[index])
          || previous.version === 2 && game.version === 2
            && canonical(previous.enabledSpecials) !== canonical(game.enabledSpecials))) {
        throw new ApiError(409, 'CHURCHY_SETUP_LOCKED');
      }
      if (state.round.scoringStarted && !previous && game.version !== 1) {
        throw new ApiError(409, 'CHURCHY_SETUP_LOCKED');
      }
    }
    if (savedChurchy.some((previous) => !games.some((game) => game.id === previous.id && game.kind === 'churchy'))) {
      throw new ApiError(409, 'CHURCHY_REMOVAL_NOT_SUPPORTED');
    }
    const competition = state.workspace.overallCompetition;
    if (competition?.kind === 'stableford' && competition.roundGames.some((binding) => binding.roundId === roundId
      && !games.some((game) => game.id === binding.gameId && isStablefordGame(game)))) {
      throw new ApiError(400, 'INVALID_OVERALL_GAME');
    }
    // Unchanged stale peers must survive while their assignments are repaired one game at a time.
    if (games.some((game) => {
      const previous = state.games?.games.find((saved) => saved.id === game.id);
      return !gameTeamsMatchRoster(game, state.round.players.map((player) => player.playerId))
        && (!previous || !sameGameDefinitions([game], [previous]));
    })) {
      throw new ApiError(400, 'INVALID_GAME_TEAMS');
    }
    const before = state.games;
    if ((before?.etag ?? null) !== expectedEtag) throw new ApiError(409, 'GAMES_CHANGED');
    if (before?.games.some((saved) => !games.some((game) => game.id === saved.id))) throw new ApiError(409, 'GAME_REMOVAL_NOT_SUPPORTED');
    const recordedAt = new Date().toISOString();
    const actor: GameChange['recordedBy'] = 'kind' in identity
      ? { kind: 'public-score', eventId: identity.eventId } : { tenantId: identity.tenantId, objectId: identity.objectId };
    const change: GameChange = {
      id: requestId, eventId, roundId, expectedEtag, before: before?.games ?? [], after: games,
      recordedAt, recordedBy: actor,
    };
    const configuredRounds = state.gameRoundIds.includes(roundId) ? state.gameRoundIds : [...state.gameRoundIds, roundId];
    const entity = {
      partitionKey: eventId, rowKey: gameConfigurationKey(roundId), kind: 'round-games', schemaVersion: 1,
      content: await stagePrivateContent(this.table, eventId, gameConfigurationKey(roundId), identity, canonical(gameConfigurationContent(eventId, roundId, games))),
    };
    const changeContent = await stagePrivateContent(this.table, eventId, gameChangeKey(roundId, requestId), identity, canonical(change));
    try {
      await this.table.submitTransaction([
        ['update', { partitionKey: eventId, rowKey: 'event', gameRoundIds: canonical(configuredRounds) }, 'Merge', { etag: state.summary.etag }],
        ...(!('kind' in identity) ? [[
          'update', { partitionKey: eventId, rowKey: `member:${identity.objectId}`, ...actor, role: 'owner' },
          'Merge', { etag: grant.etag },
        ] satisfies TransactionAction] : []),
        expectedEtag === null ? ['create', entity] : ['update', entity, 'Replace', { etag: expectedEtag }],
        ['create', { partitionKey: eventId, rowKey: gameChangeKey(roundId, requestId), kind: 'game-change', roundId, content: changeContent }],
      ]);
    } catch (error) {
      const committed = await this.replayGames(identity, eventId, roundId, games, expectedEtag, requestId);
      if (committed) return committed;
      if (isConflict(error)) throw new ApiError(409, 'GAMES_CHANGED');
      throw error;
    }
    return this.gameAcknowledgement(identity, change);
  }

  async receiveGames(identity: AccountIdentity | PublicScoreIdentity,
    eventId: string, roundId: string, body: unknown, expected: string | null, requestId: string, stringRules = true, dotsCalls = true, categorySweeps = true, churchyNames = true, sweepRules = true, gameHandicaps = true, gameCalculations = true, wolfOrders = true, dotsHighLow = true, dotsRulesV3 = true) {
    await this.requireCalculationWriter(identity, eventId, roundId, gameCalculations);
    if (!isUuid(roundId) || !isUuid(requestId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
    const state = await this.access(identity, eventId);
    if (state.summary.role !== 'owner' && !state.publicAccess) throw new ApiError(403, 'SCORES_OWNER_REQUIRED');
    if (state.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    if (!await optionalRow(this.table, eventId, `round:${roundId}`)) throw new ApiError(404, 'ROUND_NOT_FOUND');
    if (!dotsCalls) await this.requireDotsCalls(eventId, await this.snapshot(identity, eventId, roundId), false);
    if (state.publicAccess && state.event.quickRound !== true) {
      const current = await this.snapshot(identity, eventId, roundId);
      if (!current.round.groups.some((group) => group.playerIds.length >= 1 && group.playerIds.length <= 4)) {
        throw new ApiError(403, 'SCORES_OWNER_REQUIRED');
      }
    }
    // Parts are inactive. Check the head revision without repeatedly decoding a large configuration.
    // The final save validates the complete captured workspace and games again.
    const head = await optionalRow(this.table, eventId, gameConfigurationKey(roundId));
    // Today's live site sends every earlier flag, so clients that did not ask for Nines must enter this check too.
    if ((!stringRules || !categorySweeps || !churchyNames || !sweepRules || !gameHandicaps || !wolfOrders || !dotsHighLow || !dotsRulesV3
      || !clientSupportsAllNinesRules()) && head) {
      const current = await readGameConfiguration(this.table, eventId, roundId,
        configuredGameRounds(state.event.gameRoundIds), { row: head });
      requireStringRules(current?.games ?? [], stringRules);
      requireCategorySweeps(current?.games ?? [], categorySweeps);
      requireChurchyNames(current?.games ?? [], churchyNames);
      requireSweepRules(current?.games ?? [], sweepRules);
      requireGameHandicapRules(current?.games ?? [], gameHandicaps);
      requireWolfOrders(current?.games ?? [], wolfOrders);
      requireDotsRulesV3(current?.games ?? [], dotsRulesV3);
      requireNinesSupport(current?.games ?? []);
      requireDotsHighLow(current?.games ?? [], dotsHighLow);
    }
    if (isRecord(body) && isRoundGameDefinitions(body.games)) requireChurchyNames(body.games, churchyNames);
    if (!sweepRules) requireSweepRulesInValue(body);
    if (!gameHandicaps) requireGameHandicapRulesInValue(body);
    requireWolfOrdersInValue(body, wolfOrders);
    requireDotsRulesV3InValue(body, dotsRulesV3);
    requireDotsHighLowInValue(body, dotsHighLow);
    if ((head ? revision(head) : null) !== expected) {
      const receipt = await this.gameReceipt(eventId, roundId, requestId);
      if (!receipt || receipt.expectedEtag !== expected || !sameScoreActor(receipt.recordedBy, identity)) throw new ApiError(409, 'GAMES_CHANGED');
    }
    return receivePrivateWrite(this.table, identity, eventId, `round-games:${roundId}`, expected, requestId, body);
  }

  private async receipt(eventId: string, requestId: string): Promise<(ScoreChange & { readonly requestHash?: string }) | undefined> {
    const row = await optionalRow(this.table, eventId, `score-change:${requestId}`);
    if (!row) return undefined;
    const change = decode(await privateContent(this.table, eventId, `score-change:${requestId}`, row.content), isScoreChange);
    if (row.kind !== 'score-change' || row.roundId !== change.roundId || row.playerId !== change.playerId
      || change.eventId !== eventId || change.id !== requestId) throw new ApiError(503, 'INVALID_STORED_SCORE_CHANGE');
    return { ...projectChange(change), ...(typeof row.requestHash === 'string' ? { requestHash: row.requestHash } : {}) };
  }

  private async acknowledgement(identity: ScoreActor, change: ScoreChange): Promise<ScoreWriteResult> {
    // A later valid edit must not turn an acknowledged write into a stale-create failure.
    for (let attempt = 0; ; attempt++) {
      try {
        const round = await this.get(identity, change.eventId, change.roundId);
        const target = round.cards.find((card) => card.playerId === change.playerId);
        if (!target || target.etag === null || !round.setupLocked) throw new ApiError(503, 'INVALID_STORED_SCORECARD');
        const publicChange = projectChange(change, false);
        return { round, change: round.permissions?.role === 'tester'
          ? { ...publicChange, before: withoutMatchDeclarations(change.before), after: withoutMatchDeclarations(change.after) }
          : round.permissions?.role === 'owner' ? change : publicChange };
      } catch (error) {
        if (attempt < 2 && error instanceof ApiError && error.code === 'EVENT_CHANGED') continue;
        throw error;
      }
    }
  }

  private async replay(identity: ScoreActor, eventId: string, roundId: string, playerId: string,
    holeNumber: number, score: HoleScore, expectedEtag: string | null, requestId: string,
    inputRevision?: string | null): Promise<ScoreWriteResult | undefined> {
    const change = await this.receipt(eventId, requestId);
    if (!change) return undefined;
    if (change.roundId !== roundId || change.playerId !== playerId || change.holeNumber !== holeNumber
      || change.expectedEtag !== expectedEtag || !sameScoreActor(change.recordedBy, identity)
      || (change.expectedInputRevision ?? null) !== (inputRevision ?? null)
      || (change.requestHash !== undefined ? change.requestHash !== createHash('sha256').update(canonical(score)).digest('hex')
        : !matchesScoreIntent(change.after, score))) {
      throw new ApiError(409, 'SCORE_REQUEST_CONFLICT');
    }
    const result = await this.acknowledgement(identity, projectChange(change));
    if (result.round.eventStatus !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    return result;
  }

  async write(identity: ScoreActor, eventId: string, roundId: string, playerId: string, holeNumber: number,
    score: HoleScore, expectedEtag: string | null, requestId: string, inputRevision?: string | null, stringRules = true, dotsCalls = true, categorySweeps = true, churchyNames = true, sweepRules = true, dotCoexistence = true, gameHandicaps = true, gameCalculations = true, wolfOrders = true, dotsHighLow = true, dotsRulesV3 = true): Promise<ScoreWriteResult> {
    if (!isUuid(requestId) || !isUuid(playerId) || !isHoleScore(score) || !Number.isSafeInteger(holeNumber)
      || expectedEtag !== null && !isEventRevision(expectedEtag)
      || inputRevision !== undefined && inputRevision !== null && !isUuid(inputRevision)) throw new ApiError(400, 'INVALID_SCORE_WRITE');
    const state = await this.snapshot(identity, eventId, roundId);
    await this.requireCalculationWriter(identity, eventId, roundId, gameCalculations);
    requirePullyMurphyTargets(score, gameCalculations);
    requireWolfOrders((state.games?.games ?? []).filter((game) => !state.testerLink || game.kind !== 'wolf'), wolfOrders);
    requireWolfOrdersInValue(score, wolfOrders);
    requireDotsRulesV3((state.games?.games ?? []).filter((game) => !state.testerLink || game.kind !== 'dots'), dotsRulesV3);
    // Legacy tester links never see Nines, so their raw score writes stay available.
    requireNinesSupport((state.games?.games ?? []).filter((game) => !state.testerLink || game.kind !== 'nines'));
    requireDotsHighLow((state.games?.games ?? []).filter((game) => !state.testerLink || game.kind !== 'dots'), dotsHighLow);
    requireDotsRulesV3InValue(score, dotsRulesV3);
    requireDotsHighLowInValue(score, dotsHighLow);
    requireGameHandicapRules(state.games?.games ?? [], gameHandicaps);
    if (state.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    requireStringRules(state.games?.games ?? [], stringRules);
    requireCategorySweeps(state.games?.games ?? [], categorySweeps);
    requireChurchyNames((state.games?.games ?? []).filter((game) =>
      !state.testerLink || game.kind === 'churchy' && game.version === 1), churchyNames);
    requireSweepRules((state.games?.games ?? []).filter((game) => !state.testerLink
      || game.kind === 'churchy' && game.version === 1), sweepRules);
    if (!sweepRules) requireSweepRulesInValue(score);
    if (!dotsCalls) requireLegacyDotsCalls([score]);
    await this.requireDotsCalls(eventId, state, dotsCalls);
    if (!state.round.teeProfile.holes.some((hole) => hole.number === holeNumber)) throw new ApiError(400, 'ROUND_HOLE_NOT_FOUND');
    if (!state.round.players.some((player) => player.playerId === playerId)) throw new ApiError(404, 'ROUND_PLAYER_NOT_FOUND');
    const grant = this.writer(state, playerId);
    if (state.round.inputRevision && state.round.inputRevision !== inputRevision) throw new ApiError(409, 'SCORE_INPUTS_CHANGED');
    const replay = await this.replay(identity, eventId, roundId, playerId, holeNumber, score, expectedEtag, requestId, inputRevision);
    if (replay) return replay;
    const requestHash = createHash('sha256').update(canonical(score)).digest('hex');
    const originalScore = score;
    const cards = await this.cards(eventId, state.round, state.lock);
    const card = cards.find((entry) => entry.playerId === playerId);
    if (!card) throw new ApiError(503, 'INVALID_STORED_SCORECARD');
    if (card.etag !== expectedEtag) throw new ApiError(409, 'SCORECARD_CHANGED');
    const before = card.holes.find((hole) => hole.number === holeNumber);
    if (!before) throw new ApiError(503, 'INVALID_STORED_SCORECARD');
    score = retainMurphyTargets(score, before.score, dotRound(state.round, cards));
    // Legacy/raw-only clients never erase hidden specials.
    if (state.testerLink && score.churchy && score.churchy.version !== undefined) throw new ApiError(403, 'MATCH_DECLARATIONS_NOT_ALLOWED');
    let savedScore: HoleScore;
    try { savedScore = preserveScoreExtras(score, before.score); }
    catch (error) {
      if (error instanceof GameDeclarationConflictError) throw new ApiError(409, error.code);
      throw error;
    }
    if (!state.lock && state.games?.games.some((game) => game.kind === 'nassau' || game.kind === 'match-play'
      ? nassauConfigurationIssues(game, state.round).length > 0
      : game.kind === 'dots' ? !dotsDefinitionMatchesRound(game, dotRound(state.round, definitionCards(state.round)))
        : game.kind === 'wolf' && !wolfGroupMatchesRound(game, { layout: state.round.teeProfile.holes, groups: state.round.groups }))) {
      throw new ApiError(409, 'MATCH_SETUP_CHANGED');
    }
    const nassauChanged = !sameNassauRecords(savedScore.nassau, before.score.nassau);
    const wolfChanged = !sameWolfRecords(savedScore.wolf, before.score.wolf);
    const dotsChanged = !sameDotsRecords(savedScore.dots, before.score.dots);
    if (score.dots !== undefined && state.testerLink) throw new ApiError(403, 'MATCH_DECLARATIONS_NOT_ALLOWED');
    if ((nassauChanged || wolfChanged) && state.testerLink) throw new ApiError(403, 'MATCH_DECLARATIONS_NOT_ALLOWED');
    this.requireCoexistence(state, cards, playerId, holeNumber, savedScore, dotCoexistence && !state.testerLink);
    for (const record of nassauChanged ? score.nassau ?? [] : []) {
      const game = state.games?.games.find((entry) => entry.id === record.gameId);
      if (game?.kind !== 'nassau' && game?.kind !== 'match-play' || record.gameEtag !== state.games?.etag || record.number !== holeNumber
        || gameAnchorPlayerId(game, state.round.groups) !== playerId
        || nassauConfigurationIssues(game, state.round).length || !nassauRecordsMatchGame([record], game)) {
        throw new ApiError(409, 'MATCH_SETUP_CHANGED');
      }
      const records = nassauRecordsFor(game, state.round.groups, cards);
      const oldPresses = records.flatMap((entry) => entry.presses);
      for (const press of record.presses) {
        const old = oldPresses.find((entry) => entry.id === press.id);
        if (old) {
          if (canonical(old) !== canonical(press)) throw new ApiError(409, 'NASSAU_PRESS_CONFLICT');
          continue;
        }
        if (!validateNassauManualPress(game, state.round, cards, records, press).valid) throw new ApiError(409, 'NASSAU_PRESS_CHANGED');
      }
    }
    if (wolfChanged) {
      const wolf = [...(savedScore.wolf ?? [])];
      for (const record of score.wolf ?? []) {
        const game = state.games?.games.find((entry) => entry.id === record.choice.gameId);
        const previous = before.score.wolf?.find((entry) => entry.choice.gameId === record.choice.gameId);
        const results = game?.kind === 'wolf' && game.version === 2
          ? calculateGameResults(state.games?.games ?? [], state.round, cards) : [];
        const currentWolf = results.find((result) => result.gameId === game?.id)?.wolf;
        const orderRecords = cards.find((card) => card.playerId === playerId)?.holes
          .flatMap((hole) => hole.number === holeNumber ? savedScore.wolf ?? [] : hole.score.wolf ?? [])
          .filter((entry) => entry.choice.gameId === record.choice.gameId) ?? [];
        const wolfRound = { layout: state.round.teeProfile.holes, groups: state.round.groups };
        const layout = [...wolfRound.layout].sort((a, b) => a.number - b.number);
        const startingHole = game?.kind === 'wolf'
          ? groupStartingHole(state.round.groups.find((entry) => entry.number === game.groupNumber), layout) : undefined;
        const playedIndex = (layout.findIndex((hole) => hole.number === holeNumber)
          - layout.findIndex((hole) => hole.number === startingHole) + layout.length) % layout.length;
        const wolfId = game?.kind === 'wolf' && game.orderMode && (game.version === 1 || playedIndex < layout.length - 2)
          ? wolfForHole(game, wolfRound, holeNumber, orderRecords) : game?.kind === 'wolf' && game.version === 2
          ? currentWolf?.holes.find((hole) => hole.number === holeNumber)?.wolfId
          : game?.kind === 'wolf' ? wolfForHole(game, wolfRound, holeNumber, orderRecords) : null;
        if (game?.kind !== 'wolf' || record.choice.gameEtag !== state.games?.etag || record.number !== holeNumber
          || gameAnchorPlayerId(game, state.round.groups) !== playerId
          || !wolfGroupMatchesRound(game, { layout: state.round.teeProfile.holes, groups: state.round.groups })
          || record.choice.mode === 'pig' && !game.allowPig
          || game.version === 1 && record.comeback !== undefined
          || game.version === 2 && record.outcome !== undefined && record.outcome !== 'scores'
          || record.order && (!game.orderMode || !wolfOrder(game, wolfRound, orderRecords))
          || record.choice.mode === 'order' && (!game.orderMode || !record.order)
          || game.orderMode && record.choice.mode !== 'order' && !wolfId
          || record.choice.mode === 'partner' && (!wolfId || record.choice.partnerId === wolfId || !game.playerIds.includes(record.choice.partnerId))) {
          throw new ApiError(409, 'MATCH_SETUP_CHANGED');
        }
        if (game.version === 2 && record.choice.mode !== 'order') {
          const layout = [...state.round.teeProfile.holes].sort((a, b) => a.number - b.number);
          const group = state.round.groups.find((entry) => entry.number === game.groupNumber);
          const start = layout.findIndex((hole) => hole.number === groupStartingHole(group, layout));
          const prefix = [...layout.slice(start), ...layout.slice(0, start)].slice(0, -2).map((hole) => hole.number);
          const comeback = currentWolf?.comeback;
          if (record.comeback !== undefined && (prefix.includes(holeNumber) || !comeback?.receipt
            || canonical(record.comeback) !== canonical(comeback.receipt))
            || !prefix.includes(holeNumber) && comeback?.status !== 'saved'
              && (comeback?.status !== 'available' || record.comeback === undefined)) {
            throw new ApiError(409, 'WOLF_COMEBACK_CHANGED');
          }
        }
        if (previous && previous.choice.mode !== 'order'
          && (previous.choice.mode !== record.choice.mode || previous.choice.partnerId !== record.choice.partnerId)) {
          throw new ApiError(409, 'WOLF_CHOICE_LOCKED');
        }
        const index = wolf.findIndex((entry) => entry.choice.gameId === game.id);
        const stored = wolf[index];
        const late = previous?.choice.mode !== 'order' && previous ? previous.recordedLate === true : game.playerIds.some((id) => cards.find((entry) => entry.playerId === id)?.holes
          .some((hole) => hole.number === holeNumber && hole.score.kind !== 'unplayed'));
        if (stored) {
          wolf[index] = { number: stored.number, choice: stored.choice, ...(stored.outcome ? { outcome: stored.outcome } : {}),
            ...(stored.order ? { order: previous?.order ?? { playerIds: stored.order.playerIds,
              ...(game.playerIds.some((id) => cards.find((entry) => entry.playerId === id)?.holes
                .some((hole) => hole.score.kind !== 'unplayed')) ? { recordedLate: true as const } : {}) } } : {}),
            ...(stored.comeback ? { comeback: stored.comeback } : {}),
            ...(late && stored.choice.mode !== 'order' ? { recordedLate: true as const } : {}) };
        }
      }
      savedScore = { ...savedScore, wolf };
    }
    if (dotsChanged) {
      const dots = [...(savedScore.dots ?? [])];
      for (const record of score.dots ?? []) {
        const previous = before.score.dots?.find((entry) => entry.gameId === record.gameId);
        if (previous && sameDotsRecords([record], [previous])) continue;
        const game = state.games?.games.find((entry) => entry.id === record.gameId);
        if (game?.kind !== 'dots' || record.gameEtag !== state.games?.etag || record.number !== holeNumber
          || state.round.groups.find((group) => group.number === game.groupNumber)?.playerIds[0] !== playerId) {
          throw new ApiError(409, 'DOTS_SETUP_CHANGED');
        }
        for (const declaration of record.players) {
          const prior = previous?.players.find((entry) => entry.playerId === declaration.playerId);
          if (canonical(declaration) !== canonical(prior ?? null)
            && dotsDeclarationIssues(declaration).conflicts.length) throw new ApiError(409, 'DOTS_SETUP_CHANGED');
          if (canonical(declaration) !== canonical(prior ?? null)
            && dotsDeclarationWriteIssues(declaration).conflicts.length) throw new ApiError(409, 'DOTS_SETUP_CHANGED');
        }
        if (record.rotation) {
          const receipt = dotsRecordsFor(game, state.round.groups, cards).find((entry) => entry.rotation);
          if (receipt && receipt.number !== holeNumber) throw new ApiError(409, 'DOTS_ROTATION_CONFLICT');
          if (!receipt) {
            const firstPlayed = dotsFirstPlayedHole(dotRound(state.round, cards), game.groupNumber);
            if (firstPlayed !== null && firstPlayed !== holeNumber) throw new ApiError(409, 'DOTS_SETUP_CHANGED');
            const index = dots.findIndex((entry) => entry.gameId === game.id);
            dots[index] = { ...record, rotation: { playerIds: record.rotation.playerIds,
              ...(firstPlayed !== null ? { recordedLate: true as const } : {}) } };
          }
        }
      }
      savedScore = { ...savedScore, dots };
      const nextCards = cards.map((entry) => entry.playerId === playerId ? { ...entry,
        holes: entry.holes.map((hole) => hole.number === holeNumber ? { ...hole, score: savedScore } : hole) } : entry);
      this.requireCoexistence(state, cards, playerId, holeNumber, savedScore, dotCoexistence && !state.testerLink);
      const results = calculateGameResults(state.games?.games ?? [], state.round, nextCards);
      for (const record of score.dots ?? []) {
        const previous = before.score.dots?.find((entry) => entry.gameId === record.gameId);
        if (previous && sameDotsRecords([record], [previous])) continue;
        const game = state.games?.games.find((entry) => entry.id === record.gameId);
        if (game?.kind !== 'dots') throw new ApiError(409, 'DOTS_SETUP_CHANGED');
        const records = nextCards.find((entry) => entry.playerId === playerId)?.holes
          .flatMap((hole) => hole.score.dots?.filter((item) => item.gameId === game.id) ?? []) ?? [];
        const contexts = linkedDotsWriteContexts(game, state.games?.games ?? [], results, state.round);
        if (!dotsRecordsMatchGame(records, game, dotRound(state.round, nextCards), contexts,
          { records: dotsRecordsFor(game, state.round.groups, cards), round: dotRound(state.round, cards) })) {
          throw new ApiError(409, 'DOTS_SETUP_CHANGED');
        }
      }
    }
    if (!sameKpEntry(savedScore.kp, before.score.kp)) {
      const { kp } = await this.kpProjection(eventId, roundId, state.event.kpRoundIds);
      if (!kp || kp.status !== 'open') throw new ApiError(409, 'KP_ENTRIES_CLOSED');
      if (kp.context !== roundKpContext(state.round)
        || !state.round.teeProfile.holes.some((hole) => hole.number === holeNumber && hole.par === 3)) {
        throw new ApiError(409, 'KP_CONTEXT_CHANGED');
      }
    }
    if (!sameChurchySpecials(savedScore.churchy, before.score.churchy)) {
      if (!this.churchyEnabled()) throw new ApiError(403, 'CHURCHY_DISABLED');
      const extras = savedScore.churchy;
      const game = state.games?.games.find((entry) => entry.kind === 'churchy' && entry.id === extras?.gameId);
      if (!extras || game?.kind !== 'churchy' || state.games?.etag !== extras.gameEtag
        || !game.playerIds.includes(playerId) || !churchySpecialsMatchGame(extras, game)) {
        throw new ApiError(409, 'CHURCHY_SETUP_CHANGED');
      }
      const group = state.round.groups.find((entry) => entry.number === game.groupNumber);
      if (!group || group.playerIds.length !== 4 || !group.playerIds.every((id) => game.playerIds.includes(id))) {
        throw new ApiError(409, 'CHURCHY_SETUP_CHANGED');
      }
      if (game.version === 3) {
        if (extras.version !== 3 || extras.number !== holeNumber || group.playerIds[0] !== playerId) {
          throw new ApiError(409, 'CHURCHY_SETUP_CHANGED');
        }
        const previous = before.score.churchy;
        for (const declaration of extras.players) {
          const prior = previous?.version === 3
            ? previous.players.find((entry) => entry.playerId === declaration.playerId) : undefined;
          if (canonical(declaration) !== canonical(prior ?? null)
            && dotsDeclarationWriteIssues(declaration, {
              score: declaration.playerId === playerId ? savedScore
                : cards.find((card) => card.playerId === declaration.playerId)?.holes.find((hole) => hole.number === holeNumber)?.score,
              par: (state.round.playerTees?.find((entry) => entry.playerId === declaration.playerId)?.profile.holes ?? state.round.teeProfile.holes)
                .find((hole) => hole.number === holeNumber)?.par,
            }).conflicts.length) throw new ApiError(409, 'CHURCHY_SETUP_CHANGED');
        }
        const receipts = churchyV3Records(game, state.round.groups, cards);
        const receipt = receipts.find((record) => record.rotation);
        if (extras.rotation && receipt && receipt.number !== holeNumber) throw new ApiError(409, 'CHURCHY_ORDER_CONFLICT');
        if (extras.rotation && !receipt) {
          if (holeNumber !== groupStartingHole(group, state.round.teeProfile.holes)) throw new ApiError(409, 'CHURCHY_SETUP_CHANGED');
          const late = game.playerIds.some((id) => cards.find((card) => card.playerId === id)?.holes.some((hole) => hole.score.kind !== 'unplayed'));
          savedScore = { ...savedScore, churchy: { ...extras, rotation: { playerIds: extras.rotation.playerIds,
            ...(late ? { recordedLate: true as const } : {}) } } };
        } else if (previous?.version === 3 && previous.rotation && savedScore.churchy?.version === 3) {
          savedScore = { ...savedScore, churchy: { ...savedScore.churchy, rotation: previous.rotation } };
        }
        const nextCards = cards.map((card) => card.playerId === playerId ? { ...card,
          holes: card.holes.map((hole) => hole.number === holeNumber ? { ...hole, score: savedScore } : hole) } : card);
        if (!churchyV3RecordsMatchGame(churchyV3Records(game, state.round.groups, nextCards), game, dotRound(state.round, nextCards),
          { records: churchyV3Records(game, state.round.groups, cards), round: dotRound(state.round, cards) })) {
          throw new ApiError(409, 'CHURCHY_SETUP_CHANGED');
        }
      }
    }
    const nextCards = cards.map((entry) => entry.playerId === playerId ? { ...entry,
      holes: entry.holes.map((hole) => hole.number === holeNumber ? { ...hole, score: savedScore } : hole) } : entry);
    if (!dotsCalls && hasDotsCallPolicy(nextCards)) {
      murphyRoundScores(await this.projection(state.workspace, state.round, nextCards, state, state.games), true, true, false);
    }
    for (const game of state.games?.games ?? []) {
      if (game.kind !== 'dots' && (game.kind !== 'churchy' || game.version !== 3)) continue;
      if (game.kind === 'churchy' && !this.churchyEnabled()) continue;
      const previous = game.kind === 'dots' ? dotsRecordsFor(game, state.round.groups, cards)
        : churchyV3Records(game, state.round.groups, cards);
      const records = game.kind === 'dots' ? dotsRecordsFor(game, state.round.groups, nextCards)
        : churchyV3Records(game, state.round.groups, nextCards);
      if (dotsAutomaticWriteConflicts(game, dotRound(state.round, cards), dotRound(state.round, nextCards), previous, records).length) {
        throw new ApiError(409, game.kind === 'dots' ? 'DOTS_SETUP_CHANGED' : 'CHURCHY_SETUP_CHANGED');
      }
    }
    const recordedAt = new Date().toISOString();
    const actor = scoreActor(identity);
    const dotAwardAudit = buildDotAwardAudit(state.games?.games ?? [], state.round, state.round,
      cards, nextCards, state.games?.etag ?? null);
    const change: ScoreChange = {
      id: requestId, eventId, roundId, playerId, holeNumber, before: before.score, after: savedScore,
      expectedEtag, ...(state.round.inputRevision ? { expectedInputRevision: state.round.inputRevision } : {}), recordedAt, recordedBy: actor,
      ...(dotAwardAudit.length ? { dotAwardAudit } : {}),
    };
    const updated: StoredCard = {
      playerId: card.playerId, displayName: card.displayName, updatedAt: recordedAt,
      holes: card.holes.map((hole) => hole.number === holeNumber ? { number: holeNumber, score: savedScore } : hole),
    };
    const entity = { partitionKey: eventId, rowKey: cardKey(roundId, playerId),
      content: await stagePrivateContent(this.table, eventId, cardKey(roundId, playerId), identity, canonical(updated)) };
    const changeContent = await stagePrivateContent(this.table, eventId, `score-change:${requestId}`, identity, canonical(change));
    const actions: TransactionAction[] = [
      ['update', { partitionKey: eventId, rowKey: 'event', scoresUpdatedAt: recordedAt }, 'Merge', { etag: state.summary.etag }],
      expectedEtag === null ? ['create', entity] : ['update', entity, 'Replace', { etag: expectedEtag }],
      ['create', {
        partitionKey: eventId, rowKey: `score-change:${requestId}`, kind: 'score-change', roundId, playerId, requestHash, content: changeContent,
      }],
    ];
    if (!sameKpEntry(savedScore.kp, before.score.kp) && savedScore.kp?.kind === 'measured') {
      // A measurement identity is single-use, even after clearing/restoring its old value.
      // This prevents a caller from resurrecting an earlier tie proof.
      actions.push(['create', { partitionKey: eventId, rowKey: `kp-measurement:${savedScore.kp.measurementId}`,
        roundId, playerId, holeNumber, requestId }]);
    }
    // Public authority is the active event itself, already conditionally updated above.
    // Account and tester writes still check their actual independent grant in this transaction.
    if (!('kind' in identity) || identity.kind === 'tester-link') {
      actions.splice(1, 0, ['update', 'kind' in identity
        ? { partitionKey: eventId, rowKey: testerLinkKey(identity.linkId), scoreRevision: requestId }
        : { partitionKey: eventId, rowKey: `member:${identity.objectId}`, ...actor, role: grant.role },
      'Merge', { etag: grant.etag }]);
    }
    if (!state.lock) {
      const savedRound = await optionalRow(this.table, eventId, `round:${roundId}`);
      if (!savedRound) throw new ApiError(409, 'SCORECARD_CHANGED');
      const captureKey = `index-capture:${roundId}`;
      const capture = {
        kind: 'index-capture', version: 1, eventId, roundId, requestId, recordedAt, recordedBy: actor,
        players: state.round.players.map((entry) => ({ playerId: entry.playerId, handicapIndex: entry.handicapIndex ?? null })),
      };
      const roundContent = await stagePrivateContent(this.table, eventId, `round:${roundId}`, identity, canonical(state.round));
      const captureContent = await stagePrivateContent(this.table, eventId, captureKey, identity, canonical(capture));
      actions.push(
        ['update', { partitionKey: eventId, rowKey: `round:${roundId}`, content: roundContent }, 'Merge', { etag: revision(savedRound) }],
        ['create', { partitionKey: eventId, rowKey: captureKey, content: captureContent }],
      );
      const lock: ScoringLock = {
        kind: 'score-lock', eventId, roundId, requestId, startedAt: recordedAt, startedBy: actor, writtenPlayerIds: [playerId],
      };
      actions.push(['create', { partitionKey: eventId, rowKey: `score-lock:${roundId}`,
        content: await stagePrivateContent(this.table, eventId, `score-lock:${roundId}`, identity, canonical(lock)) }]);
    } else if (!state.lock.writtenPlayerIds.includes(playerId)) {
      const lock: ScoringLock = {
        kind: state.lock.kind, eventId, roundId, requestId: state.lock.requestId,
        startedAt: state.lock.startedAt, startedBy: state.lock.startedBy,
        writtenPlayerIds: [...state.lock.writtenPlayerIds, playerId],
      };
      actions.push(['update', {
        partitionKey: eventId, rowKey: `score-lock:${roundId}`,
        content: await stagePrivateContent(this.table, eventId, `score-lock:${roundId}`, identity, canonical(lock)),
      }, 'Replace', { etag: state.lock.etag }]);
    }
    // Staging a large lock may take time. Expiry is rechecked at the publication boundary.
    if ('kind' in identity && identity.kind === 'tester-link' && (!state.testerLink || !activeTesterLink(state.testerLink, identity))) {
      throw new ApiError(403, 'TESTER_ACCESS_ENDED');
    }
    try { await this.table.submitTransaction(actions); }
    catch (error) {
      // Transport failures may occur after commit; the immutable receipt is the authoritative acknowledgement.
      const committed = await this.replay(identity, eventId, roundId, playerId, holeNumber, originalScore, expectedEtag, requestId, inputRevision);
      if (committed) return committed;
      if (isConflict(error)) throw new ApiError(409, 'SCORECARD_CHANGED');
      throw error;
    }
    return this.acknowledgement(identity, change);
  }

  private requireCoexistence(state: Awaited<ReturnType<TableScoreStore['snapshot']>>, cards: readonly Scorecard[],
    playerId: string, holeNumber: number, score: HoleScore, supported: boolean): void {
    const next = cards.map((card) => card.playerId === playerId ? { ...card,
      holes: card.holes.map((hole) => hole.number === holeNumber ? { ...hole, score } : hole) } : card);
    for (const game of state.games?.games ?? []) {
      if (game.kind !== 'dots' && (game.kind !== 'churchy' || game.version !== 3)) continue;
      if (game.kind === 'churchy' && !this.churchyEnabled()) continue;
      const previous = game.kind === 'dots' ? dotsRecordsFor(game, state.round.groups, cards)
        : churchyV3Records(game, state.round.groups, cards);
      const records = game.kind === 'dots' ? dotsRecordsFor(game, state.round.groups, next)
        : churchyV3Records(game, state.round.groups, next);
      if (dotsCoexistenceWriteConflicts(game, dotRound(state.round, cards), dotRound(state.round, next), previous, records).length) {
        if (!supported) throw new DotsCoexistenceClientUpdateRequired();
        throw new ApiError(409, game.kind === 'dots' ? 'DOTS_SETUP_CHANGED' : 'CHURCHY_SETUP_CHANGED');
      }
    }
  }

  async receiveGameScore(identity: ScoreActor, eventId: string, roundId: string, playerId: string, holeNumber: number,
    body: unknown, expected: string | null, requestId: string, stringRules = true, dotsCalls = true, categorySweeps = true, churchyNames = true, sweepRules = true, dotCoexistence = true, gameHandicaps = true, gameCalculations = true, wolfOrders = true, dotsHighLow = true, dotsRulesV3 = true) {
    await this.requireCalculationWriter(identity, eventId, roundId, gameCalculations);
    requirePullyMurphyTargets(body, gameCalculations);
    if (!isUuid(requestId) || !isUuid(playerId) || !Number.isInteger(holeNumber)
      || expected !== null && !isEventRevision(expected)) throw new ApiError(400, 'INVALID_SCORE_WRITE');
    const state = await this.snapshot(identity, eventId, roundId);
    requireWolfOrders(state.games?.games ?? [], wolfOrders);
    requireWolfOrdersInValue(body, wolfOrders);
    requireDotsRulesV3(state.games?.games ?? [], dotsRulesV3);
    requireNinesSupport(state.games?.games ?? []);
    requireDotsHighLow(state.games?.games ?? [], dotsHighLow);
    requireDotsRulesV3InValue(body, dotsRulesV3);
    requireDotsHighLowInValue(body, dotsHighLow);
    if (state.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    requireStringRules(state.games?.games ?? [], stringRules);
    requireCategorySweeps(state.games?.games ?? [], categorySweeps);
    requireChurchyNames(state.games?.games ?? [], churchyNames);
    requireSweepRules(state.games?.games ?? [], sweepRules);
    requireGameHandicapRules(state.games?.games ?? [], gameHandicaps);
    if (!sweepRules) requireSweepRulesInValue(body);
    await this.requireDotsCalls(eventId, state, dotsCalls);
    if (!dotsCalls) {
      if (isRecord(body) && isHoleScore(body.score)) requireLegacyDotsCalls([body.score]);
      // Opaque fragments cannot prove that the assembled declaration is legacy-representable.
      if (state.games?.games.some((game) => game.kind === 'dots') && isRecord(body)
        && (Object.hasOwn(body, 'privateUpload') || Object.hasOwn(body, 'privateCommit'))) throw new DotsCallsClientUpdateRequired();
    }
    this.writer(state, playerId);
    if (state.testerLink) throw new ApiError(403, 'MATCH_DECLARATIONS_NOT_ALLOWED');
    if (!state.round.teeProfile.holes.some((hole) => hole.number === holeNumber)
      || !state.round.players.some((player) => player.playerId === playerId)) throw new ApiError(400, 'INVALID_SCORE_WRITE');
    const player = state.round.players.find((entry) => entry.playerId === playerId);
    if (!player) throw new ApiError(404, 'ROUND_PLAYER_NOT_FOUND');
    const card = await this.card(eventId, state.round, player, new Set(state.lock?.writtenPlayerIds));
    let committed = false;
    if (card.etag !== expected) {
      const receipt = await this.receipt(eventId, requestId);
      if (!receipt || receipt.expectedEtag !== expected || receipt.roundId !== roundId || receipt.playerId !== playerId
        || receipt.holeNumber !== holeNumber || !sameScoreActor(receipt.recordedBy, identity)) throw new ApiError(409, 'SCORECARD_CHANGED');
      committed = true;
    }
    if (!committed && isRecord(body) && isHoleScore(body.score)) {
      const prior = card.holes.find((hole) => hole.number === holeNumber);
      if (!prior) throw new ApiError(503, 'INVALID_STORED_SCORECARD');
      const cards = await this.cards(eventId, state.round, state.lock);
      let saved: HoleScore;
      try { saved = preserveScoreExtras(retainMurphyTargets(body.score, prior.score, dotRound(state.round, cards)), prior.score); }
      catch (error) {
        if (error instanceof GameDeclarationConflictError) throw new ApiError(409, error.code);
        throw error;
      }
      this.requireCoexistence(state, cards, playerId, holeNumber, saved, dotCoexistence);
    }
    return receivePrivateWrite(this.table, identity, eventId, `game-score:${roundId}:${playerId}:${String(holeNumber)}`, expected, requestId, body);
  }

  async history(identity: ScoreActor, eventId: string, roundId: string, playerId: string, cursor?: string): Promise<ScoreHistoryPage> {
    if (!isUuid(playerId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
    const state = await this.snapshot(identity, eventId, roundId, true);
    if (!state.round.players.some((player) => player.playerId === playerId)) throw new ApiError(404, 'ROUND_PLAYER_NOT_FOUND');
    const result = await page(this.table, `PartitionKey eq '${eventId}' and RowKey ge 'score-change:' and RowKey lt 'score-change;' and kind eq 'score-change' and roundId eq '${roundId}' and playerId eq '${playerId}'`, cursor);
    const changes = await Promise.all(result.rows.map(async (row) => {
      const change = decode(await privateContent(this.table, eventId, String(row.rowKey), row.content), isScoreChange);
      if (row.rowKey !== `score-change:${change.id}` || row.kind !== 'score-change'
        || row.roundId !== roundId || row.playerId !== playerId || change.eventId !== eventId
        || change.roundId !== roundId || change.playerId !== playerId
        || !state.round.teeProfile.holes.some((hole) => hole.number === change.holeNumber)) throw new ApiError(503, 'INVALID_STORED_SCORE_CHANGE');
      return projectChange(change);
    }));
    await this.unchanged(identity, eventId, state);
    return { changes, ...(result.continuationToken ? { continuationToken: result.continuationToken } : {}) };
  }
}
