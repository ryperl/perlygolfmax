import type { TableClient, TransactionAction } from '@azure/data-tables';
import { clientSupportsAllNinesRules, requireNinesSupport } from '../nines-negotiation.js';
import { randomUUID } from 'node:crypto';
import type { AccountIdentity, EventSummary } from '../../../src/domain/events.js';
import type { ScoreActor } from '../../../src/domain/test-access.js';
import type { PlayerProfile } from '../../../src/domain/catalog.js';
import { roundTee } from '../../../src/domain/round-tee.js';
import type { EventRosterPlayer, EventSetupInput, EventWorkspace, OverallCompetition, RoundSnapshot } from '../../../src/domain/setup.js';
import { isPrivateUpload, maximumPrivateWriteBytes } from '../../../src/contracts/private-values.js';
import { isRecord, isUuid } from '../../../src/contracts/events.js';
import { isEventSetupInput, isEventWorkspace, isOverallCompetition } from '../../../src/contracts/setup.js';
import { ApiError } from '../errors.js';
import { canonical, decode, isConflict, optionalRow, revision, transaction } from '../catalog/entities.js';
import { requireManager } from '../catalog/courses.js';
import type { CatalogPermission, TableCourseCatalog } from '../catalog/courses.js';
import type { TablePlayerCatalog } from '../catalog/players.js';
import { currentRosterDisplay, currentRosterProfiles } from '../catalog/players.js';
import { metadata, profile } from '../catalog/projections.js';
import { isIndexRefreshAudit } from './index-refresh.js';
import type { IndexRefreshAudit } from './index-refresh.js';
import { scoringLock } from '../scoring/lock.js';
import type { ScoringLock } from '../scoring/lock.js';
import { configuredGameRounds, readGameConfiguration } from '../scoring/games.js';
import { privateContent, stagePrivateContent } from '../private-values.js';
import { receivePrivateWrite } from '../private-transport.js';
import type { StagedPublication } from '../private-transport.js';
import type { PlayerTeeProfile } from '../../../src/domain/tees.js';
import { compatibleTeeLayouts, sameTeeSelections } from '../../../src/domain/tees.js';
import { assertEventAccessUnchanged, readEventAccess } from '../event-access.js';
import { isEventSkinsChange, isEventSkinsConfiguration } from '../../../src/contracts/event-skins.js';
import type { EventSkinsChange, EventSkinsConfiguration } from '../../../src/domain/event-skins.js';
import { isEventRevision } from '../../../src/contracts/events.js';
import type {
  RoundCorrectionInput, RoundCorrectionReadModel, RoundCorrectionReceipt, RoundCorrectionWriteRequest, RoundCorrectionWriteResult, RoundReviewWarning,
} from '../../../src/domain/round-corrections.js';
import {
  isRoundCorrectionWriteRequest,
} from '../../../src/contracts/round-corrections.js';
import { isRoundGameDefinitions } from '../../../src/contracts/games.js';
import { gameTeamsMatchRoster, isTeamGameDefinition } from '../../../src/domain/games.js';
import type { RoundGameDefinition } from '../../../src/domain/games.js';
import { skinsCarryCircuit } from '../../../src/domain/round-navigation.js';
import { hasGameHandicapRules } from '../../../src/contracts/game-handicaps.js';
import { isHandicapIndex } from '../../../src/contracts/catalog.js';
import type { PublicScoreIdentity } from '../../../src/domain/public-access.js';
import { dotsDefinitionMatchesRound } from '../../../src/contracts/dots.js';
import { definitionCards, dotRound } from '../scoring/internal-games.js';
import { buildDotAwardAudit, correctionAuditCards, supportsDotAwardAudit } from '../scoring/dot-audit.js';
import { requireGameCalculations } from '../../../src/contracts/game-calculations.js';
import { requireWolfOrders } from '../../../src/contracts/wolf-orders.js';
import { requireDotsHighLow } from '../../../src/contracts/dots-high-low-rules.js';
import { requireDotsRulesV3 } from '../../../src/contracts/dots-rules-v3.js';
import { publishedCourseHandicaps } from '../../../src/domain/playing-handicaps.js';
import { calculateGameResults } from '../../../src/domain/stableford.js';
import type { EventHandicapRefreshResult } from '../../../src/domain/player-handicap-update.js';
import { readPublicAccess } from '../public-access/authority.js';
import {
  acknowledgePlayerIndexRefresh, playerIndexRefreshKey, playerIndexRefreshReplay, validateRefreshCapture,
} from './player-index-refresh.js';
import type { PlayerIndexRefreshReceipt } from './player-index-refresh.js';

interface WorkspaceHeader {
  readonly eventSkins?: EventSkinsConfiguration;
  readonly location: string;
  readonly roster: readonly EventRosterPlayer[];
  readonly roundIds: readonly string[];
  readonly overallCompetition?: OverallCompetition;
  readonly allowPerGolferTees?: boolean;
}

function isHeader(value: unknown): value is WorkspaceHeader {
  return isRecord(value) && typeof value.location === 'string'
    && (value.eventSkins === undefined || isEventSkinsConfiguration(value.eventSkins))
    && (value.allowPerGolferTees === undefined || typeof value.allowPerGolferTees === 'boolean')
    && (value.overallCompetition === undefined || isOverallCompetition(value.overallCompetition))
    && Array.isArray(value.roster) && value.roster.length >= 1
    && value.roster.every((player: unknown) => isRecord(player) && isUuid(player.playerId) && typeof player.displayName === 'string')
    && Array.isArray(value.roundIds) && value.roundIds.length >= 1 && value.roundIds.length <= 8
    && value.roundIds.every(isUuid) && new Set(value.roundIds).size === value.roundIds.length;
}

function kpCaptureIdentity(round: RoundSnapshot): string {
  return `${round.id}:${round.courseId}:${round.courseVersionId}:${String(round.teeProfile.id)}`;
}

function correctionInput(round: RoundSnapshot, games?: readonly RoundGameDefinition[]): RoundCorrectionInput {
  const gameTeams = games?.flatMap((game) => isTeamGameDefinition(game)
    ? [{ gameId: game.id, teams: game.teams.map((team) => ({ id: team.id, name: team.name, playerIds: team.playerIds })) }]
    : []) ?? [];
  return {
    teeProfileId: round.teeProfile.id,
    groups: round.groups.map((group) => ({ number: group.number, playerIds: group.playerIds,
      ...(group.startingHole === undefined ? {} : { startingHole: group.startingHole }) })),
    players: round.players.map((player) => ({ playerId: player.playerId, handicapIndexValue: player.handicapIndex?.value ?? null })),
    ...(round.playerTees?.length ? {
      playerTeeSelections: round.playerTees.map((entry) => ({ playerId: entry.playerId, teeProfileId: entry.profile.id })),
    } : {}),
    ...(gameTeams.length ? { gameTeams } : {}),
  };
}

function sameIndexValue(before: string | undefined, after: string): boolean {
  if (before === undefined) return false;
  const signedValue = (value: string) => Number(value) * (value.startsWith('+') ? -1 : 1);
  return signedValue(before) === signedValue(after);
}

export class TableWorkspaceStore {
  constructor(
    private readonly table: TableClient,
    private readonly courses: TableCourseCatalog,
    private readonly players: TablePlayerCatalog,
    private readonly allowed: CatalogPermission,
  ) {}

  private async profiles(identity: AccountIdentity, playerIds: readonly string[]): Promise<readonly PlayerProfile[]> {
    const profiles: PlayerProfile[] = [];
    for (let index = 0; index < playerIds.length; index += 16) {
      profiles.push(...await Promise.all(playerIds.slice(index, index + 16).map((id) => this.players.get(identity, id))));
    }
    return profiles;
  }

  private async access(identity: ScoreActor, id: string) {
    return readEventAccess(this.table, identity, id);
  }

  private async ownerAccess(identity: AccountIdentity, id: string) {
    const access = await this.access(identity, id);
    if (access.summary.role !== 'owner' || !access.member) throw new ApiError(403, 'EVENT_MANAGEMENT_FORBIDDEN');
    return { ...access, member: access.member };
  }

  async saveEventSkins(identity: AccountIdentity, id: string, selection: EventSkinsConfiguration | null,
    etag: string, requestId: string): Promise<EventSkinsChange> {
    if (!isUuid(id) || !isUuid(requestId) || !isEventRevision(etag)
      || selection !== null && !isEventSkinsConfiguration(selection)) throw new ApiError(400, 'INVALID_EVENT_SKINS_SETUP');
    const access = await this.ownerAccess(identity, id);
    if (access.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    const key = `event-skins-change:${requestId}`;
    const replay = async (): Promise<EventSkinsChange | undefined> => {
      const row = await optionalRow(this.table, id, key);
      if (!row) return undefined;
      const change = decode(await privateContent(this.table, id, key, row.content), isEventSkinsChange);
      if (row.kind !== 'event-skins-change' || change.eventId !== id || change.id !== requestId) {
        throw new ApiError(503, 'INVALID_STORED_EVENT_SKINS');
      }
      if (change.expectedEtag !== etag || change.recordedBy.tenantId !== identity.tenantId
        || change.recordedBy.objectId !== identity.objectId || canonical(change.after) !== canonical(selection)) {
        throw new ApiError(409, 'EVENT_SKINS_REQUEST_CONFLICT');
      }
      await assertEventAccessUnchanged(this.table, identity, id, access);
      return change;
    };
    const previous = await replay();
    if (previous) return previous;
    if (access.summary.etag !== etag) throw new ApiError(409, 'EVENT_CHANGED');
    const row = await optionalRow(this.table, id, 'workspace');
    if (!row) throw new ApiError(400, 'EVENT_SETUP_REQUIRED');
    const header = decode(await privateContent(this.table, id, 'workspace', row.content), isHeader);
    const { eventSkins: before, ...rest } = header;
    const change: EventSkinsChange = { id: requestId, eventId: id, expectedEtag: etag, before: before ?? null,
      after: selection, recordedAt: new Date().toISOString(),
      recordedBy: { tenantId: identity.tenantId, objectId: identity.objectId } };
    const content = await stagePrivateContent(this.table, id, 'workspace', identity,
      canonical({ ...rest, ...(selection ? { eventSkins: selection } : {}) }));
    const audit = await stagePrivateContent(this.table, id, key, identity, canonical(change));
    try {
      await this.table.submitTransaction([
        ['update', { partitionKey: id, rowKey: 'event', eventSkinsUpdatedAt: change.recordedAt }, 'Merge', { etag }],
        ['update', { partitionKey: id, rowKey: `member:${identity.objectId}`, ...change.recordedBy, role: 'owner' },
          'Merge', { etag: revision(access.member) }],
        ['update', { partitionKey: id, rowKey: 'workspace', content }, 'Merge', { etag: revision(row) }],
        ['create', { partitionKey: id, rowKey: key, kind: 'event-skins-change', content: audit }],
      ]);
    } catch (error) {
      // Re-read authority as well as the receipt after an uncertain transaction outcome.
      const current = await this.ownerAccess(identity, id);
      if (current.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
      const committed = await optionalRow(this.table, id, key);
      if (committed) {
        const saved = decode(await privateContent(this.table, id, key, committed.content), isEventSkinsChange);
        if (canonical(saved) === canonical(change)) return saved;
      }
      if (isConflict(error)) throw new ApiError(409, 'EVENT_CHANGED');
      throw error;
    }
    return change;
  }

  private async load(summary: EventSummary, currentUnstartedIndices = true,
    chargeRound?: () => Promise<void>): Promise<EventWorkspace> {
    const header = await optionalRow(this.table, summary.id, 'workspace');
    if (!header) return { event: summary, location: '', roster: [], rounds: [], etag: summary.etag };
    const saved = decode(await privateContent(this.table, summary.id, 'workspace', header.content), isHeader);
    const rounds: unknown[] = [];
    const locks = new Map<string, ScoringLock>();
    for (const id of saved.roundIds) {
      await chargeRound?.();
      const row = await optionalRow(this.table, summary.id, `round:${id}`);
      if (!row || typeof row.content !== 'string') throw new ApiError(503, 'INVALID_STORED_WORKSPACE');
      let round: unknown;
      const content = await privateContent(this.table, summary.id, `round:${id}`, row.content);
      try { round = JSON.parse(content); } catch { throw new ApiError(503, 'INVALID_STORED_WORKSPACE'); }
      if (!isRecord(round) || round.id !== id) throw new ApiError(503, 'INVALID_STORED_WORKSPACE');
      const lock = await scoringLock(this.table, summary.id, id);
      if (lock) locks.set(id, lock);
      const { scoringStarted: _ignored, ...snapshot } = round;
      void _ignored;
      rounds.push({ ...snapshot, ...(lock ? { scoringStarted: true } : {}) });
    }
    const workspace = { event: { ...summary, role: 'owner' }, location: saved.location, roster: saved.roster, rounds, etag: summary.etag,
      ...(saved.allowPerGolferTees === undefined ? {} : { allowPerGolferTees: saved.allowPerGolferTees }),
      ...(saved.overallCompetition ? { overallCompetition: saved.overallCompetition } : {}),
      ...(saved.eventSkins ? { eventSkins: saved.eventSkins } : {}) };
    if (!isEventWorkspace(workspace)) throw new ApiError(503, 'INVALID_STORED_WORKSPACE');
    for (const round of workspace.rounds) {
      const players = new Set(round.players.map((player) => player.playerId));
      if (locks.get(round.id)?.writtenPlayerIds.some((id) => !players.has(id))) {
        throw new ApiError(503, 'INVALID_STORED_SCORE_LOCK');
      }
    }
    const active: EventWorkspace = { ...workspace, event: summary };
    if (summary.status !== 'active' || !currentUnstartedIndices) return active;
    const ids = [...new Set(active.rounds.filter((round) => !round.scoringStarted)
      .flatMap((round) => round.players.map((entry) => entry.playerId)))];
    const profiles = new Map((await currentRosterProfiles(this.table, ids)).map((entry) => [entry.id, entry]));
    return { ...active, rounds: active.rounds.map((round) => round.scoringStarted ? round : {
      ...round, players: round.players.map((entry) => {
        const current = profiles.get(entry.playerId);
        if (!current) throw new ApiError(503, 'INVALID_STORED_CATALOG');
        return { ...entry, handicapIndex: current.currentIndex };
      }),
    }) };
  }

  async get(identity: ScoreActor, id: string): Promise<EventWorkspace> {
    const before = await this.access(identity, id);
    if (before.event.purseConfigured !== undefined && before.event.purseConfigured !== true) throw new ApiError(503, 'INVALID_STORED_PURSE');
    const workspace = await this.forDisplay(await this.load(before.summary));
    await assertEventAccessUnchanged(this.table, identity, id, before);
    // Explicit allowlists keep private profiles, observations and audits out of viewer projections.
    return {
      event: before.summary, location: workspace.location, etag: before.summary.etag,
      ...(before.event.quickRound === true ? { quickRound: true as const } : {}),
      ...(!before.testerLink ? { eventSkinsSupported: true as const,
        ...(workspace.eventSkins ? { eventSkins: workspace.eventSkins } : {}) } : {}),
      ...(before.summary.role === 'owner' || before.admittedPlayer || before.publicAccess
        ? { purseConfigured: before.event.purseConfigured === true } : {}),
      canViewScores: before.summary.role === 'owner' || before.admittedPlayer || before.testerLink !== undefined || before.publicAccess === true,
      ...(before.testerLink ? { testerAccess: true as const } : {}),
      ...(before.publicAccess ? { publicAccess: true as const } : {}),
      ...(before.viewerPlayerId && workspace.roster.some((player) => player.playerId === before.viewerPlayerId)
        ? { viewerPlayerId: before.viewerPlayerId } : {}),
      ...(workspace.allowPerGolferTees === undefined ? {} : { allowPerGolferTees: workspace.allowPerGolferTees }),
      ...(workspace.overallCompetition ? { overallCompetition: workspace.overallCompetition } : {}),
      roster: workspace.roster.map((player) => ({
        playerId: player.playerId, displayName: player.displayName,
        ...(before.summary.role === 'owner' || before.publicAccess ? { handicapIndexValue: player.handicapIndexValue ?? null } : {}),
      })),
      rounds: workspace.rounds.map((round) => ({
        id: round.id, name: round.name, courseId: round.courseId, courseVersionId: round.courseVersionId,
        ...(round.roundSide === undefined ? {} : { roundSide: round.roundSide }),
        ...(round.teeTime === undefined ? {} : { teeTime: round.teeTime }),
        ...(round.startDate === undefined ? {} : { startDate: round.startDate }),
        ...(round.inputRevision ? { inputRevision: round.inputRevision } : {}),
        ...(round.reviewWarnings?.length ? { reviewWarnings: round.reviewWarnings } : {}),
        course: metadata(round.course), teeProfile: profile(round.teeProfile),
        ...(round.playerTees?.length ? { playerTees: round.playerTees.map((entry) => ({
          playerId: entry.playerId, profile: profile(entry.profile),
        })) } : {}),
        ...(round.scoringStarted ? { scoringStarted: true } : {}),
        groups: round.groups.map((group) => ({ number: group.number, playerIds: [...group.playerIds],
          ...(group.startingHole === undefined ? {} : { startingHole: group.startingHole }) })),
        players: round.players.map((player) => before.summary.role === 'owner'
          ? {
            playerId: player.playerId, displayName: player.displayName,
            ...(player.handicapIndex === undefined ? {} : {
              handicapIndex: player.handicapIndex,
              handicapIndexValue: player.handicapIndex?.value ?? null,
            }),
          }
          : { playerId: player.playerId, displayName: player.displayName,
            ...(before.publicAccess && player.handicapIndex !== undefined
              ? { handicapIndexValue: player.handicapIndex?.value ?? null } : {}) }),
      })),
    };
  }

  /** Current names and roster HI are display metadata; captured inputs stay immutable. */
  async forDisplay(workspace: EventWorkspace): Promise<EventWorkspace> {
    const roster = await currentRosterDisplay(this.table, workspace.roster);
    const names = new Map(roster.map((entry) => [entry.playerId, entry.displayName]));
    return { ...workspace, roster, rounds: workspace.rounds.map((round) => ({
      ...round, players: round.players.map((entry) => {
        const displayName = names.get(entry.playerId);
        if (displayName === undefined) throw new ApiError(503, 'INVALID_STORED_WORKSPACE');
        return { ...entry, displayName };
      }),
    })) };
  }

  /** Server-only captured inputs; public readers receive get()'s explicit privacy projection. */
  async getForScoring(identity: ScoreActor, id: string): Promise<EventWorkspace> {
    const access = await this.access(identity, id);
    if (access.summary.role !== 'owner' && !access.admittedPlayer && !access.testerLink && !access.publicAccess) throw new ApiError(403, 'SCORES_OWNER_REQUIRED');
    const workspace = await this.load(access.summary);
    await assertEventAccessUnchanged(this.table, identity, id, access);
    return workspace;
  }

  private async correctionState(identity: AccountIdentity, eventId: string, roundId: string) {
    const access = await this.ownerAccess(identity, eventId);
    if (access.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    const workspace = await this.load(access.summary, false);
    const round = workspace.rounds.find((entry) => entry.id === roundId);
    if (!round) throw new ApiError(404, 'ROUND_NOT_FOUND');
    if (!round.scoringStarted) throw new ApiError(409, 'ROUND_SCORING_NOT_STARTED');
    const roundRow = await optionalRow(this.table, eventId, `round:${roundId}`);
    if (!roundRow) throw new ApiError(503, 'INVALID_STORED_WORKSPACE');
    const lock = await scoringLock(this.table, eventId, roundId);
    if (!lock) throw new ApiError(503, 'INVALID_STORED_SCORE_LOCK');
    const configuredRounds = configuredGameRounds(access.event.gameRoundIds);
    const games = await readGameConfiguration(this.table, eventId, roundId, configuredRounds);
    return { access, workspace, round, roundRow, games, lock };
  }

  private reviewWarnings(before: RoundSnapshot, after: RoundSnapshot, gamesChanged: boolean, churchyPresent: boolean): readonly RoundReviewWarning[] {
    const warnings: RoundReviewWarning[] = [];
    if (kpCaptureIdentity(before) !== kpCaptureIdentity(after)) warnings.push({
      code: 'kp-review-required',
      message: 'KP context changed; review tied decisions and reopen KP explicitly if needed.',
    });
    if (gamesChanged) warnings.push({
      code: 'team-review-required',
      message: 'Competition team assignments changed; review game team standings.',
    });
    if (churchyPresent && (gamesChanged || canonical(before.players) !== canonical(after.players)
      || canonical(before.groups) !== canonical(after.groups)
      || before.teeProfile.id !== after.teeProfile.id
      || canonical(before.playerTees ?? []) !== canonical(after.playerTees ?? []))) warnings.push({
      code: 'churchy-review-required',
      message: 'Churchy inputs changed; review Churchy results and pending settlements.',
    });
    if (warnings.some((warning) => warning.code !== 'kp-review-required')
      || canonical(before.players) !== canonical(after.players)
      || before.teeProfile.id !== after.teeProfile.id
      || canonical(before.playerTees ?? []) !== canonical(after.playerTees ?? [])) warnings.push({
      code: 'purse-review-required',
      message: 'Corrected inputs may change payouts; review purse and unresolved decisions.',
    });
    return warnings;
  }

  async refreshPlayerIndex(
    identity: AccountIdentity, eventId: string, playerId: string, observationId: string,
    etag: string, requestId: string, chargeRound?: () => Promise<void>, wolfOrders = true, dotsHighLow = true, dotsRulesV3 = true,
  ): Promise<EventHandicapRefreshResult> {
    requireManager(identity, this.allowed);
    if (!isUuid(identity.tenantId) || !isUuid(identity.objectId)
      || !isUuid(eventId) || !isUuid(playerId) || !isUuid(observationId) || !isUuid(requestId)
      || !isEventRevision(etag)) throw new ApiError(400, 'INVALID_PLAYER_INDEX_REFRESH');
    const access = await readPublicAccess(this.table, { kind: 'public-score', eventId }, eventId);
    if (access.event.quickRound === true && access.event.quickRoundReady !== true) {
      throw new ApiError(403, 'PUBLIC_EVENT_NOT_AVAILABLE');
    }
    if (!wolfOrders || !dotsHighLow || !dotsRulesV3 || !clientSupportsAllNinesRules()) {
      const currentWorkspace = await this.load(access.summary, false, chargeRound);
      for (const round of currentWorkspace.rounds.filter((round) => round.scoringStarted
        && round.players.some((player) => player.playerId === playerId))) {
        const games = await readGameConfiguration(this.table, eventId, round.id, configuredGameRounds(access.event.gameRoundIds));
        requireDotsRulesV3(games?.games ?? [], dotsRulesV3);
        requireNinesSupport(games?.games ?? []);
        requireWolfOrders(games?.games ?? [], wolfOrders);
        requireDotsHighLow(games?.games ?? [], dotsHighLow);
      }
    }
    const replay = () => playerIndexRefreshReplay(this.table, identity, eventId, playerId, observationId, etag, requestId);
    const previous = await replay();
    if (previous) return acknowledgePlayerIndexRefresh(this.table, previous);
    if (access.summary.etag !== etag) throw new ApiError(409, 'EVENT_CHANGED');
    const workspace = await this.load(access.summary, false, chargeRound);
    if (!workspace.roster.some((player) => player.playerId === playerId)) throw new ApiError(404, 'PLAYER_NOT_IN_EVENT');
    const current = await this.players.get(identity, playerId);
    if (current.currentIndex?.id !== observationId) throw new ApiError(409, 'PLAYER_INDEX_CHANGED');
    const recordedAt = new Date().toISOString();
    const updatedRoundIds: string[] = [];
    const completedRoundIds: string[] = [];
    const corrections: RoundCorrectionReceipt[] = [];
    const actions: TransactionAction[] = [
      ['update', { partitionKey: eventId, rowKey: 'event', playerIndexUpdatedAt: recordedAt }, 'Merge', { etag }],
    ];
    for (const round of workspace.rounds) {
      const selected = round.players.find((player) => player.playerId === playerId);
      if (!selected || !round.scoringStarted) continue;
      const lock = await scoringLock(this.table, eventId, round.id);
      if (!lock) throw new ApiError(503, 'INVALID_STORED_SCORE_LOCK');
      await validateRefreshCapture(this.table, eventId, round, lock);
      const cards = await correctionAuditCards(this.table, eventId, round, lock);
      if (cards.every((card) => card.holes.every((hole) => hole.score.kind !== 'unplayed'))) {
        completedRoundIds.push(round.id);
        continue;
      }
      if (sameIndexValue(selected.handicapIndex?.value, current.currentIndex.value)) continue;
      if (round.inputRevision === requestId) throw new ApiError(409, 'PLAYER_INDEX_REFRESH_REQUEST_CONFLICT');
      const row = await optionalRow(this.table, eventId, `round:${round.id}`);
      if (!row) throw new ApiError(503, 'INVALID_STORED_WORKSPACE');
      const games = await readGameConfiguration(this.table, eventId, round.id, configuredGameRounds(access.event.gameRoundIds));
      const updated: RoundSnapshot = { ...round, inputRevision: requestId,
        players: round.players.map((player) => player.playerId === playerId
          ? { ...player, handicapIndex: current.currentIndex } : player) };
      const warnings = [...(round.reviewWarnings ?? [])];
      for (const warning of this.reviewWarnings(round, updated, false, games?.games.some((game) => game.kind === 'churchy') ?? false)) {
        if (!warnings.some((previousWarning) => previousWarning.code === warning.code)) warnings.push(warning);
      }
      const after: RoundSnapshot = { ...updated, reviewWarnings: warnings };
      const dotAwardAudit = buildDotAwardAudit(games?.games ?? [], round, after, cards, cards, games?.etag ?? null);
      corrections.push({
        id: requestId, eventId, roundId: round.id,
        expected: { eventEtag: etag, roundEtag: revision(row), gamesEtag: games?.etag ?? null,
          inputRevision: round.inputRevision ?? null },
        before: correctionInput(round, games?.games), after: correctionInput(after, games?.games),
        reason: 'Apply the acknowledged catalog Handicap Index to an unfinished round.',
        warnings, recordedAt, recordedBy: { tenantId: identity.tenantId, objectId: identity.objectId },
        ...(dotAwardAudit.length ? { dotAwardAudit } : {}),
      });
      updatedRoundIds.push(round.id);
      actions.push(['update', { partitionKey: eventId, rowKey: `round:${round.id}`,
        content: await stagePrivateContent(this.table, eventId, `round:${round.id}`, identity, canonical(after)) },
      'Merge', { etag: revision(row) }]);
    }
    const receipt: PlayerIndexRefreshReceipt = { id: requestId, eventId, playerId, observationId, expectedEtag: etag,
      recordedAt, recordedBy: { tenantId: identity.tenantId, objectId: identity.objectId },
      updatedRoundIds, completedRoundIds, corrections };
    const key = playerIndexRefreshKey(requestId);
    actions.push(['create', { partitionKey: eventId, rowKey: key, kind: 'player-index-refresh',
      content: await stagePrivateContent(this.table, eventId, key, identity, canonical(receipt)) }]);
    requireManager(identity, this.allowed);
    try { await this.table.submitTransaction(actions); }
    catch (error) {
      requireManager(identity, this.allowed);
      const committed = await replay();
      if (committed) return acknowledgePlayerIndexRefresh(this.table, committed);
      if (isConflict(error)) throw new ApiError(409, 'EVENT_CHANGED');
      throw error;
    }
    return acknowledgePlayerIndexRefresh(this.table, receipt);
  }

  async correctionModel(identity: AccountIdentity, eventId: string, roundId: string): Promise<RoundCorrectionReadModel> {
    const state = await this.correctionState(identity, eventId, roundId);
    const version = await this.courses.readCapturedVersion(state.round.courseId, state.round.courseVersionId);
    const compatibleTees = version.data.teeProfiles.flatMap((tee) => {
      const selected = roundTee(tee, state.round.roundSide);
      return selected && compatibleTeeLayouts(state.round.teeProfile, selected) ? [selected] : [];
    });
    const ids = new Set(state.round.players.map((player) => player.playerId));
    const gameTeams = state.games?.games.flatMap((game) => isTeamGameDefinition(game)
      ? [{ gameId: game.id, teams: game.teams.map((team) => ({ id: team.id, name: team.name, playerIds: team.playerIds })) }] : []) ?? [];
    const warnings = state.round.reviewWarnings ?? [];
    return {
      eventId,
      roundId,
      eventEtag: state.access.summary.etag,
      roundEtag: revision(state.roundRow),
      ...(state.games ? { gamesEtag: state.games.etag } : {}),
      ...(state.round.inputRevision ? { inputRevision: state.round.inputRevision } : {}),
      allowPerGolferTees: state.workspace.allowPerGolferTees === true,
      teeProfileId: state.round.teeProfile.id,
      compatibleTees,
      players: state.round.players.map((player) => ({ playerId: player.playerId, displayName: player.displayName, handicapIndex: player.handicapIndex ?? null })),
      playerTeeSelections: (state.round.playerTees ?? []).map((entry) => ({ playerId: entry.playerId, teeProfileId: entry.profile.id }))
        .filter((entry) => ids.has(entry.playerId)),
      groups: state.round.groups,
      gameTeams,
      warnings,
    };
  }

  async correctRound(identity: AccountIdentity, eventId: string, roundId: string,
    requestId: string, body: RoundCorrectionWriteRequest, gameCalculations = true, wolfOrders = true, dotsHighLow = true, dotsRulesV3 = true): Promise<RoundCorrectionWriteResult> {
    if (!isUuid(requestId) || !isRoundCorrectionWriteRequest(body)) throw new ApiError(400, 'INVALID_ROUND_CORRECTION');
    const state = await this.correctionState(identity, eventId, roundId);
    requireWolfOrders(state.games?.games ?? [], wolfOrders);
    requireDotsRulesV3(state.games?.games ?? [], dotsRulesV3);
    requireNinesSupport(state.games?.games ?? []);
    requireDotsHighLow(state.games?.games ?? [], dotsHighLow);
    const replayKey = `round-correction:${roundId}:${requestId}`;
    const replay = await optionalRow(this.table, eventId, replayKey);
    if (replay) {
      const saved = decode(await privateContent(this.table, eventId, replayKey, replay.content), isRecord);
      if (!isRecord(saved) || !isRoundCorrectionWriteRequest(saved.request) || saved.request.reason !== body.reason
        || canonical(saved.request.expected) !== canonical(body.expected)
        || canonical(saved.request.correction) !== canonical(body.correction)) {
        throw new ApiError(409, 'ROUND_CORRECTION_REQUEST_CONFLICT');
      }
      return { applied: false, receiptId: requestId, model: await this.correctionModel(identity, eventId, roundId) };
    }
    if (body.expected.eventEtag !== state.access.summary.etag) throw new ApiError(409, 'EVENT_CHANGED');
    const currentRoundEtag = revision(state.roundRow);
    if (body.expected.roundEtag !== currentRoundEtag) throw new ApiError(409, 'ROUND_CHANGED');
    if ((body.expected.gamesEtag ?? null) !== (state.games?.etag ?? null)) throw new ApiError(409, 'GAMES_CHANGED');
    if ((body.expected.inputRevision ?? null) !== (state.round.inputRevision ?? null)) throw new ApiError(409, 'ROUND_INPUTS_CHANGED');
    const version = await this.courses.readCapturedVersion(state.round.courseId, state.round.courseVersionId);
    const byTee = new Map(version.data.teeProfiles.flatMap((tee) => {
      const selected = roundTee(tee, state.round.roundSide);
      return selected ? [[selected.id, selected] as const] : [];
    }));
    const teeProfile = byTee.get(body.correction.teeProfileId);
    if (!teeProfile || !compatibleTeeLayouts(state.round.teeProfile, teeProfile)) throw new ApiError(400, 'INCOMPATIBLE_TEE_PROFILE');
    const roster = state.round.players.map((player) => player.playerId);
    if (canonical([...body.correction.players].map((entry) => entry.playerId).sort())
      !== canonical([...roster].sort())) throw new ApiError(400, 'ROUND_ROSTER_FIXED');
    const grouped = body.correction.groups.flatMap((group) => group.playerIds);
    if (grouped.length !== roster.length || canonical([...grouped].sort()) !== canonical([...roster].sort())) {
      throw new ApiError(400, 'INVALID_ROUND_GROUPS');
    }
    const selections = body.correction.playerTeeSelections ?? [];
    if (selections.some((entry) => !roster.includes(entry.playerId))) throw new ApiError(400, 'INVALID_ROUND_TEE_SELECTION');
    const playerTees: PlayerTeeProfile[] = [];
    for (const selection of selections) {
      const selected = byTee.get(selection.teeProfileId);
      if (!selected || !compatibleTeeLayouts(teeProfile, selected)) throw new ApiError(400, 'INCOMPATIBLE_PLAYER_TEE');
      if (selected.id !== teeProfile.id) playerTees.push({ playerId: selection.playerId, profile: profile(selected) });
    }
    const playersById = new Map(body.correction.players.map((entry) => [entry.playerId, entry.handicapIndexValue]));
    const recordedAt = new Date().toISOString();
    const effectiveDate = recordedAt.slice(0, 10);
    const sourcePrefix = 'Organizer correction: ';
    const correctionSource = `${sourcePrefix}${body.reason}`.slice(0, 200);
    const updatedRound: RoundSnapshot = {
      ...state.round,
      teeProfile: profile(teeProfile),
      groups: body.correction.groups.map((group) => ({ number: group.number, playerIds: [...group.playerIds],
        ...(group.startingHole === undefined ? {} : { startingHole: group.startingHole }) })),
      players: state.round.players.map((player) => {
        const nextValue = playersById.get(player.playerId);
        if (nextValue === undefined) return player;
        if (nextValue === null) return player.handicapIndex === null ? player : { ...player, handicapIndex: null };
        if (!isHandicapIndex(nextValue)) throw new ApiError(400, 'INVALID_ROUND_CORRECTION');
        if (player.handicapIndex?.value === nextValue) return player;
        return {
          ...player,
          handicapIndex: {
            id: randomUUID(),
            value: nextValue,
            effectiveDate,
            source: correctionSource,
            recordedAt,
            recordedBy: { tenantId: identity.tenantId, objectId: identity.objectId },
            previousObservationId: player.handicapIndex?.id ?? null,
          },
        };
      }),
      ...(body.correction.playerTeeSelections === undefined ? {} : { playerTees }),
      inputRevision: requestId,
    };
    if (!isRecord(updatedRound) || !isEventWorkspace({ ...state.workspace, rounds: state.workspace.rounds.map((round) =>
      round.id === roundId ? updatedRound : round) })) throw new ApiError(503, 'INVALID_STORED_WORKSPACE');
    for (const game of state.games?.games ?? []) {
      if (game.kind !== 'nassau' && game.kind !== 'match-play' && game.kind !== 'wolf' && game.kind !== 'dots') continue;
      const beforeGroup = state.round.groups.find((group) => group.number === game.groupNumber);
      const afterGroup = updatedRound.groups.find((group) => group.number === game.groupNumber);
      if (beforeGroup?.playerIds[0] !== afterGroup?.playerIds[0]
        || game.kind === 'match-play'
          && groupStartingHole(beforeGroup, state.round.teeProfile.holes) !== groupStartingHole(afterGroup, updatedRound.teeProfile.holes)
        || (game.kind === 'nassau' || game.kind === 'match-play' ? nassauConfigurationIssues(game, updatedRound).length > 0
          : (game.kind === 'dots' ? !dotsDefinitionMatchesRound(game, dotRound(updatedRound, definitionCards(updatedRound)))
            : !wolfGroupMatchesRound(game, { layout: updatedRound.teeProfile.holes, groups: updatedRound.groups }))
            || groupStartingHole(beforeGroup, state.round.teeProfile.holes) !== groupStartingHole(afterGroup, updatedRound.teeProfile.holes))) {
        throw new ApiError(409, 'MATCH_SETUP_CHANGED');
      }
    }
    if (state.games?.games.some(hasGameHandicapRules) && state.round.players.some((player) => {
      const before = state.round.groups.find((group) => group.playerIds.includes(player.playerId));
      const after = updatedRound.groups.find((group) => group.playerIds.includes(player.playerId));
      return (before?.startingHole ?? state.round.teeProfile.holes[0]?.number)
        !== (after?.startingHole ?? updatedRound.teeProfile.holes[0]?.number);
    })) throw new ApiError(409, 'GAME_START_SETUP_LOCKED');
    if (state.games?.games.some((game) => game.kind === 'skins' && game.carryovers && game.carryOrder === 'shared-group-v1')
      && !skinsCarryCircuit(updatedRound.teeProfile.holes.map((hole) => hole.number), updatedRound.groups, roster)) {
      throw new ApiError(400, 'SKINS_FOURSOME_REQUIRED');
    }
    const churchyGames = state.games?.games.filter((game) => game.kind === 'churchy') ?? [];
    for (const churchy of churchyGames) {
      const group = updatedRound.groups.find((entry) => entry.number === churchy.groupNumber);
      if (!group || group.playerIds.length !== 4 || (churchy.version === 3
        ? !group.playerIds.every((id) => churchy.playerIds.includes(id))
        : group.playerIds.some((id, index) => id !== churchy.playerIds[index]))) {
        throw new ApiError(409, 'CHURCHY_SETUP_CHANGED');
      }
    }
    let updatedGames = state.games?.games ?? [];
    let gamesChanged = false;
    if (state.games && body.correction.gameTeams) {
      const updates = new Map(body.correction.gameTeams.map((entry) => [entry.gameId, entry.teams]));
      updatedGames = state.games.games.map((game) => {
        const teams = updates.get(game.id);
        if (!teams) return game;
        if (!isTeamGameDefinition(game)) throw new ApiError(400, 'INVALID_GAME_TEAMS');
        const updated = { ...game, teams };
        if (!gameTeamsMatchRoster(updated, roster)) throw new ApiError(400, 'INVALID_GAME_TEAMS');
        gamesChanged ||= canonical(game.teams) !== canonical(teams);
        return updated;
      });
      if (!isRoundGameDefinitions(updatedGames)) throw new ApiError(400, 'INVALID_GAME_TEAMS');
      if ([...updates.keys()].some((gameId) => !updatedGames.some((game) => game.id === gameId && isTeamGameDefinition(game)))) {
        throw new ApiError(400, 'INVALID_GAME_TEAMS');
      }
    }
    const warnings = this.reviewWarnings(state.round, updatedRound, gamesChanged, churchyGames.length > 0);
    const withWarnings: RoundSnapshot = { ...updatedRound, ...(warnings.length ? { reviewWarnings: warnings } : { reviewWarnings: [] }) };
    const before = correctionInput(state.round, state.games?.games);
    const after = correctionInput(withWarnings, updatedGames);
    if (canonical(before) === canonical(after) && warnings.length === (state.round.reviewWarnings?.length ?? 0)) {
      return { applied: false, model: await this.correctionModel(identity, eventId, roundId) };
    }
    const auditCards = state.games?.games.some(supportsDotAwardAudit)
      ? await correctionAuditCards(this.table, eventId, state.round, state.lock) : [];
    const dotAwardAudit = buildDotAwardAudit(updatedGames, state.round, withWarnings,
      auditCards, auditCards, state.games?.etag ?? null);
    if (!gameCalculations) {
      for (const round of [state.round, withWarnings]) requireGameCalculations({
        cards: auditCards, layout: round.teeProfile.holes, groups: round.groups,
        courseHandicaps: publishedCourseHandicaps(round),
        ...(state.games ? { games: { configuration: { ...state.games, games: updatedGames },
          results: calculateGameResults(updatedGames, round, auditCards) } } : {}),
      }, false, updatedGames, true);
    }
    const receipt: RoundCorrectionReceipt = {
      id: requestId, eventId, roundId, expected: body.expected, before, after, reason: body.reason,
      ...(body.reviewSummary ? { reviewSummary: body.reviewSummary } : {}),
      warnings, recordedAt,
      recordedBy: { tenantId: identity.tenantId, objectId: identity.objectId },
      ...(dotAwardAudit.length ? { dotAwardAudit } : {}),
    };
    const roundContent = await stagePrivateContent(this.table, eventId, `round:${roundId}`, identity, canonical(withWarnings));
    const actions: TransactionAction[] = [
      ['update', { partitionKey: eventId, rowKey: 'event', correctionsUpdatedAt: receipt.recordedAt }, 'Merge', { etag: state.access.summary.etag }],
      ['update', { partitionKey: eventId, rowKey: `member:${identity.objectId}`,
        tenantId: identity.tenantId, objectId: identity.objectId, role: 'owner' }, 'Merge', { etag: revision(state.access.member) }],
      ['update', { partitionKey: eventId, rowKey: `round:${roundId}`, content: roundContent }, 'Merge', { etag: currentRoundEtag }],
      ['create', { partitionKey: eventId, rowKey: replayKey,
        content: await stagePrivateContent(this.table, eventId, replayKey, identity, canonical({ request: body, receipt })) }],
    ];
    if (state.games && canonical(updatedGames) !== canonical(state.games.games)) {
      if (state.games.etag === null) throw new ApiError(503, 'INVALID_STORED_GAMES');
      actions.push(['update', { partitionKey: eventId, rowKey: `round-games:${roundId}`, kind: 'round-games', schemaVersion: 1,
        content: await stagePrivateContent(this.table, eventId, `round-games:${roundId}`, identity,
          canonical({ eventId, roundId, games: updatedGames })) }, 'Replace', { etag: state.games.etag }]);
    }
    await transaction(this.table, actions, 'ROUND_CORRECTION_CONFLICT');
    return { applied: true, receiptId: requestId, model: await this.correctionModel(identity, eventId, roundId) };
  }

  private async refreshReplay(identity: AccountIdentity, eventId: string, roundId: string, requestId: string, etag: string): Promise<boolean> {
    const row = await optionalRow(this.table, eventId, `index-refresh:${requestId}`);
    if (!row) return false;
    const audit = decode(await privateContent(this.table, eventId, `index-refresh:${requestId}`, row.content), isIndexRefreshAudit);
    if (audit.eventId !== eventId || audit.roundId !== roundId || audit.requestId !== requestId
      || audit.expectedEtag !== etag || audit.recordedBy.tenantId !== identity.tenantId
      || audit.recordedBy.objectId !== identity.objectId) throw new ApiError(409, 'INDEX_REFRESH_REQUEST_CONFLICT');
    return true;
  }

  async refreshIndices(identity: AccountIdentity, eventId: string, roundId: string, requestId: string, etag: string, wolfOrders = true, dotsHighLow = true, dotsRulesV3 = true): Promise<EventWorkspace> {
    const access = await this.ownerAccess(identity, eventId);
    if (access.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    requireManager(identity, this.allowed);
    if (!wolfOrders || !dotsHighLow || !dotsRulesV3 || !clientSupportsAllNinesRules()) {
      const games = await readGameConfiguration(this.table, eventId, roundId, configuredGameRounds(access.event.gameRoundIds));
      requireDotsRulesV3(games?.games ?? [], dotsRulesV3);
      requireNinesSupport(games?.games ?? []);
      requireWolfOrders(games?.games ?? [], wolfOrders);
      requireDotsHighLow(games?.games ?? [], dotsHighLow);
    }
    if (await scoringLock(this.table, eventId, roundId)) throw new ApiError(409, 'ROUND_SCORING_STARTED');
    if (await this.refreshReplay(identity, eventId, roundId, requestId, etag)) {
      const current = await this.get(identity, eventId);
      if (current.rounds.find((round) => round.id === roundId)?.scoringStarted) throw new ApiError(409, 'ROUND_SCORING_STARTED');
      return current;
    }
    if (access.summary.etag !== etag) throw new ApiError(409, 'EVENT_CHANGED');
    const workspace = await this.load(access.summary, false);
    const round = workspace.rounds.find((entry) => entry.id === roundId);
    if (!round) throw new ApiError(404, 'ROUND_NOT_FOUND');
    if (round.scoringStarted) throw new ApiError(409, 'ROUND_SCORING_STARTED');
    const profiles = await this.profiles(identity, round.players.map((entry) => entry.playerId));
    const updated: RoundSnapshot = {
      ...round,
      players: round.players.map((entry, index) => {
        const current = profiles[index];
        if (!current || current.id !== entry.playerId) throw new ApiError(503, 'INVALID_STORED_CATALOG');
        return { playerId: entry.playerId, displayName: entry.displayName, handicapIndex: current.currentIndex };
      }),
    };
    const recordedAt = new Date().toISOString();
    const audit: IndexRefreshAudit = {
      eventId, roundId, requestId, expectedEtag: etag, recordedAt,
      recordedBy: { tenantId: identity.tenantId, objectId: identity.objectId },
      previous: round.players.map((entry) => ({ playerId: entry.playerId, handicapIndex: entry.handicapIndex ?? null })),
      updated: updated.players.map((entry) => ({ playerId: entry.playerId, handicapIndex: entry.handicapIndex ?? null })),
    };
    const updatedContent = await stagePrivateContent(this.table, eventId, `round:${roundId}`, identity, canonical(updated));
    const auditContent = await stagePrivateContent(this.table, eventId, `index-refresh:${requestId}`, identity, canonical(audit));
    try {
      await this.table.submitTransaction([
        ['update', { partitionKey: eventId, rowKey: 'event', indicesRefreshedAt: recordedAt }, 'Merge', { etag }],
        ['update', {
          partitionKey: eventId, rowKey: `member:${identity.objectId}`, tenantId: identity.tenantId, objectId: identity.objectId, role: 'owner',
        }, 'Merge', { etag: revision(access.member) }],
        ['update', { partitionKey: eventId, rowKey: `round:${roundId}`, content: updatedContent }, 'Merge'],
        ['create', { partitionKey: eventId, rowKey: `index-refresh:${requestId}`, content: auditContent }],
      ]);
    } catch (error) {
      if (!isConflict(error)) throw error;
      if (!await this.refreshReplay(identity, eventId, roundId, requestId, etag)) throw new ApiError(409, 'EVENT_CHANGED');
    }
    const current = await this.get(identity, eventId);
    if (current.rounds.find((round) => round.id === roundId)?.scoringStarted) throw new ApiError(409, 'ROUND_SCORING_STARTED');
    return current;
  }

  /**
   * Older browsers cannot see Nines, so they may not change setup for an event that has it.
   * Browsers that understand Nines skip this, so it costs them no reads.
   */
  async requireNinesClientForEvent(eventId: string): Promise<void> {
    if (clientSupportsAllNinesRules()) return;
    const event = await optionalRow(this.table, eventId, 'event');
    const roundIds = configuredGameRounds(event?.gameRoundIds);
    for (const roundId of roundIds) {
      const games = await readGameConfiguration(this.table, eventId, roundId, roundIds);
      requireNinesSupport(games?.games ?? []);
    }
  }

  async receive(identity: AccountIdentity, id: string, body: unknown, etag: string) {
    const access = await this.ownerAccess(identity, id);
    if (access.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    requireManager(identity, this.allowed);
    await this.requireNinesClientForEvent(id);
    // A client may retry all immutable parts after losing the final response.
    if (access.summary.etag !== etag) {
      const upload = isRecord(body) ? body.privateUpload ?? body.privateCommit : undefined;
      if (!isPrivateUpload(upload)) throw new ApiError(409, 'EVENT_CHANGED');
      const key = `setup-receipt:${upload.id}`;
      const row = await optionalRow(this.table, id, key);
      if (!row) throw new ApiError(409, 'EVENT_CHANGED');
      const receipt = decode(await privateContent(this.table, id, key, row.content), isRecord);
      if (receipt.etag !== etag || receipt.sha256 !== upload.sha256 || !isRecord(receipt.identity)
        || receipt.identity.tenantId !== identity.tenantId || receipt.identity.objectId !== identity.objectId) {
        throw new ApiError(409, 'PRIVATE_UPLOAD_CONFLICT');
      }
    }
    return receivePrivateWrite(this.table, identity, id, 'workspace', etag, null, body);
  }

  async save(identity: AccountIdentity | PublicScoreIdentity,
    id: string, input: EventSetupInput, etag: string, publication?: StagedPublication): Promise<EventWorkspace> {
    const publicQuick = 'kind' in identity;
    const access = await this.access(identity, id);
    if (publicQuick) {
      if (!access.publicAccess || access.event.quickRound !== true || !publication) throw new ApiError(403, 'QUICK_ROUND_MANAGEMENT_FORBIDDEN');
    } else {
      if (access.summary.role !== 'owner' || !access.member) throw new ApiError(403, 'EVENT_MANAGEMENT_FORBIDDEN');
      requireManager(identity, this.allowed);
    }
    if (access.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    await this.requireNinesClientForEvent(id);
    const receiptKey = publication ? `setup-receipt:${publication.id}` : undefined;
    const receipt = publication ? canonical({ identity, etag, sha256: publication.sha256, input }) : undefined;
    if (receiptKey) {
      const saved = await optionalRow(this.table, id, receiptKey);
      if (saved) {
        if (await privateContent(this.table, id, receiptKey, saved.content) !== receipt) throw new ApiError(409, 'PRIVATE_UPLOAD_CONFLICT');
        return this.get(identity, id);
      }
    }
    if (access.summary.etag !== etag) throw new ApiError(409, 'EVENT_CHANGED');
    if (!isEventSetupInput(input)) throw new ApiError(400, 'INVALID_EVENT_SETUP');
    if (publicQuick && (input.rounds.length !== 1 || input.overallCompetition !== undefined
      && input.overallCompetition !== null)) throw new ApiError(400, 'INVALID_QUICK_ROUND_SETUP');
    const effectiveStartDate = input.startDate ?? access.summary.startDate;
    const effectiveEndDate = input.endDate ?? access.summary.endDate;
    if (effectiveStartDate && effectiveEndDate && effectiveEndDate < effectiveStartDate) throw new ApiError(400, 'INVALID_EVENT_DATE_RANGE');
    if (Buffer.byteLength(JSON.stringify(input), 'utf8') > maximumPrivateWriteBytes) throw new ApiError(413, 'REQUEST_TOO_LARGE');
    const previous = await this.load(access.summary);
    const allowPerGolferTees = input.allowPerGolferTees ?? previous.allowPerGolferTees;
    const eventSkins = previous.eventSkins;
    const overallCompetition = input.overallCompetition === undefined
      ? previous.overallCompetition : input.overallCompetition ?? undefined;
    if (overallCompetition?.kind === 'stableford') {
      for (const binding of overallCompetition.roundGames) {
        if (!input.rounds.some((round) => round.id === binding.roundId)) throw new ApiError(400, 'INVALID_OVERALL_ROUND');
        const games = await readGameConfiguration(this.table, id, binding.roundId, configuredGameRounds(access.event.gameRoundIds));
        if (!games?.games.some((game) => game.id === binding.gameId && (game.kind === undefined || game.kind === 'stableford'))) {
          throw new ApiError(400, 'INVALID_OVERALL_GAME');
        }
      }
    }
    if (previous.rounds.some((round) => !input.rounds.some((configured) => configured.id === round.id))) {
      throw new ApiError(409, 'ROUND_REMOVAL_NOT_SUPPORTED');
    }
    const locked = previous.rounds.filter((round) => round.scoringStarted);
    if (allowPerGolferTees !== true && locked.some((round) => round.playerTees?.length)) {
      throw new ApiError(409, 'PER_GOLFER_TEES_LOCKED');
    }
    if (locked.length && canonical(input.playerIds) !== canonical(previous.roster.map((player) => player.playerId))) {
      throw new ApiError(409, 'ROUND_SCORING_STARTED');
    }
    for (const saved of locked) {
      const requested = input.rounds.find((round) => round.id === saved.id);
      if (!requested || requested.name !== saved.name || requested.courseId !== saved.courseId
        || requested.courseVersionId !== saved.courseVersionId || requested.teeProfileId !== saved.teeProfile.id
        || (requested.roundSide ?? saved.roundSide ?? 'full') !== (saved.roundSide ?? 'full')
        || canonical(requested.groups.map((group) => ({
          ...group, startingHole: group.startingHole ?? saved.teeProfile.holes[0]?.number,
        }))) !== canonical(saved.groups.map((group) => ({
          ...group, startingHole: group.startingHole ?? saved.teeProfile.holes[0]?.number,
        })))
        || requested.playerTeeSelections !== undefined && !sameTeeSelections(requested.playerTeeSelections,
          saved.playerTees?.map((entry) => ({ playerId: entry.playerId, teeProfileId: entry.profile.id })), saved.teeProfile.id)) {
        throw new ApiError(409, 'ROUND_SCORING_STARTED');
      }
    }
    const profiles = publicQuick ? await currentRosterProfiles(this.table, input.playerIds) : await this.profiles(identity, input.playerIds);
    const previousRoster = new Map(previous.roster.map((player) => [player.playerId, player]));
    const roster = profiles.map((player) => ({
      playerId: player.id,
      displayName: previousRoster.get(player.id)?.displayName ?? player.displayName,
    }));
    const rounds: RoundSnapshot[] = [];
    const rosterIds = new Set(input.playerIds);
    for (const round of input.rounds) {
      const oldRound = previous.rounds.find((existing) => existing.id === round.id);
      const teeTime = round.teeTime === undefined ? oldRound?.teeTime : round.teeTime || undefined;
      const startDate = round.startDate === undefined ? oldRound?.startDate : round.startDate || undefined;
      const lockedRound = locked.find((existing) => existing.id === round.id);
      if (lockedRound) {
        const { teeTime: _previousTime, startDate: _previousDate, ...capture } = lockedRound;
        void _previousTime;
        void _previousDate;
        rounds.push({ ...capture, ...(teeTime === undefined ? {} : { teeTime }), ...(startDate === undefined ? {} : { startDate }) });
        continue;
      }
      const version = publicQuick ? await this.courses.readCapturedVersion(round.courseId, round.courseVersionId)
        : await this.courses.getVersion(identity, round.courseId, round.courseVersionId);
      const sourceTee = version.data.teeProfiles.find((tee) => tee.id === round.teeProfileId);
      const roundSide = round.roundSide ?? oldRound?.roundSide ?? 'full';
      const teeProfile = sourceTee && roundTee(sourceTee, roundSide);
      if (!teeProfile) throw new ApiError(400, 'TEE_PROFILE_NOT_FOUND');
      if (configuredGameRounds(access.event.gameRoundIds).includes(round.id)) {
        const games = await readGameConfiguration(this.table, id, round.id, configuredGameRounds(access.event.gameRoundIds));
        if (games?.games.some((game) => game.kind === 'skins' && game.carryovers && game.carryOrder === 'shared-group-v1')
          && !skinsCarryCircuit(teeProfile.holes.map((hole) => hole.number), round.groups, input.playerIds)) {
          throw new ApiError(400, 'SKINS_FOURSOME_REQUIRED');
        }
        if (teeProfile.holeCount === 9
          && games?.games.some((game) => game.kind === 'nassau')) throw new ApiError(400, 'NASSAU_REQUIRES_EIGHTEEN_HOLES');
      }
      if (round.groups.some((group) => group.startingHole !== undefined
        && !teeProfile.holes.some((hole) => hole.number === group.startingHole))) {
        throw new ApiError(400, 'INVALID_GROUP_STARTING_HOLE');
      }
      if (allowPerGolferTees === true && round.playerTeeSelections === undefined && oldRound?.playerTees?.length
        && (oldRound.courseId !== round.courseId || oldRound.courseVersionId !== round.courseVersionId)) {
        throw new ApiError(409, 'TEE_SELECTION_REVIEW_REQUIRED');
      }
      const selections = allowPerGolferTees === true ? round.playerTeeSelections
        ?? oldRound?.playerTees?.filter((entry) => rosterIds.has(entry.playerId))
          .map((entry) => ({ playerId: entry.playerId, teeProfileId: entry.profile.id })) ?? [] : [];
      if (allowPerGolferTees !== true && round.playerTeeSelections?.some((entry) => entry.teeProfileId !== teeProfile.id)) {
        throw new ApiError(400, 'PER_GOLFER_TEES_DISABLED');
      }
      const availableTees = new Map(version.data.teeProfiles.flatMap((tee) => {
        const selected = roundTee(tee, roundSide);
        return selected ? [[selected.id, selected] as const] : [];
      }));
      const playerTees: PlayerTeeProfile[] = [];
      for (const selection of selections) {
        if (selection.teeProfileId === teeProfile.id) continue;
        const selected = availableTees.get(selection.teeProfileId);
        if (!selected || !compatibleTeeLayouts(teeProfile, selected)) throw new ApiError(400, 'INCOMPATIBLE_PLAYER_TEE');
        playerTees.push({ playerId: selection.playerId, profile: profile(selected) });
      }
      const oldPlayers = new Map(oldRound?.players.map((player) => [player.playerId, player]));
      rounds.push({
        id: round.id, name: round.name, courseId: round.courseId, courseVersionId: round.courseVersionId,
        ...(roundSide === 'full' ? {} : { roundSide }),
        ...(teeTime === undefined ? {} : { teeTime }),
        ...(startDate === undefined ? {} : { startDate }),
        course: metadata(version.data), teeProfile,
        ...(playerTees.length ? { playerTees } : {}),
        groups: round.groups.map((group) => ({ number: group.number, playerIds: [...group.playerIds],
          ...(group.startingHole === undefined ? {} : { startingHole: group.startingHole }) })),
        players: profiles.map((player) => {
          const saved = oldPlayers.get(player.id);
          return {
            playerId: player.id, displayName: saved?.displayName ?? player.displayName,
            handicapIndex: player.currentIndex,
          };
        }),
      });
    }
    const header: WorkspaceHeader = { location: input.location, roster, roundIds: rounds.map((round) => round.id),
      ...(allowPerGolferTees === undefined ? {} : { allowPerGolferTees }),
      ...(overallCompetition ? { overallCompetition } : {}),
      ...(eventSkins ? { eventSkins } : {}) };
    const headerContent = await stagePrivateContent(this.table, id, 'workspace', identity, canonical(header));
    const roundContent = new Map<string, string>();
    for (const round of rounds) roundContent.set(round.id, await stagePrivateContent(this.table, id, `round:${round.id}`, identity, canonical(round)));
    const actions: TransactionAction[] = [
      ['update', { partitionKey: id, rowKey: 'event', name: input.name,
        ...(publicQuick ? { quickRoundReady: true } : {}),
        ...(input.startDate === undefined ? {} : { startDate: input.startDate }),
        ...(input.endDate === undefined ? {} : { endDate: input.endDate }) }, 'Merge', { etag }],
      ...(!('kind' in identity) && access.member ? [[
        'update', { partitionKey: id, rowKey: `member:${identity.objectId}`, tenantId: identity.tenantId, objectId: identity.objectId, role: 'owner' },
        'Merge', { etag: revision(access.member) },
      ] satisfies TransactionAction] : []),
      ['upsert', { partitionKey: id, rowKey: 'workspace', content: headerContent }, 'Replace'],
      ...rounds.map((round): TransactionAction => ['upsert', {
        partitionKey: id, rowKey: `round:${round.id}`, content: roundContent.get(round.id),
      }, 'Replace']),
    ];
    if (receiptKey && receipt) actions.push(['create', { partitionKey: id, rowKey: receiptKey,
      content: await stagePrivateContent(this.table, id, receiptKey, identity, receipt) }]);
    if (publicQuick && publication) {
      const key = `quick-setup-change:${publication.id}`;
      const audit = canonical({ eventId: id, requestId: publication.id, expectedEtag: etag,
        recordedAt: new Date().toISOString(), recordedBy: identity, input });
      actions.push(['create', { partitionKey: id, rowKey: key, kind: 'quick-setup-change',
        content: await stagePrivateContent(this.table, id, key, identity, audit) }]);
    }
    try { await transaction(this.table, actions, 'EVENT_CHANGED'); }
    catch (error) {
      if (receiptKey) {
        const saved = await optionalRow(this.table, id, receiptKey);
        if (saved && await privateContent(this.table, id, receiptKey, saved.content) === receipt) return this.get(identity, id);
      }
      throw error;
    }
    return this.get(identity, id);
  }
}
import { nassauConfigurationIssues } from '../../../src/domain/nassau.js';
import { wolfGroupMatchesRound } from '../../../src/domain/wolf.js';
import { groupStartingHole } from '../../../src/domain/round-navigation.js';
