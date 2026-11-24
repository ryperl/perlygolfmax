import { isEventRevision, isEventStatus, isRecord, isUuid, readEventName } from './events.js';
import type {
  AdministrableEvent, EventDeletionPage, EventDeletionResult, EventRestoreResult, QuickRoundAdministrationPage,
} from '../domain/event-administration.js';

function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function isAdministrableEvent(value: unknown): value is AdministrableEvent {
  return isRecord(value) && keys(value, ['id', 'name', 'status', 'etag']) && isUuid(value.id)
    && readEventName(value) === value.name && isEventStatus(value.status) && isEventRevision(value.etag);
}

function cursor(value: unknown): boolean {
  return value === undefined || typeof value === 'string' && value.length > 0 && value.length <= 4096;
}

export function isQuickRoundAdministrationPage(value: unknown): value is QuickRoundAdministrationPage {
  return isRecord(value) && keys(value, ['events', 'continuationToken']) && Array.isArray(value.events)
    && value.events.length <= 50 && value.events.every(isAdministrableEvent) && cursor(value.continuationToken);
}

export function isEventRestoreResult(value: unknown): value is EventRestoreResult {
  return isRecord(value) && keys(value, ['eventId', 'requestId', 'status'])
    && isUuid(value.eventId) && isUuid(value.requestId) && value.status === 'active';
}

function isDeletionProgress(value: unknown): boolean {
  if (!isRecord(value) || !keys(value, ['stage', 'removed'])) return false;
  const knownStage = value.stage === 'links' || value.stage === 'records' || value.stage === 'finished';
  return knownStage && Number.isSafeInteger(value.removed) && Number(value.removed) >= 0;
}

export function isEventDeletionResult(value: unknown): value is EventDeletionResult {
  if (!isRecord(value) || !keys(value, ['eventId', 'requestId', 'state', 'progress'])) return false;
  const knownState = value.state === 'deleting' || value.state === 'deleted';
  const validProgress = value.progress === undefined || isDeletionProgress(value.progress);
  return isUuid(value.eventId) && isUuid(value.requestId) && knownState && validProgress;
}

export function isEventDeletionPage(value: unknown): value is EventDeletionPage {
  return isRecord(value) && keys(value, ['deletions', 'continuationToken']) && Array.isArray(value.deletions)
    && value.deletions.length <= 50 && value.deletions.every((item: unknown) =>
      isEventDeletionResult(item) && item.state === 'deleting') && cursor(value.continuationToken);
}
