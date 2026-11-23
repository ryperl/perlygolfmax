import type { PublicPlayerInput, QuickCourse, QuickCourseVersion, QuickPage, QuickPlayer, QuickPlayerPage } from '../domain/quick-round.js';
import { boundedText, isCourseId, isCourseMetadata, isHandicapIndex, isTeeProfile, isVersionId } from './catalog.js';
import { isRecord, isUuid } from './events.js';

function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function isQuickCourse(value: unknown): value is QuickCourse {
  return isRecord(value) && keys(value, ['id', 'name', 'latestVersionId'])
    && isCourseId(value.id) && boundedText(value.name, 200) && isVersionId(value.latestVersionId);
}

export function isQuickPlayer(value: unknown): value is QuickPlayer {
  return isRecord(value) && keys(value, ['id', 'displayName', 'handicapIndexValue'])
    && isUuid(value.id) && boundedText(value.displayName)
    && (value.handicapIndexValue === null || isHandicapIndex(value.handicapIndexValue));
}

export function isPublicPlayerInput(value: unknown): value is PublicPlayerInput {
  return isRecord(value) && keys(value, ['displayName', 'handicapIndexValue'])
    && boundedText(value.displayName, 100) && value.displayName === value.displayName.trim()
    && isHandicapIndex(value.handicapIndexValue);
}

export function isQuickPlayerPage(value: unknown): value is QuickPlayerPage {
  return isRecord(value) && keys(value, ['items', 'continuationToken', 'publicPlayerCreation'])
    && (value.publicPlayerCreation === undefined || typeof value.publicPlayerCreation === 'boolean')
    && isQuickPage({ items: value.items, ...(value.continuationToken === undefined ? {} : { continuationToken: value.continuationToken }) }, isQuickPlayer);
}

export function isQuickPage<T>(value: unknown, item: (entry: unknown) => entry is T): value is QuickPage<T> {
  return isRecord(value) && keys(value, ['items', 'continuationToken'])
    && Array.isArray(value.items) && value.items.every(item)
    && (value.continuationToken === undefined || typeof value.continuationToken === 'string'
      && value.continuationToken.length > 0 && value.continuationToken.length <= 2048);
}

export function isQuickCourseVersion(value: unknown): value is QuickCourseVersion {
  return isRecord(value) && keys(value, ['id', 'courseId', 'data'])
    && isCourseId(value.courseId) && isVersionId(value.id) && isCourseMetadata(value.data)
    && isRecord(value.data) && Array.isArray(value.data.teeProfiles) && value.data.teeProfiles.length > 0
    && value.data.teeProfiles.every(isTeeProfile)
    && new Set(value.data.teeProfiles.map((tee) => tee.id)).size === value.data.teeProfiles.length;
}
