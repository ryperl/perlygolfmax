import { isEventRevision, isRecord, isUuid } from '../contracts/events';
import { isCourseId, isVersionId } from '../contracts/catalog';
import { isEventSetupInput, isEventWorkspace } from '../contracts/setup';
import { isQuickCourse, isQuickCourseVersion, isQuickPage, isQuickPlayer } from '../contracts/quick-round';
import type { QuickCourse, QuickCourseVersion, QuickPage, QuickPlayer } from '../domain/quick-round';
import type { EventSetupInput, EventWorkspace } from '../domain/setup';
import { maximumEventSetupBytes } from '../domain/setup';
import { createPrivateRequest, readPrivateValue, writePrivateValue } from './private-request';
import { EventChangedError } from './events';
import { groupStartingHole } from '../domain/round-navigation';
import { sameTeeSelections } from '../domain/tees';

export interface QuickRoundClient {
  readonly archive?: (eventId: string, etag: string, requestId: string, signal: AbortSignal) => Promise<void>;
  readonly courses: (signal: AbortSignal, cursor?: string) => Promise<QuickPage<QuickCourse>>;
  readonly players: (signal: AbortSignal, cursor?: string) => Promise<QuickPage<QuickPlayer>>;
  readonly version: (courseId: string, versionId: string, signal: AbortSignal) => Promise<QuickCourseVersion>;
  readonly create: (eventId: string, input: EventSetupInput, signal: AbortSignal) => Promise<EventWorkspace>;
  readonly load: (eventId: string, signal: AbortSignal) => Promise<EventWorkspace>;
  readonly save: (eventId: string, etag: string, requestId: string, input: EventSetupInput, signal: AbortSignal) => Promise<EventWorkspace>;
}

export function createQuickRoundClient(apiUrl: string, send: typeof fetch = fetch): QuickRoundClient {
  const request = createPrivateRequest(`${apiUrl}/public/quick-rounds`,
    () => Promise.reject(new Error('Quick rounds do not acquire account tokens.')), send, maximumEventSetupBytes, 'None');
  function id(value: string) {
    if (!isUuid(value)) throw new Error('Invalid Quick round identifier.');
    return value;
  }
  function pagePath(path: string, cursor?: string) {
    if (cursor !== undefined && (!cursor || cursor.length > 2048)) throw new Error('Invalid selection cursor.');
    return `${path}${cursor ? `?${new URLSearchParams({ cursor }).toString()}` : ''}`;
  }
  async function load(eventId: string, signal: AbortSignal) {
    const value = await readPrivateValue(request, `${id(eventId)}/workspace`, signal);
    if (!isEventWorkspace(value) || value.event.id !== eventId || value.quickRound !== true
      || value.publicAccess !== true || value.event.role !== 'viewer' || value.event.status !== 'active'
      || value.rounds.length !== 1) throw new Error('This public Quick round could not be loaded.');
    return value;
  }
  async function write(eventId: string, etag: string | null, requestId: string, input: Parameters<QuickRoundClient['create']>[1], signal: AbortSignal) {
    id(eventId);
    if (!isUuid(requestId) || !isEventSetupInput(input) || input.rounds.length !== 1
      || input.overallCompetition !== undefined && input.overallCompetition !== null
      || etag !== null && !isEventRevision(etag)) throw new Error('Check the Quick round setup. Nothing was sent.');
    const value = await writePrivateValue(request, `${eventId}${etag === null ? '' : '/workspace'}`, signal, {
      method: 'PUT', body: input, requestId, ...(etag === null ? { createOnly: true } : { etag }),
    }, maximumEventSetupBytes);
    if (!isRecord(value) || value.eventId !== eventId || value.requestId !== requestId || !isEventRevision(value.workspaceEtag)) {
      throw new Error('Quick round save is uncertain. Your changes are kept. Retry or refresh saved data.');
    }
    const saved = await load(eventId, signal);
    const requested = input.rounds[0];
    const round = saved.rounds[0];
    if (!requested || !round || saved.event.name !== input.name || saved.location !== input.location
      || input.startDate !== undefined && input.startDate !== (saved.event.startDate ?? '')
      || input.endDate !== undefined && input.endDate !== (saved.event.endDate ?? '')
      || input.allowPerGolferTees !== undefined && input.allowPerGolferTees !== (saved.allowPerGolferTees ?? false)
      || saved.roster.length !== input.playerIds.length || saved.roster.some((player, index) => player.playerId !== input.playerIds[index])
      || round.id !== requested.id || round.name !== requested.name || round.courseId !== requested.courseId
      || round.courseVersionId !== requested.courseVersionId || round.teeProfile.id !== requested.teeProfileId
      || requested.roundSide !== undefined && requested.roundSide !== (round.roundSide ?? 'full')
      || requested.startDate !== undefined && requested.startDate !== (round.startDate ?? '')
      || requested.teeTime !== undefined && requested.teeTime !== (round.teeTime ?? '')
      || round.groups.length !== requested.groups.length || round.groups.some((group, index) => {
        const wanted = requested.groups[index];
        return !wanted || group.number !== wanted.number || group.playerIds.length !== wanted.playerIds.length
          || group.playerIds.some((playerId, playerIndex) => playerId !== wanted.playerIds[playerIndex])
          || groupStartingHole(group, round.teeProfile.holes) !== groupStartingHole(wanted, round.teeProfile.holes);
      })
      || requested.playerTeeSelections !== undefined && !sameTeeSelections(requested.playerTeeSelections,
        round.playerTees?.map((entry) => ({ playerId: entry.playerId, teeProfileId: entry.profile.id })), round.teeProfile.id)) {
      throw new EventChangedError('The save was acknowledged, but current setup differs. Your draft is retained; refresh and review before continuing.');
    }
    return saved;
  }
  return {
    load,
    async archive(eventId, etag, requestId, signal) {
      id(eventId);
      if (!isEventRevision(etag) || !isUuid(requestId)) throw new Error('Invalid Quick round archive request. Nothing was sent.');
      const value = await request(`${eventId}/archive`, signal, { method: 'PUT', body: {}, etag, requestId });
      if (!isRecord(value) || Object.keys(value).length !== 3 || value.eventId !== eventId
        || value.requestId !== requestId || value.status !== 'archived') {
        throw new Error('Archive is not confirmed. Refresh saved data before retrying.');
      }
    },
    create: (eventId, input, signal) => write(eventId, null, eventId, input, signal),
    save: (eventId, etag, requestId, input, signal) => write(eventId, etag, requestId, input, signal),
    async courses(signal, cursor) {
      const value = await request(pagePath('courses', cursor), signal);
      if (!isQuickPage(value, isQuickCourse)) throw new Error('Invalid Quick round course selections.');
      return value;
    },
    async players(signal, cursor) {
      const value = await request(pagePath('players', cursor), signal);
      if (!isQuickPage(value, isQuickPlayer)) throw new Error('Invalid Quick round player selections.');
      return value;
    },
    async version(courseId, versionId, signal) {
      if (!isCourseId(courseId) || !isVersionId(versionId)) throw new Error('Invalid course selection.');
      const value = await readPrivateValue(request, `courses/${encodeURIComponent(courseId)}/versions/${versionId}`, signal);
      if (!isQuickCourseVersion(value) || value.courseId !== courseId || value.id !== versionId) throw new Error('Invalid Quick round tee selections.');
      return value;
    },
  };
}
