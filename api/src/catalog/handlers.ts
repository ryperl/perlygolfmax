import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import type { AccountIdentity } from '../../../src/domain/events.js';
import {
  boundedText, isCourseId, isCourseImportManifest, isDateOnly, isHandicapIndex, isTeeProfile, isVersionId,
} from '../../../src/contracts/catalog.js';
import { isEventRevision, isRecord, isUuid } from '../../../src/contracts/events.js';
import { isEventSetupInput } from '../../../src/contracts/setup.js';
import { ApiError } from '../errors.js';
import { failureDiagnostics } from '../diagnostics.js';
import { readCursor, readJson, response } from '../http.js';
import type { VerifyIdentity } from '../identity.js';
import type { RequestLimiter } from '../limits.js';
import type { TableWorkspaceStore } from '../setup/store.js';
import { requireManager } from './courses.js';
import type { TableCourseCatalog } from './courses.js';
import type { TablePlayerCatalog } from './players.js';

export interface CatalogSetupApi {
  readonly verify: VerifyIdentity;
  readonly canManageCatalog: (identity: AccountIdentity) => boolean;
  readonly limiter: RequestLimiter;
  readonly courses: TableCourseCatalog;
  readonly players: TablePlayerCatalog;
  readonly workspace: TableWorkspaceStore;
}

export type CatalogAction = 'courses' | 'course-version' | 'imports' | 'import'
  | 'import-profile' | 'import-publish' | 'players' | 'player' | 'indices' | 'workspace';

function uuid(value: unknown): string {
  if (!isUuid(value)) throw new ApiError(400, 'INVALID_REQUEST_ID');
  return value;
}

function etag(request: HttpRequest): string {
  const value = request.headers.get('If-Match');
  if (!isEventRevision(value)) throw new ApiError(400, 'REVISION_REQUIRED');
  return value;
}

const methods: Readonly<Record<CatalogAction, readonly string[]>> = {
  courses: ['GET'], 'course-version': ['GET'], imports: ['POST'], import: ['GET'],
  'import-profile': ['PUT'], 'import-publish': ['POST'], players: ['GET', 'POST'],
  player: ['PATCH'], indices: ['GET', 'POST'], workspace: ['GET', 'PUT'],
};

export function createCatalogHandler(resolveApi: () => CatalogSetupApi, action: CatalogAction) {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const api = resolveApi();
      const identity = await api.verify(request.headers.get('authorization'));
      const write = request.method !== 'GET';
      if (action !== 'workspace') requireManager(identity, api.canManageCatalog);
      await api.limiter.check(identity, action === 'workspace'
        ? write ? 'setup-write' : 'setup-read' : write ? 'catalog-write' : 'catalog-read');
      if (!methods[action].includes(request.method)) return response(405, { code: 'METHOD_NOT_ALLOWED' });
      if (action === 'workspace') {
        const id = uuid(request.params.id);
        if (!write) return response(200, await api.workspace.get(identity, id));
        const expected = etag(request);
        const body = await readJson(request);
        if (!isEventSetupInput(body)) throw new ApiError(400, 'INVALID_EVENT_SETUP');
        return response(200, await api.workspace.save(identity, id, body, expected));
      }
      if (action === 'courses') return response(200, await api.courses.list(identity, readCursor(request)));
      if (action === 'course-version') {
        const { courseId, versionId } = request.params;
        if (!isCourseId(courseId) || !isVersionId(versionId)) throw new ApiError(400, 'INVALID_COURSE_VERSION');
        return response(200, await api.courses.getVersion(identity, courseId, versionId));
      }
      if (action === 'imports') {
        const id = uuid(request.headers.get('Idempotency-Key'));
        const body = await readJson(request);
        if (!isCourseImportManifest(body)) throw new ApiError(400, 'INVALID_COURSE_IMPORT');
        return response(200, await api.courses.start(identity, id, body));
      }
      if (action === 'import') return response(200, await api.courses.session(identity, uuid(request.params.importId)));
      if (action === 'import-profile') {
        const id = uuid(request.params.importId);
        const profileId = Number(request.params.profileId);
        if (!/^[1-9]\d{0,9}$/.test(request.params.profileId ?? '') || !Number.isSafeInteger(profileId)) throw new ApiError(400, 'INVALID_TEE_PROFILE');
        const body = await readJson(request);
        if (!isTeeProfile(body)) throw new ApiError(400, 'INVALID_TEE_PROFILE');
        return response(200, await api.courses.putProfile(identity, id, profileId, body));
      }
      if (action === 'import-publish') {
        const id = uuid(request.params.importId);
        const body = await readJson(request);
        if (!isRecord(body) || body.expectedEtag !== null && !isEventRevision(body.expectedEtag)) throw new ApiError(400, 'REVISION_REQUIRED');
        return response(200, await api.courses.publish(identity, id, body.expectedEtag));
      }
      if (action === 'players') {
        if (!write) return response(200, await api.players.list(identity, readCursor(request)));
        const id = uuid(request.headers.get('Idempotency-Key'));
        const body = await readJson(request);
        if (!isRecord(body) || !boundedText(body.displayName)) throw new ApiError(400, 'INVALID_PLAYER_NAME');
        return response(200, await api.players.create(identity, id, body.displayName));
      }
      const playerId = uuid(request.params.playerId);
      if (action === 'player') {
        const expected = etag(request);
        const body = await readJson(request);
        if (!isRecord(body) || !boundedText(body.displayName)) throw new ApiError(400, 'INVALID_PLAYER_NAME');
        return response(200, await api.players.rename(identity, playerId, body.displayName, expected));
      }
      if (!write) return response(200, await api.players.history(identity, playerId, readCursor(request)));
      const observationId = uuid(request.headers.get('Idempotency-Key'));
      const expected = etag(request);
      const body = await readJson(request);
      if (!isRecord(body) || !isHandicapIndex(body.value) || !isDateOnly(body.effectiveDate) || !boundedText(body.source, 200)) {
        throw new ApiError(400, 'INVALID_INDEX_OBSERVATION');
      }
      return response(200, await api.players.observe(identity, playerId, observationId, {
        value: body.value, effectiveDate: body.effectiveDate, source: body.source,
      }, expected));
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 503;
      const code = error instanceof ApiError ? error.code : 'SERVICE_UNAVAILABLE';
      if (status >= 500) context.error('Catalog/setup API request failed', { code, invocationId: context.invocationId, ...failureDiagnostics(error) });
      else context.warn('Catalog/setup API request rejected', { code, status, invocationId: context.invocationId });
      return response(status, { code });
    }
  };
}
