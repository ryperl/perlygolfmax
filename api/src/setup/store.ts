import type { TableClient, TransactionAction } from '@azure/data-tables';
import type { AccountIdentity, EventSummary } from '../../../src/domain/events.js';
import type { PlayerProfile } from '../../../src/domain/catalog.js';
import type { EventRosterPlayer, EventSetupInput, EventWorkspace, OverallCompetition, RoundSnapshot } from '../../../src/domain/setup.js';
import { isPrivateUpload, maximumPrivateWriteBytes } from '../../../src/contracts/private-values.js';
import { isEventSummary, isRecord, isUuid } from '../../../src/contracts/events.js';
import { isEventSetupInput, isEventWorkspace, isOverallCompetition } from '../../../src/contracts/setup.js';
import { ApiError } from '../errors.js';
import { canonical, decode, isConflict, optionalRow, revision, transaction } from '../catalog/entities.js';
import { requireManager } from '../catalog/courses.js';
import type { CatalogPermission, TableCourseCatalog } from '../catalog/courses.js';
import type { TablePlayerCatalog } from '../catalog/players.js';
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

interface WorkspaceHeader {
  readonly location: string;
  readonly roster: readonly EventRosterPlayer[];
  readonly roundIds: readonly string[];
  readonly overallCompetition?: OverallCompetition;
  readonly allowPerGolferTees?: boolean;
}

function isHeader(value: unknown): value is WorkspaceHeader {
  return isRecord(value) && typeof value.location === 'string'
    && (value.allowPerGolferTees === undefined || typeof value.allowPerGolferTees === 'boolean')
    && (value.overallCompetition === undefined || isOverallCompetition(value.overallCompetition))
    && Array.isArray(value.roster) && value.roster.length >= 4
    && value.roster.every((player: unknown) => isRecord(player) && isUuid(player.playerId) && typeof player.displayName === 'string')
    && Array.isArray(value.roundIds) && value.roundIds.length >= 1 && value.roundIds.length <= 8
    && value.roundIds.every(isUuid) && new Set(value.roundIds).size === value.roundIds.length;
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

  private async access(identity: AccountIdentity, id: string) {
    const member = await optionalRow(this.table, id, `member:${identity.objectId}`);
    if (!member || member.tenantId !== identity.tenantId || member.objectId !== identity.objectId) throw new ApiError(404, 'EVENT_NOT_FOUND');
    const event = await optionalRow(this.table, id, 'event');
    if (!event) throw new ApiError(404, 'EVENT_NOT_FOUND');
    const summary: unknown = {
      id, name: event.name, createdAt: event.createdAt, status: event.status === undefined ? 'active' : event.status, role: member.role, etag: revision(event),
    };
    if (!isEventSummary(summary)) throw new ApiError(503, 'INVALID_STORED_EVENT');
    revision(member);
    if (summary.status === 'archived' && summary.role !== 'owner') throw new ApiError(404, 'EVENT_NOT_FOUND');
    return { event, member, summary };
  }

  private async load(summary: EventSummary): Promise<EventWorkspace> {
    const header = await optionalRow(this.table, summary.id, 'workspace');
    if (!header) return { event: summary, location: '', roster: [], rounds: [], etag: summary.etag };
    const saved = decode(await privateContent(this.table, summary.id, 'workspace', header.content), isHeader);
    const rounds: unknown[] = [];
    const locks = new Map<string, ScoringLock>();
    for (const id of saved.roundIds) {
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
      ...(saved.overallCompetition ? { overallCompetition: saved.overallCompetition } : {}) };
    if (!isEventWorkspace(workspace)) throw new ApiError(503, 'INVALID_STORED_WORKSPACE');
    for (const round of workspace.rounds) {
      const players = new Set(round.players.map((player) => player.playerId));
      if (locks.get(round.id)?.writtenPlayerIds.some((id) => !players.has(id))) {
        throw new ApiError(503, 'INVALID_STORED_SCORE_LOCK');
      }
    }
    return { ...workspace, event: summary };
  }

  async get(identity: AccountIdentity, id: string): Promise<EventWorkspace> {
    const before = await this.access(identity, id);
    const workspace = await this.load(before.summary);
    const after = await this.access(identity, id);
    if (after.summary.etag !== before.summary.etag || revision(after.member) !== revision(before.member)) throw new ApiError(409, 'EVENT_CHANGED');
    // Explicit allowlists prevent catalog/index/audit fields from leaking to event members.
    return {
      event: after.summary, location: workspace.location, etag: after.summary.etag,
      ...(workspace.allowPerGolferTees === undefined ? {} : { allowPerGolferTees: workspace.allowPerGolferTees }),
      ...(workspace.overallCompetition ? { overallCompetition: workspace.overallCompetition } : {}),
      roster: workspace.roster.map((player) => ({ playerId: player.playerId, displayName: player.displayName })),
      rounds: workspace.rounds.map((round) => ({
        id: round.id, name: round.name, courseId: round.courseId, courseVersionId: round.courseVersionId,
        course: metadata(round.course), teeProfile: profile(round.teeProfile),
        ...(round.playerTees?.length ? { playerTees: round.playerTees.map((entry) => ({
          playerId: entry.playerId, profile: profile(entry.profile),
        })) } : {}),
        ...(round.scoringStarted ? { scoringStarted: true } : {}),
        groups: round.groups.map((group) => ({ number: group.number, playerIds: [...group.playerIds] })),
        players: round.players.map((player) => after.summary.role === 'owner'
          ? {
            playerId: player.playerId, displayName: player.displayName,
            handicapIndex: player.handicapIndex ?? null,
          }
          : { playerId: player.playerId, displayName: player.displayName }),
      })),
    };
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

  async refreshIndices(identity: AccountIdentity, eventId: string, roundId: string, requestId: string, etag: string): Promise<EventWorkspace> {
    const access = await this.access(identity, eventId);
    if (access.summary.role !== 'owner') throw new ApiError(403, 'EVENT_MANAGEMENT_FORBIDDEN');
    if (access.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    requireManager(identity, this.allowed);
    if (await scoringLock(this.table, eventId, roundId)) throw new ApiError(409, 'ROUND_SCORING_STARTED');
    if (await this.refreshReplay(identity, eventId, roundId, requestId, etag)) {
      const current = await this.get(identity, eventId);
      if (current.rounds.find((round) => round.id === roundId)?.scoringStarted) throw new ApiError(409, 'ROUND_SCORING_STARTED');
      return current;
    }
    if (access.summary.etag !== etag) throw new ApiError(409, 'EVENT_CHANGED');
    const workspace = await this.load(access.summary);
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

  async receive(identity: AccountIdentity, id: string, body: unknown, etag: string) {
    const access = await this.access(identity, id);
    if (access.summary.role !== 'owner') throw new ApiError(403, 'EVENT_MANAGEMENT_FORBIDDEN');
    if (access.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    requireManager(identity, this.allowed);
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

  async save(identity: AccountIdentity, id: string, input: EventSetupInput, etag: string, publication?: StagedPublication): Promise<EventWorkspace> {
    const access = await this.access(identity, id);
    if (access.summary.role !== 'owner') throw new ApiError(403, 'EVENT_MANAGEMENT_FORBIDDEN');
    if (access.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    requireManager(identity, this.allowed);
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
    if (Buffer.byteLength(JSON.stringify(input), 'utf8') > maximumPrivateWriteBytes) throw new ApiError(413, 'REQUEST_TOO_LARGE');
    const previous = await this.load(access.summary);
    const allowPerGolferTees = input.allowPerGolferTees ?? previous.allowPerGolferTees;
    const overallCompetition = input.overallCompetition === undefined
      ? previous.overallCompetition : input.overallCompetition ?? undefined;
    if (overallCompetition?.kind === 'stableford') {
      for (const binding of overallCompetition.roundGames) {
        if (!input.rounds.some((round) => round.id === binding.roundId)) throw new ApiError(400, 'INVALID_OVERALL_ROUND');
        const games = await readGameConfiguration(this.table, id, binding.roundId, configuredGameRounds(access.event.gameRoundIds));
        if (!games?.games.some((game) => game.id === binding.gameId)) throw new ApiError(400, 'INVALID_OVERALL_GAME');
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
        || canonical(requested.groups) !== canonical(saved.groups)
        || requested.playerTeeSelections !== undefined && !sameTeeSelections(requested.playerTeeSelections,
          saved.playerTees?.map((entry) => ({ playerId: entry.playerId, teeProfileId: entry.profile.id })), saved.teeProfile.id)) {
        throw new ApiError(409, 'ROUND_SCORING_STARTED');
      }
    }
    const profiles = await this.profiles(identity, input.playerIds);
    const previousRoster = new Map(previous.roster.map((player) => [player.playerId, player]));
    const roster = profiles.map((player) => ({
      playerId: player.id,
      displayName: previousRoster.get(player.id)?.displayName ?? player.displayName,
    }));
    const rounds: RoundSnapshot[] = [];
    const rosterIds = new Set(input.playerIds);
    for (const round of input.rounds) {
      const lockedRound = locked.find((existing) => existing.id === round.id);
      if (lockedRound) {
        rounds.push(lockedRound);
        continue;
      }
      const version = await this.courses.getVersion(identity, round.courseId, round.courseVersionId);
      const teeProfile = version.data.teeProfiles.find((tee) => tee.id === round.teeProfileId);
      if (!teeProfile) throw new ApiError(400, 'TEE_PROFILE_NOT_FOUND');
      const oldRound = previous.rounds.find((existing) => existing.id === round.id);
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
      const availableTees = new Map(version.data.teeProfiles.map((tee) => [tee.id, tee]));
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
        course: metadata(version.data), teeProfile,
        ...(playerTees.length ? { playerTees } : {}),
        groups: round.groups.map((group) => ({ number: group.number, playerIds: [...group.playerIds] })),
        players: profiles.map((player) => {
          const saved = oldPlayers.get(player.id);
          return {
            playerId: player.id, displayName: saved?.displayName ?? player.displayName,
            handicapIndex: saved ? saved.handicapIndex ?? null : player.currentIndex,
          };
        }),
      });
    }
    const header: WorkspaceHeader = { location: input.location, roster, roundIds: rounds.map((round) => round.id),
      ...(allowPerGolferTees === undefined ? {} : { allowPerGolferTees }),
      ...(overallCompetition ? { overallCompetition } : {}) };
    const headerContent = await stagePrivateContent(this.table, id, 'workspace', identity, canonical(header));
    const roundContent = new Map<string, string>();
    for (const round of rounds) roundContent.set(round.id, await stagePrivateContent(this.table, id, `round:${round.id}`, identity, canonical(round)));
    const actions: TransactionAction[] = [
      ['update', { partitionKey: id, rowKey: 'event', name: input.name }, 'Merge', { etag }],
      ['update', {
        partitionKey: id, rowKey: `member:${identity.objectId}`, tenantId: identity.tenantId, objectId: identity.objectId, role: 'owner',
      }, 'Merge', { etag: revision(access.member) }],
      ['upsert', { partitionKey: id, rowKey: 'workspace', content: headerContent }, 'Replace'],
      ...rounds.map((round): TransactionAction => ['upsert', {
        partitionKey: id, rowKey: `round:${round.id}`, content: roundContent.get(round.id),
      }, 'Replace']),
    ];
    if (receiptKey && receipt) actions.push(['create', { partitionKey: id, rowKey: receiptKey,
      content: await stagePrivateContent(this.table, id, receiptKey, identity, receipt) }]);
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
