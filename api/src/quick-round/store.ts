import { odata } from '@azure/data-tables';
import type { TableClient } from '@azure/data-tables';
import type { EventSetupInput } from '../../../src/domain/setup.js';
import type { PublicScoreIdentity } from '../../../src/domain/public-access.js';
import type { QuickCourse, QuickCourseVersion, QuickPage, QuickPlayer } from '../../../src/domain/quick-round.js';
import { isCourseCatalogEntry, isCourseId, isPlayerProfile, isVersionId } from '../../../src/contracts/catalog.js';
import { isEventSetupInput } from '../../../src/contracts/setup.js';
import { isEventRevision, isUuid } from '../../../src/contracts/events.js';
import { TableCourseCatalog } from '../catalog/courses.js';
import { decode, digest, isConflict, optionalRow, page } from '../catalog/entities.js';
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

  async players(cursor?: string): Promise<QuickPage<QuickPlayer>> {
    const result = await page(this.table, odata`PartitionKey eq ${'catalog:players'} and RowKey ge ${'player:'} and RowKey lt ${'player;'}`, cursor);
    const items = result.rows.map((row) => {
      const player = decode(row.content, isPlayerProfile);
      if (row.partitionKey !== 'catalog:players' || row.rowKey !== `player:${player.id}`) throw new ApiError(503, 'INVALID_STORED_CATALOG');
      return { id: player.id, displayName: player.displayName, handicapIndexValue: player.currentIndex?.value ?? null };
    });
    return { items, ...(result.continuationToken ? { continuationToken: result.continuationToken } : {}) };
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

}
