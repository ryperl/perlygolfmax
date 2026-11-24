import { describe, expect, it } from 'vitest';
import {
  isAdministrableEvent, isEventDeletionPage, isEventDeletionResult, isEventRestoreResult, isQuickRoundAdministrationPage,
} from './event-administration';

const id = '00000000-0000-4000-8000-000000000001';
const item = { id, name: 'Fictional Quick round', status: 'archived', etag: 'fictional-v1' };

describe('Event administration allowlisted contracts', () => {
  it('accepts bounded summaries without fabricating owner roles and rejects private fields', () => {
    expect(isAdministrableEvent(item)).toBe(true);
    expect(isQuickRoundAdministrationPage({ events: [item], continuationToken: 'fictional' })).toBe(true);
    expect(isQuickRoundAdministrationPage({ events: Array.from({ length: 51 }, () => item) })).toBe(false);
    for (const extra of [{ role: 'owner' }, { scores: [] }, { recordedBy: id }, { createdAt: '2026-01-01' }]) {
      expect(isAdministrableEvent({ ...item, ...extra })).toBe(false);
    }
    expect(isAdministrableEvent({ ...item, status: 'deleted' })).toBe(false);
    expect(isQuickRoundAdministrationPage({ events: [item], continuationToken: '' })).toBe(false);
  });

  it('distinguishes cleanup progress from completion and excludes completed jobs from pending pages', () => {
    const pending = { eventId: id, requestId: id, state: 'deleting' };
    expect(isEventDeletionResult(pending)).toBe(true);
    expect(isEventDeletionResult({ ...pending, state: 'deleted' })).toBe(true);
    expect(isEventDeletionPage({ deletions: [pending] })).toBe(true);
    expect(isEventDeletionPage({ deletions: [{ ...pending, state: 'deleted' }] })).toBe(false);
    expect(isEventDeletionResult({ ...pending, confirmation: item.name })).toBe(false);
    expect(isEventDeletionResult({ ...pending, state: 'success' })).toBe(false);
    expect(isEventDeletionResult({ ...pending, progress: { stage: 'records', removed: 50 } })).toBe(true);
    expect(isEventDeletionResult({ ...pending, progress: { stage: 'finished', removed: 0 } })).toBe(true);
    for (const progress of [{ stage: 'unknown', removed: 1 }, { stage: 'links', removed: -1 }, { stage: 'links', removed: 1.5 },
      { stage: 'links' }, { stage: 'links', removed: 1, eventName: item.name }, 'records']) {
      expect(isEventDeletionResult({ ...pending, progress })).toBe(false);
    }
    expect(isEventRestoreResult({ eventId: id, requestId: id, status: 'active' })).toBe(true);
    expect(isEventRestoreResult({ eventId: id, requestId: 'invalid', status: 'active' })).toBe(false);
  });
});
