import type {
  CourseCatalogEntry, CourseCatalogPage, CourseImportManifest, CourseImportSession,
  CourseMetadata, CourseProvenance, CourseVersion, IndexObservation,
  PlayerCatalogPage, PlayerIndexHistory, PlayerProfile, TeeProfile,
} from '../domain/catalog.js';
import { isEventRevision, isRecord, isUuid } from './events.js';

export function boundedText(value: unknown, maximum = 100): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0
    && value.length <= maximum && !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
}

export function positiveInteger(value: unknown, maximum = 999_999_999): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

export function isDateOnly(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function instant(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function sourceNumber(value: unknown): boolean {
  return value === null || boundedText(value, 40)
    || typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 999_999_999;
}

export function isCourseId(value: unknown): value is string {
  return typeof value === 'string' && /^ghin:[1-9]\d{0,8}:[1-9]\d{0,8}$/.test(value);
}

export function isVersionId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function isCourseMetadata(value: unknown): value is CourseMetadata {
  if (!isRecord(value) || !isRecord(value.facility) || !isRecord(value.season)) return false;
  const facility = value.facility;
  const season = value.season;
  return value.provider === 'usga-ghin' && positiveInteger(value.sourceId)
    && boundedText(value.name, 200) && boundedText(value.status, 40)
    && sourceNumber(value.number) && boundedText(value.city, 120) && boundedText(value.state, 80)
    && positiveInteger(facility.id) && boundedText(facility.name, 200)
    && boundedText(facility.status, 40) && sourceNumber(facility.number)
    && positiveInteger(facility.golfAssociationId) && boundedText(facility.address, 500)
    && typeof facility.longitude === 'number' && Number.isFinite(facility.longitude) && Math.abs(facility.longitude) <= 180
    && typeof facility.latitude === 'number' && Number.isFinite(facility.latitude) && Math.abs(facility.latitude) <= 90
    && boundedText(season.name, 80) && typeof season.allYear === 'boolean'
    && typeof season.start === 'string' && isDateOnly(`2000-${season.start.replace('/', '-')}`)
    && typeof season.end === 'string' && isDateOnly(`2000-${season.end.replace('/', '-')}`);
}

export function isTeeProfile(value: unknown): value is TeeProfile {
  if (!isRecord(value) || !Array.isArray(value.holes) || !Array.isArray(value.ratings)) return false;
  if (!positiveInteger(value.id) || !boundedText(value.name, 100) || !boundedText(value.category, 40)
    || !positiveInteger(value.holeCount, 18) || ![9, 18].includes(value.holeCount)
    || !positiveInteger(value.totalYardage, 20_000) || !positiveInteger(value.totalMeters, 20_000)
    || !positiveInteger(value.totalPar, 150) || typeof value.strokeAllocation !== 'boolean'
    || typeof value.shorter !== 'boolean' || !boundedText(value.eligibleSides, 40)
    || value.holes.length !== value.holeCount || value.ratings.length !== 3) return false;
  const holes: unknown[] = value.holes;
  const ratings: unknown[] = value.ratings;
  const numbers = new Set<number>();
  const allocations = new Set<number>();
  const sourceIds = new Set<number>();
  let par = 0;
  let yards = 0;
  for (const hole of holes) {
    if (!isRecord(hole) || !positiveInteger(hole.number, value.holeCount)
      || !positiveInteger(hole.sourceId) || !positiveInteger(hole.length, 2_000)
      || !positiveInteger(hole.par, 10) || !positiveInteger(hole.allocation, value.holeCount)) return false;
    numbers.add(hole.number);
    allocations.add(hole.allocation);
    sourceIds.add(hole.sourceId);
    par += hole.par;
    yards += hole.length;
  }
  const ratingTypes = new Set<string>();
  for (const rating of ratings) {
    if (!isRecord(rating) || typeof rating.type !== 'string' || !['Total', 'Front', 'Back'].includes(rating.type)
      || typeof rating.course !== 'number' || !Number.isFinite(rating.course) || rating.course <= 0 || rating.course > 150
      || !positiveInteger(rating.slope, 300) || typeof rating.bogey !== 'number'
      || !Number.isFinite(rating.bogey) || rating.bogey <= 0 || rating.bogey > 200) return false;
    ratingTypes.add(rating.type);
  }
  return numbers.size === value.holeCount && allocations.size === value.holeCount
    && sourceIds.size === value.holeCount && ratingTypes.size === 3 && par === value.totalPar && yards === value.totalYardage;
}

export function isCourseProvenance(value: unknown): value is CourseProvenance {
  return isRecord(value) && boundedText(value.source, 300) && (value.exportedAt === null || isDateOnly(value.exportedAt));
}

export function isCourseImportManifest(value: unknown): value is CourseImportManifest {
  return isRecord(value) && isCourseMetadata(value.course) && isCourseProvenance(value.provenance)
    && Array.isArray(value.teeProfileIds) && value.teeProfileIds.length > 0 && value.teeProfileIds.length <= 32
    && value.teeProfileIds.every((id: unknown) => positiveInteger(id))
    && new Set(value.teeProfileIds).size === value.teeProfileIds.length;
}

export function isCourseImportSession(value: unknown): value is CourseImportSession {
  if (!isRecord(value) || !isCourseImportManifest(value.manifest)) return false;
  const manifest = value.manifest;
  return isUuid(value.id) && isCourseId(value.courseId)
    && value.courseId === `ghin:${String(manifest.course.facility.id)}:${String(manifest.course.sourceId)}`
    && Array.isArray(value.profilesReceived) && value.profilesReceived.every((id: unknown) => positiveInteger(id)
      && manifest.teeProfileIds.includes(id))
    && new Set(value.profilesReceived).size === value.profilesReceived.length
    && (value.publishedVersionId === null || isVersionId(value.publishedVersionId));
}

export function isCourseCatalogEntry(value: unknown): value is CourseCatalogEntry {
  return isRecord(value) && isCourseId(value.id) && boundedText(value.name, 200)
    && boundedText(value.location, 240) && isVersionId(value.currentVersionId) && isEventRevision(value.etag);
}

export function isCourseVersion(value: unknown): value is CourseVersion {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  return isVersionId(value.id) && isCourseId(value.courseId) && isCourseMetadata(value.data)
    && Array.isArray(value.data.teeProfiles) && value.data.teeProfiles.length > 0 && value.data.teeProfiles.length <= 32
    && value.data.teeProfiles.every(isTeeProfile)
    && new Set(value.data.teeProfiles.map((profile: TeeProfile) => profile.id)).size === value.data.teeProfiles.length
    && value.courseId === `ghin:${String(value.data.facility.id)}:${String(value.data.sourceId)}`
    && isCourseProvenance(value.provenance) && instant(value.importedAt);
}

export function isHandicapIndex(value: unknown): value is string {
  return typeof value === 'string' && /^\+?(?:0|[1-9]\d?)(?:\.\d)?$/.test(value);
}

export function isIndexObservation(value: unknown): value is IndexObservation {
  return isRecord(value) && isUuid(value.id) && isHandicapIndex(value.value) && isDateOnly(value.effectiveDate)
    && boundedText(value.source, 200) && instant(value.recordedAt) && isRecord(value.recordedBy)
    && isUuid(value.recordedBy.tenantId) && isUuid(value.recordedBy.objectId)
    && (value.previousObservationId === null || isUuid(value.previousObservationId));
}

export function isPlayerProfile(value: unknown): value is PlayerProfile {
  return isRecord(value) && isUuid(value.id) && boundedText(value.displayName, 100)
    && instant(value.createdAt) && isEventRevision(value.etag)
    && (value.currentIndex === null || isIndexObservation(value.currentIndex));
}

function cursor(value: Record<string, unknown>): boolean {
  return value.continuationToken === undefined
    || typeof value.continuationToken === 'string' && value.continuationToken.length <= 2048;
}

export function isCourseCatalogPage(value: unknown): value is CourseCatalogPage {
  return isRecord(value) && Array.isArray(value.courses) && value.courses.length <= 50
    && value.courses.every(isCourseCatalogEntry) && cursor(value);
}

export function isPlayerCatalogPage(value: unknown): value is PlayerCatalogPage {
  return isRecord(value) && Array.isArray(value.players) && value.players.length <= 50
    && value.players.every(isPlayerProfile) && cursor(value);
}

export function isPlayerIndexHistory(value: unknown): value is PlayerIndexHistory {
  return isRecord(value) && Array.isArray(value.observations) && value.observations.length <= 50
    && value.observations.every(isIndexObservation) && cursor(value);
}
