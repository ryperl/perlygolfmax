import { odata } from '@azure/data-tables';
import type { TableClient } from '@azure/data-tables';
import type { EventSetupInput } from '../../../src/domain/setup.js';
import type { PublicScoreIdentity } from '../../../src/domain/public-access.js';
import type { QuickCourse, QuickCourseVersion, QuickPage, QuickPlayerPage } from '../../../src/domain/quick-round.js';
import { TablePlayerCatalog } from '../catalog/players.js';
import { isCourseCatalogEntry, isCourseId, isPlayerProfile, isVersionId } from '../../../src/contracts/catalog.js';
import { isEventSetupInput } from '../../../src/contracts/setup.js';
import { isEventRevision, isRecord, isUuid } from '../../../src/contracts/events.js';
import { TableCourseCatalog } from '../catalog/courses.js';
import { canonical, decode, digest, isConflict, optionalRow, page, revision, transaction } from '../catalog/entities.js';
import { ApiError } from '../errors.js';
import { readPublicAccess } from '../public-access/authority.js';
import { receivePrivateWrite } from '../private-transport.js';
import type { TableWorkspaceStore } from '../setup/store.js';

export class TableQuickRoundStore {
  constructor(private readonly table: TableClient, private readonly workspace: TableWorkspaceStore) {}

  async courses(cursor?: string): Promise<QuickPage<QuickCourse>> {
    const result = await page(this.table, odata`RowKey eq ${'catalog-course'}`, cursor);
    const items = result.rows.map((row) => {
      const course = decode(row.content, isCourseCatalogEntry);
      if (row.partitionKey !== `catalog:course:${course.id}`) throw new ApiError(503, 'INVALID_STORED_CATALOG');
      return { id: course.id, name: course.name, latestVersionId: course.currentVersionId };
    });
    return { items, ...(result.continuationToken ? { continuationToken: result.continuationToken } : {}) };
  }

  async players(cursor?: string): Promise<QuickPlayerPage> {
    const result = await page(this.table, odata`PartitionKey eq ${'catalog:players'} and RowKey ge ${'player:'} and RowKey lt ${'player;'}`, cursor);
    const items = result.rows.map((row) => {
      const player = decode(row.content, isPlayerProfile);
      if (row.partitionKey !== 'catalog:players' || row.rowKey !== `player:${player.id}`) throw new ApiError(503, 'INVALID_STORED_CATALOG');
      return { id: player.id, displayName: player.displayName, handicapIndexValue: player.currentIndex?.value ?? null };
    });
    return { items, publicPlayerCreation: true, ...(result.continuationToken ? { continuationToken: result.continuationToken } : {}) };
  }

  async createPlayer(requestId: string, input: unknown) {
    return new TablePlayerCatalog(this.table, () => false).createPublic(requestId, input);
  }

  async version(courseId: string, versionId: string): Promise<QuickCourseVersion> {
    if (!isCourseId(courseId) || !isVersionId(versionId)) throw new ApiError(400, 'INVALID_COURSE_VERSION');
    const version = await new TableCourseCatalog(this.table, () => false).readCapturedVersion(courseId, versionId);
    return { courseId: version.courseId, id: version.id, data: version.data };
  }

  async load(eventId: string) {
    const identity: PublicScoreIdentity = { kind: 'public-score', eventId };
    const access = await readPublicAccess(this.table, identity, eventId);
    if (access.event.quickRound !== true) throw new ApiError(403, 'QUICK_ROUND_MANAGEMENT_FORBIDDEN');
    return this.workspace.get(identity, eventId);
  }

  async receive(eventId: string, etag: string | null, requestId: string, body: unknown) {
    if (!isUuid(eventId) || !isUuid(requestId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
    const existing = await optionalRow(this.table, eventId, 'event');
    if (etag !== null || existing) await this.load(eventId);
    return receivePrivateWrite(this.table, { kind: 'public-score', eventId }, eventId,
      etag === null ? 'quick-create' : 'workspace', etag, requestId, body);
  }

  private validate(input: unknown): asserts input is EventSetupInput {
    if (!isEventSetupInput(input) || input.rounds.length !== 1
      || input.overallCompetition !== undefined && input.overallCompetition !== null) {
      throw new ApiError(400, 'INVALID_QUICK_ROUND_SETUP');
    }
  }

  async create(eventId: string, input: unknown) {
    if (!isUuid(eventId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
    this.validate(input);
    const hash = digest(input);
    try {
      await this.table.createEntity({ partitionKey: eventId, rowKey: 'event', name: input.name,
        createdAt: new Date().toISOString(), status: 'active', quickRound: true, quickCreationHash: hash });
    } catch (error) {
      if (!isConflict(error)) throw error;
    }
    const access = await readPublicAccess(this.table, { kind: 'public-score', eventId }, eventId);
    if (access.event.quickRound !== true || access.event.quickCreationHash !== hash) throw new ApiError(409, 'QUICK_ROUND_REQUEST_CONFLICT');
    if (await optionalRow(this.table, eventId, 'workspace')) return this.load(eventId);
    return this.workspace.save({ kind: 'public-score', eventId }, eventId, input, access.summary.etag, { id: eventId, sha256: hash });
  }

  async save(eventId: string, etag: string, requestId: string, input: unknown) {
    this.validate(input);
    if (!isUuid(requestId) || !isEventRevision(etag)) throw new ApiError(400, 'INVALID_REQUEST_ID');
    await this.load(eventId);
    return this.workspace.save({ kind: 'public-score', eventId }, eventId, input, etag,
      { id: requestId, sha256: digest(input) });
  }

  async archive(eventId: string, etag: string, requestId: string) {
    if (!isUuid(eventId) || !isUuid(requestId) || !isEventRevision(etag)) throw new ApiError(400, 'INVALID_REQUEST_ID');
    const actor: PublicScoreIdentity = { kind: 'public-score', eventId };
    const binding = { eventId, requestId, expectedEtag: etag, recordedBy: actor };
    const key = `quick-archive:${requestId}`;
    const acknowledgement = { eventId, requestId, status: 'archived' as const };
    const receipt = async () => {
      const row = await optionalRow(this.table, eventId, key);
      if (!row) return false;
      const saved = decode(row.content, isRecord);
      if (row.partitionKey !== eventId || row.rowKey !== key || row.kind !== 'quick-archive'
        || !isRecord(saved.request) || saved.before !== 'active' || saved.after !== 'archived'
        || !isRecord(saved.recordedBy) || canonical(saved.recordedBy) !== canonical(actor)
        || typeof saved.recordedAt !== 'string' || !Number.isFinite(Date.parse(saved.recordedAt))) {
        throw new ApiError(503, 'INVALID_STORED_QUICK_ARCHIVE');
      }
      if (canonical(saved.request) !== canonical(binding)) throw new ApiError(409, 'QUICK_ARCHIVE_REQUEST_CONFLICT');
      return true;
    };
    const event = await optionalRow(this.table, eventId, 'event');
    if (!event || event.partitionKey !== eventId || event.rowKey !== 'event'
      || event.quickRound !== true || event.quickRoundReady !== true) throw new ApiError(403, 'QUICK_ROUND_MANAGEMENT_FORBIDDEN');
    if (await receipt()) {
      if (event.status !== 'archived') throw new ApiError(409, 'EVENT_CHANGED');
      return acknowledgement;
    }
    if (event.status === 'archived') throw new ApiError(404, 'PUBLIC_EVENT_NOT_AVAILABLE');
    if (event.status !== 'active') throw new ApiError(503, 'INVALID_STORED_EVENT');
    if (revision(event) !== etag) throw new ApiError(409, 'EVENT_CHANGED');
    const recordedAt = new Date().toISOString();
    try {
      await transaction(this.table, [
        ['update', { partitionKey: eventId, rowKey: 'event', status: 'archived', archivedAt: recordedAt }, 'Merge', { etag }],
        ['create', { partitionKey: eventId, rowKey: key, kind: 'quick-archive',
          content: canonical({ request: binding, recordedAt, recordedBy: actor, before: 'active', after: 'archived' }) }],
      ], 'EVENT_CHANGED');
    } catch (error) {
      const current = await optionalRow(this.table, eventId, 'event');
      if (current?.quickRound === true && current.status === 'archived' && await receipt()) return acknowledgement;
      throw error;
    }
    return acknowledgement;
  }
}
