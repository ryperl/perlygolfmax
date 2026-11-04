import { odata } from '@azure/data-tables';
import type { TableClient, TransactionAction } from '@azure/data-tables';
import type {
  CourseCatalogEntry, CourseCatalogPage, CourseImportManifest, CourseImportSession, CourseVersion, TeeProfile,
} from '../../../src/domain/catalog.js';
import type { AccountIdentity } from '../../../src/domain/events.js';
import {
  isCourseCatalogEntry, isCourseId, isCourseImportManifest, isCourseVersion, isTeeProfile, isVersionId,
} from '../../../src/contracts/catalog.js';
import { ApiError } from '../errors.js';
import { canonical, decode, digest, isConflict, optionalRow, page, revision } from './entities.js';
import { metadata, profile, provenance } from './projections.js';

const coursePartition = (id: string) => `catalog:course:${id}`;
const importPartition = (id: string) => `catalog:import:${id}`;
const versionRow = (id: string) => `version:${id}`;
const teeRow = (version: string, id: number) => `version:${version}:profile:${String(id)}`;

export type CatalogPermission = (identity: AccountIdentity) => boolean;

export function requireManager(identity: AccountIdentity, allowed: CatalogPermission): void {
  if (!allowed(identity)) throw new ApiError(403, 'CATALOG_MANAGEMENT_FORBIDDEN');
}

export class TableCourseCatalog {
  constructor(private readonly table: TableClient, private readonly allowed: CatalogPermission) {}

  async list(identity: AccountIdentity, cursor?: string): Promise<CourseCatalogPage> {
    requireManager(identity, this.allowed);
    const result = await page(this.table, odata`RowKey eq ${'catalog-course'}`, cursor);
    const courses = result.rows.map((row): CourseCatalogEntry => {
      const entry = decode(row.content, isCourseCatalogEntry);
      if (row.partitionKey !== coursePartition(entry.id)) throw new ApiError(503, 'INVALID_STORED_CATALOG');
      return { ...entry, etag: revision(row) };
    });
    return { courses, ...(result.continuationToken ? { continuationToken: result.continuationToken } : {}) };
  }

  async start(identity: AccountIdentity, id: string, input: CourseImportManifest): Promise<CourseImportSession> {
    requireManager(identity, this.allowed);
    if (!isCourseId(`ghin:${String(input.course.facility.id)}:${String(input.course.sourceId)}`)) {
      throw new ApiError(400, 'INVALID_COURSE_ID');
    }
    const manifest: CourseImportManifest = {
      course: metadata(input.course), teeProfileIds: [...input.teeProfileIds].sort((a, b) => a - b),
      provenance: provenance(input.provenance),
    };
    const partitionKey = importPartition(id);
    try {
      await this.table.createEntity({
        partitionKey, rowKey: 'manifest', content: canonical(manifest), importedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (!isConflict(error)) throw error;
      const existing = await optionalRow(this.table, partitionKey, 'manifest');
      if (!existing || canonical(decode(existing.content, isCourseImportManifest)) !== canonical(manifest)) {
        throw new ApiError(409, 'IMPORT_REQUEST_CONFLICT');
      }
    }
    return this.session(identity, id);
  }

  private async manifest(id: string) {
    const row = await optionalRow(this.table, importPartition(id), 'manifest');
    if (!row) throw new ApiError(404, 'IMPORT_NOT_FOUND');
    const manifest = decode(row.content, isCourseImportManifest);
    if (!isCourseId(`ghin:${String(manifest.course.facility.id)}:${String(manifest.course.sourceId)}`)) {
      throw new ApiError(503, 'INVALID_STORED_CATALOG');
    }
    if (typeof row.importedAt !== 'string' || !Number.isFinite(Date.parse(row.importedAt))) {
      throw new ApiError(503, 'INVALID_STORED_CATALOG');
    }
    return { manifest, importedAt: row.importedAt };
  }

  async session(identity: AccountIdentity, id: string): Promise<CourseImportSession> {
    requireManager(identity, this.allowed);
    const { manifest } = await this.manifest(id);
    const courseId = `ghin:${String(manifest.course.facility.id)}:${String(manifest.course.sourceId)}`;
    const profilesReceived: number[] = [];
    for (const profileId of manifest.teeProfileIds) {
      const row = await optionalRow(this.table, importPartition(id), `profile:${String(profileId)}`);
      if (row) {
        const tee = decode(row.content, isTeeProfile);
        if (tee.id !== profileId) throw new ApiError(503, 'INVALID_STORED_CATALOG');
        profilesReceived.push(profileId);
      }
    }
    const receipt = await optionalRow(this.table, coursePartition(courseId), `publication:${id}`);
    if (receipt && !isVersionId(receipt.versionId)) throw new ApiError(503, 'INVALID_STORED_CATALOG');
    const publishedVersionId = receipt && isVersionId(receipt.versionId) ? receipt.versionId : null;
    return { id, courseId, manifest, profilesReceived, publishedVersionId };
  }

  async putProfile(identity: AccountIdentity, id: string, profileId: number, input: TeeProfile): Promise<CourseImportSession> {
    requireManager(identity, this.allowed);
    const { manifest } = await this.manifest(id);
    if (input.id !== profileId || !manifest.teeProfileIds.includes(profileId)) throw new ApiError(400, 'UNEXPECTED_TEE_PROFILE');
    const content = canonical(profile(input));
    try {
      await this.table.createEntity({ partitionKey: importPartition(id), rowKey: `profile:${String(profileId)}`, content });
    } catch (error) {
      if (!isConflict(error)) throw error;
      const existing = await optionalRow(this.table, importPartition(id), `profile:${String(profileId)}`);
      if (!existing || canonical(profile(decode(existing.content, isTeeProfile))) !== content) throw new ApiError(409, 'IMPORT_PROFILE_CONFLICT');
    }
    return this.session(identity, id);
  }

  async getVersion(identity: AccountIdentity, courseId: string, versionId: string): Promise<CourseVersion> {
    requireManager(identity, this.allowed);
    const header = await optionalRow(this.table, coursePartition(courseId), versionRow(versionId));
    if (!header) throw new ApiError(404, 'COURSE_VERSION_NOT_FOUND');
    const manifest = decode(header.content, isCourseImportManifest);
    const tees: TeeProfile[] = [];
    for (const id of manifest.teeProfileIds) {
      const row = await optionalRow(this.table, coursePartition(courseId), teeRow(versionId, id));
      if (!row) throw new ApiError(503, 'INVALID_STORED_CATALOG');
      const tee = decode(row.content, isTeeProfile);
      if (tee.id !== id) throw new ApiError(503, 'INVALID_STORED_CATALOG');
      tees.push(profile(tee));
    }
    const result = {
      id: versionId, courseId, data: { ...metadata(manifest.course), teeProfiles: tees },
      provenance: provenance(manifest.provenance), importedAt: header.importedAt,
    };
    if (!isCourseVersion(result) || courseId !== `ghin:${String(result.data.facility.id)}:${String(result.data.sourceId)}`
      || digest({ data: result.data, provenance: result.provenance }) !== versionId) throw new ApiError(503, 'INVALID_STORED_CATALOG');
    return result;
  }

  async publish(identity: AccountIdentity, id: string, expectedEtag: string | null): Promise<CourseVersion> {
    requireManager(identity, this.allowed);
    const session = await this.session(identity, id);
    const partitionKey = coursePartition(session.courseId);
    const receiptKey = `publication:${id}`;
    const receipt = await optionalRow(this.table, partitionKey, receiptKey);
    if (receipt) {
      if (!isVersionId(receipt.versionId) || typeof receipt.expectedRevision !== 'string') throw new ApiError(503, 'INVALID_STORED_CATALOG');
      if (receipt.expectedRevision !== (expectedEtag ?? '')) throw new ApiError(409, 'IMPORT_REQUEST_CONFLICT');
      return this.getVersion(identity, session.courseId, receipt.versionId);
    }
    if (session.profilesReceived.length !== session.manifest.teeProfileIds.length) throw new ApiError(409, 'IMPORT_INCOMPLETE');
    const teeProfiles: TeeProfile[] = [];
    for (const profileId of session.manifest.teeProfileIds) {
      const row = await optionalRow(this.table, importPartition(id), `profile:${String(profileId)}`);
      if (!row) throw new ApiError(503, 'INVALID_STORED_CATALOG');
      teeProfiles.push(profile(decode(row.content, isTeeProfile)));
    }
    const data = { ...metadata(session.manifest.course), teeProfiles };
    const versionId = digest({ data, provenance: session.manifest.provenance });
    const { importedAt } = await this.manifest(id);
    const proposed: CourseVersion = { id: versionId, courseId: session.courseId, data, provenance: session.manifest.provenance, importedAt };
    const root = await optionalRow(this.table, partitionKey, 'catalog-course');
    if (root) decode(root.content, isCourseCatalogEntry);
    if ((root ? revision(root) : null) !== expectedEtag) throw new ApiError(409, 'COURSE_CHANGED');
    const existing = await optionalRow(this.table, partitionKey, versionRow(versionId));
    const version = existing ? await this.getVersion(identity, session.courseId, versionId) : proposed;
    const entry: CourseCatalogEntry = {
      id: session.courseId, name: data.name, location: `${data.city}, ${data.state}`, currentVersionId: versionId,
      etag: 'stored-revision',
    };
    const actions: TransactionAction[] = [
      ['create', { partitionKey, rowKey: receiptKey, versionId: version.id, expectedRevision: expectedEtag ?? '' }],
    ];
    if (!root) actions.push(['create', { partitionKey, rowKey: 'catalog-course', content: canonical(entry) }]);
    else if (decode(root.content, isCourseCatalogEntry).currentVersionId !== versionId) {
      actions.push(['update', { partitionKey, rowKey: 'catalog-course', content: canonical(entry) }, 'Replace', { etag: revision(root) }]);
    } else {
      actions.push(['update', { partitionKey, rowKey: 'catalog-course', content: root.content }, 'Replace', { etag: revision(root) }]);
    }
    if (!existing) {
      actions.push(['create', { partitionKey, rowKey: versionRow(versionId), content: canonical(session.manifest), importedAt }]);
      for (const tee of teeProfiles) actions.push(['create', { partitionKey, rowKey: teeRow(versionId, tee.id), content: canonical(tee) }]);
    }
    try { await this.table.submitTransaction(actions); }
    catch (error) {
      if (!isConflict(error)) throw error;
      const completed = await optionalRow(this.table, partitionKey, receiptKey);
      if (!completed || completed.versionId !== versionId || completed.expectedRevision !== (expectedEtag ?? '')) throw new ApiError(409, 'COURSE_CHANGED');
    }
    return this.getVersion(identity, session.courseId, versionId);
  }
}
