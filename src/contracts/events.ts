import type { EventCapabilities, EventPage, EventStatus, EventSummary } from '../domain/events.js';

export function isEventStatus(value: unknown): value is EventStatus {
  return value === 'active' || value === 'archived';
}

export function isEventRevision(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    && value !== '*' && /^[\x21-\x7e]+$/.test(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

export function readEventName(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.name !== 'string') return undefined;
  const name = value.name.trim();
  return name.length > 0 && name.length <= 100 ? name : undefined;
}

export function isEventStartDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] ?? 0);
}

export function isEventSummary(value: unknown): value is EventSummary {
  return isRecord(value) && isUuid(value.id)
    && typeof value.name === 'string' && readEventName(value) === value.name
    && (value.startDate === undefined || isEventStartDate(value.startDate))
    && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
    && (value.role === 'owner' || value.role === 'member' || value.role === 'viewer')
    && isEventStatus(value.status) && isEventRevision(value.etag);
}

export function isEventCapabilities(value: unknown): value is EventCapabilities {
  return isRecord(value) && typeof value.canCreateEvents === 'boolean' && typeof value.canManageCatalog === 'boolean';
}

export function isEventPage(value: unknown): value is EventPage {
  return isRecord(value) && Array.isArray(value.events) && value.events.every(isEventSummary)
    && (value.continuationToken === undefined || typeof value.continuationToken === 'string');
}
