import type { EventPurseView, PurseChange, PurseConfiguration, PurseSelection, PurseWriteResult } from '../domain/purse-settings.js';
import { isDateOnly } from './catalog.js';
import { isEventRevision, isRecord, isUuid } from './events.js';
import { isPursePlan, isPurseTieResolution, isPurseView } from './purse.js';
import { isRoundScores } from './scoring.js';
import { isEventWorkspace } from './setup.js';
import { roundScoresMatchWorkspace } from './round-context.js';
import { samePursePlan, samePurseTieResolutions } from '../domain/purse.js';

function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function selection(value: unknown, eventId: string): value is PurseSelection {
  return isRecord(value) && keys(value, ['plan', 'resolutions'])
    && (value.plan === null || isPursePlan(value.plan) && value.plan.eventId === eventId)
    && Array.isArray(value.resolutions) && value.resolutions.every(isPurseTieResolution)
    && (value.plan !== null || value.resolutions.length === 0);
}

export function isPurseConfiguration(value: unknown): value is PurseConfiguration {
  if (!isRecord(value) || !keys(value, ['eventId', 'etag', 'plan', 'resolutions']) || !isUuid(value.eventId)) return false;
  return selection({ plan: value.plan, resolutions: value.resolutions }, value.eventId)
    && (value.plan === null ? value.etag === null : isEventRevision(value.etag));
}

export function isEventPurseView(value: unknown): value is EventPurseView {
  if (!isRecord(value) || !keys(value, ['workspace', 'roundScores', 'configuration', 'view'])
    || !isEventWorkspace(value.workspace)
    || value.workspace.event.role !== 'owner' && value.workspace.canViewScores !== true
    || !isPurseConfiguration(value.configuration) || value.configuration.eventId !== value.workspace.event.id
    || !Array.isArray(value.roundScores) || !value.roundScores.every(isRoundScores)
    || !roundScoresMatchWorkspace(value.workspace, value.roundScores)) return false;
  if (value.configuration.plan === null) return value.view === null;
  return isPurseView(value.view, value.workspace, value.roundScores)
    && sameSelection(value.configuration, value.view);
}

function sameSelection(left: PurseSelection, right: PurseSelection): boolean {
  return samePursePlan(left.plan, right.plan) && samePurseTieResolutions(left.resolutions, right.resolutions);
}

export function isPurseChange(value: unknown): value is PurseChange {
  if (!isRecord(value) || !keys(value, ['id', 'eventId', 'expectedEtag', 'before', 'after', 'recordedAt', 'recordedBy'])
    || !isUuid(value.id) || !isUuid(value.eventId)
    || !selection(value.before, value.eventId) || !selection(value.after, value.eventId) || value.after.plan === null
    || (value.before.plan === null ? value.expectedEtag !== null : !isEventRevision(value.expectedEtag))
    || typeof value.recordedAt !== 'string' || value.recordedAt.length > 40
    || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value.recordedAt)
    || !isDateOnly(value.recordedAt.slice(0, 10)) || !Number.isFinite(Date.parse(value.recordedAt))
    || !isRecord(value.recordedBy) || !keys(value.recordedBy, ['tenantId', 'objectId'])
    || !isUuid(value.recordedBy.tenantId) || !isUuid(value.recordedBy.objectId)) return false;
  return true;
}

export function isPurseWriteResult(value: unknown): value is PurseWriteResult {
  return isRecord(value) && keys(value, ['current', 'change']) && isEventPurseView(value.current)
    && isPurseChange(value.change) && value.change.eventId === value.current.workspace.event.id
    && value.current.configuration.etag !== null;
}
