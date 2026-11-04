import type { TableClient, TransactionAction } from '@azure/data-tables';
import type { AccountIdentity, EventSummary } from '../../../src/domain/events.js';
import type { EventRosterPlayer, EventSetupInput, EventWorkspace, RoundSnapshot } from '../../../src/domain/setup.js';
import { isEventSummary, isRecord, isUuid } from '../../../src/contracts/events.js';
import { isEventSetupInput, isEventWorkspace } from '../../../src/contracts/setup.js';
import { ApiError } from '../errors.js';
import { canonical, decode, optionalRow, revision, transaction } from '../catalog/entities.js';
import { requireManager } from '../catalog/courses.js';
import type { CatalogPermission, TableCourseCatalog } from '../catalog/courses.js';
import type { TablePlayerCatalog } from '../catalog/players.js';
import { metadata, profile } from '../catalog/projections.js';

interface WorkspaceHeader {
  readonly location: string;
  readonly roster: readonly EventRosterPlayer[];
  readonly roundIds: readonly string[];
}

function isHeader(value: unknown): value is WorkspaceHeader {
  return isRecord(value) && typeof value.location === 'string'
    && Array.isArray(value.roster) && value.roster.length >= 4 && value.roster.length <= 8
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
    const saved = decode(header.content, isHeader);
    const rounds: unknown[] = [];
    for (const id of saved.roundIds) {
      const row = await optionalRow(this.table, summary.id, `round:${id}`);
      if (!row || typeof row.content !== 'string') throw new ApiError(503, 'INVALID_STORED_WORKSPACE');
      let round: unknown;
      try { round = JSON.parse(row.content); } catch { throw new ApiError(503, 'INVALID_STORED_WORKSPACE'); }
      if (!isRecord(round) || round.id !== id) throw new ApiError(503, 'INVALID_STORED_WORKSPACE');
      rounds.push(round);
    }
    const workspace = { event: { ...summary, role: 'owner' }, location: saved.location, roster: saved.roster, rounds, etag: summary.etag };
    if (!isEventWorkspace(workspace)) throw new ApiError(503, 'INVALID_STORED_WORKSPACE');
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
      roster: workspace.roster.map((player) => ({ playerId: player.playerId, displayName: player.displayName })),
      rounds: workspace.rounds.map((round) => ({
        id: round.id, name: round.name, courseId: round.courseId, courseVersionId: round.courseVersionId,
        course: metadata(round.course), teeProfile: profile(round.teeProfile),
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

  async save(identity: AccountIdentity, id: string, input: EventSetupInput, etag: string): Promise<EventWorkspace> {
    const access = await this.access(identity, id);
    if (access.summary.role !== 'owner') throw new ApiError(403, 'EVENT_MANAGEMENT_FORBIDDEN');
    if (access.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    requireManager(identity, this.allowed);
    if (access.summary.etag !== etag) throw new ApiError(409, 'EVENT_CHANGED');
    if (!isEventSetupInput(input)) throw new ApiError(400, 'INVALID_EVENT_SETUP');
    const previous = await this.load(access.summary);
    if (previous.rounds.some((round) => !input.rounds.some((configured) => configured.id === round.id))) {
      throw new ApiError(409, 'ROUND_REMOVAL_NOT_SUPPORTED');
    }
    const profiles = await Promise.all(input.playerIds.map((playerId) => this.players.get(identity, playerId)));
    const roster = profiles.map((player) => ({
      playerId: player.id,
      displayName: previous.roster.find((saved) => saved.playerId === player.id)?.displayName ?? player.displayName,
    }));
    const rounds: RoundSnapshot[] = [];
    for (const round of input.rounds) {
      const version = await this.courses.getVersion(identity, round.courseId, round.courseVersionId);
      const teeProfile = version.data.teeProfiles.find((tee) => tee.id === round.teeProfileId);
      if (!teeProfile) throw new ApiError(400, 'TEE_PROFILE_NOT_FOUND');
      const oldRound = previous.rounds.find((existing) => existing.id === round.id);
      rounds.push({
        id: round.id, name: round.name, courseId: round.courseId, courseVersionId: round.courseVersionId,
        course: metadata(version.data), teeProfile,
        groups: round.groups.map((group) => ({ number: group.number, playerIds: [...group.playerIds] })),
        players: profiles.map((player) => {
          const saved = oldRound?.players.find((entry) => entry.playerId === player.id);
          return {
            playerId: player.id, displayName: saved?.displayName ?? player.displayName,
            handicapIndex: saved ? saved.handicapIndex ?? null : player.currentIndex,
          };
        }),
      });
    }
    const header: WorkspaceHeader = { location: input.location, roster, roundIds: rounds.map((round) => round.id) };
    const actions: TransactionAction[] = [
      ['update', { partitionKey: id, rowKey: 'event', name: input.name }, 'Merge', { etag }],
      ['update', {
        partitionKey: id, rowKey: `member:${identity.objectId}`, tenantId: identity.tenantId, objectId: identity.objectId, role: 'owner',
      }, 'Merge', { etag: revision(access.member) }],
      ['upsert', { partitionKey: id, rowKey: 'workspace', content: canonical(header) }, 'Replace'],
      ...rounds.map((round): TransactionAction => ['upsert', {
        partitionKey: id, rowKey: `round:${round.id}`, content: canonical(round),
      }, 'Replace']),
    ];
    await transaction(this.table, actions, 'EVENT_CHANGED');
    return this.get(identity, id);
  }
}
