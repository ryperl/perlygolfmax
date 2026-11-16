import type { EventReviewNotice } from '../domain/event-review.js';
import { eventReviewCodes } from '../domain/event-review.js';
import { boundedText } from './catalog.js';
import { isRecord, isUuid } from './events.js';

export function isEventReviewNotices(value: unknown): value is readonly EventReviewNotice[] {
  return Array.isArray(value) && value.every((notice: unknown) =>
    isRecord(notice) && Object.keys(notice).length === (Object.hasOwn(notice, 'contextId') ? 3 : 2)
    && Object.hasOwn(notice, 'code') && Object.hasOwn(notice, 'label')
    && (notice.contextId === undefined || isUuid(notice.contextId))
    && eventReviewCodes.some((code) => code === notice.code) && boundedText(notice.label, 303))
    && new Set(value.map((notice: EventReviewNotice) => JSON.stringify([notice.code, notice.contextId, notice.label]))).size === value.length;
}
