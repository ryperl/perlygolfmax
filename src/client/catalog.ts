import {
  boundedText, isCourseCatalogPage, isCourseId, isCourseImportManifest, isCourseImportSession,
  isCourseVersion, isManualIndexInput, isPlayerCatalogPage, isPlayerIndexHistory,
  isPlayerProfile, isTeeProfile, isVersionId,
} from '../contracts/catalog';
import { isEventRevision, isUuid } from '../contracts/events';
import type {
  CourseCatalogPage, CourseImportManifest, CourseImportSession, CourseVersion,
  IndexObservation, ManualIndexInput, PlayerCatalogPage, PlayerIndexHistory, PlayerProfile, TeeProfile,
} from '../domain/catalog';
import { createPrivateRequest } from './private-request';

export interface CatalogClient {
  readonly courses: (signal: AbortSignal, cursor?: string) => Promise<CourseCatalogPage>;
  readonly version: (courseId: string, versionId: string, signal: AbortSignal) => Promise<CourseVersion>;
  readonly beginImport: (manifest: CourseImportManifest, requestId: string, signal: AbortSignal) => Promise<CourseImportSession>;
  readonly importStatus: (id: string, signal: AbortSignal) => Promise<CourseImportSession>;
  readonly uploadProfile: (id: string, profile: TeeProfile, signal: AbortSignal) => Promise<CourseImportSession>;
  readonly publish: (id: string, expectedEtag: string | null, signal: AbortSignal) => Promise<CourseVersion>;
  readonly players: (signal: AbortSignal, cursor?: string) => Promise<PlayerCatalogPage>;
  readonly createPlayer: (displayName: string, requestId: string, signal: AbortSignal, initialIndex?: ManualIndexInput) => Promise<PlayerProfile>;
  readonly renamePlayer: (player: PlayerProfile, displayName: string, signal: AbortSignal) => Promise<PlayerProfile>;
  readonly history: (playerId: string, signal: AbortSignal, cursor?: string) => Promise<PlayerIndexHistory>;
  readonly recordIndex: (player: PlayerProfile, observation: ManualIndexInput, requestId: string, signal: AbortSignal) => Promise<PlayerProfile>;
}

export type { ManualIndexInput } from '../domain/catalog';

function requireValid(valid: boolean): void {
  if (!valid) throw new Error('Invalid catalog request. Check the supplied fields.');
}

export function createCatalogClient(apiUrl: string, getToken: () => Promise<string>, send: typeof fetch = fetch): CatalogClient {
  const request = createPrivateRequest(apiUrl, getToken, send);
  const path = (id: string) => `catalog/courses/imports/${encodeURIComponent(id)}`;
  const pagePath = (base: string, cursor?: string) => cursor ? `${base}?${new URLSearchParams({ cursor }).toString()}` : base;
  function importResponse(value: unknown, id?: string): CourseImportSession {
    if (!isCourseImportSession(value) || id !== undefined && value.id !== id) throw new Error('Invalid staged import response. Refresh before retrying.');
    return value;
  }
  async function confirmInitialIndex(player: PlayerProfile, initial: ManualIndexInput, requestId: string, signal: AbortSignal) {
    const matches = (observation: IndexObservation | null) => observation?.id === requestId
      && observation.value === initial.value && observation.effectiveDate === initial.effectiveDate && observation.source === initial.source;
    if (matches(player.currentIndex)) return;
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const history = await request(pagePath(`catalog/players/${encodeURIComponent(player.id)}/indices`, cursor), signal);
      if (!isPlayerIndexHistory(history)) throw new Error('The requested initial observation was not confirmed. Invalid history response; retry with the same request.');
      if (history.observations.some(matches)) return;
      cursor = history.continuationToken;
      if (cursor && seen.has(cursor)) throw new Error('The requested initial observation was not confirmed. Invalid history paging; retry with the same request.');
      if (cursor) seen.add(cursor);
    } while (cursor);
    throw new Error('The requested initial observation was not confirmed. Retry with the same request.');
  }
  return {
    async courses(signal, cursor) {
      const value = await request(pagePath('catalog/courses', cursor), signal);
      if (!isCourseCatalogPage(value)) throw new Error('Invalid course catalog response.');
      return value;
    },
    async version(courseId, versionId, signal) {
      requireValid(isCourseId(courseId) && isVersionId(versionId));
      const value = await request(`catalog/courses/${encodeURIComponent(courseId)}/versions/${encodeURIComponent(versionId)}`, signal);
      if (!isCourseVersion(value) || value.courseId !== courseId || value.id !== versionId) throw new Error('Invalid course version response.');
      return value;
    },
    async beginImport(manifest, requestId, signal) {
      requireValid(isCourseImportManifest(manifest) && isUuid(requestId));
      return importResponse(await request('catalog/courses/imports', signal, { method: 'POST', body: manifest, requestId }));
    },
    async importStatus(id, signal) {
      requireValid(isUuid(id));
      return importResponse(await request(path(id), signal), id);
    },
    async uploadProfile(id, profile, signal) {
      requireValid(isUuid(id) && isTeeProfile(profile));
      return importResponse(await request(`${path(id)}/profiles/${String(profile.id)}`, signal, { method: 'PUT', body: profile }), id);
    },
    async publish(id, expectedEtag, signal) {
      requireValid(isUuid(id) && (expectedEtag === null || isEventRevision(expectedEtag)));
      const value = await request(`${path(id)}/publish`, signal, { method: 'POST', body: { expectedEtag } });
      if (!isCourseVersion(value)) throw new Error('Invalid published course response. Refresh the catalog.');
      return value;
    },
    async players(signal, cursor) {
      const value = await request(pagePath('catalog/players', cursor), signal);
      if (!isPlayerCatalogPage(value)) throw new Error('Invalid player catalog response.');
      return value;
    },
    async createPlayer(displayName, requestId, signal, initialIndex) {
      requireValid(boundedText(displayName) && isUuid(requestId)
        && (initialIndex === undefined || isManualIndexInput(initialIndex)));
      const value = await request('catalog/players', signal, {
        method: 'POST', body: { displayName, ...(initialIndex === undefined ? {} : { initialIndex }) }, requestId,
      });
      if (!isPlayerProfile(value) || value.id !== requestId) throw new Error('Invalid saved player response. Retry with the same request.');
      if (initialIndex !== undefined) await confirmInitialIndex(value, initialIndex, requestId, signal);
      return value;
    },
    async renamePlayer(player, displayName, signal) {
      requireValid(isUuid(player.id) && isEventRevision(player.etag) && boundedText(displayName));
      const value = await request(`catalog/players/${encodeURIComponent(player.id)}`, signal, {
        method: 'PATCH', body: { displayName }, etag: player.etag,
      });
      if (!isPlayerProfile(value) || value.id !== player.id) throw new Error('Invalid updated player response.');
      return value;
    },
    async history(playerId, signal, cursor) {
      requireValid(isUuid(playerId));
      const value = await request(pagePath(`catalog/players/${encodeURIComponent(playerId)}/indices`, cursor), signal);
      if (!isPlayerIndexHistory(value)) throw new Error('Invalid handicap history response.');
      return value;
    },
    async recordIndex(player, observation, requestId, signal) {
      requireValid(isUuid(player.id) && isEventRevision(player.etag) && isUuid(requestId)
        && isManualIndexInput(observation));
      const value = await request(`catalog/players/${encodeURIComponent(player.id)}/indices`, signal, {
        method: 'POST', body: observation, requestId, etag: player.etag,
      });
      if (!isPlayerProfile(value) || value.id !== player.id) throw new Error('Invalid saved handicap response. Refresh history.');
      return value;
    },
  };
}
