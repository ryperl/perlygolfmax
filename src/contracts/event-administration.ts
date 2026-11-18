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

export function isEventDeletionResult(value: unknown): value is EventDeletionResult {
  return isRecord(value) && keys(value, ['eventId', 'requestId', 'state'])
    && isUuid(value.eventId) && isUuid(value.requestId) && (value.state === 'deleting' || value.state === 'deleted');
}

export function isEventDeletionPage(value: unknown): value is EventDeletionPage {
  return isRecord(value) && keys(value, ['deletions', 'continuationToken']) && Array.isArray(value.deletions)
    && value.deletions.length <= 50 && value.deletions.every((item: unknown) =>
      isEventDeletionResult(item) && item.state === 'deleting') && cursor(value.continuationToken);
}
