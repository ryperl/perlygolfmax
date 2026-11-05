import type { PublicBrowseIdentity, PublicScoreIdentity } from '../domain/public-access.js';
import { isRecord, isUuid } from './events.js';

export function isPublicScoreIdentity(value: unknown): value is PublicScoreIdentity {
  return isRecord(value) && Object.keys(value).length === 2
    && Object.hasOwn(value, 'kind') && Object.hasOwn(value, 'eventId')
    && value.kind === 'public-score' && isUuid(value.eventId);
}

export function isPublicBrowseIdentity(value: unknown): value is PublicBrowseIdentity {
  return isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, 'kind') && value.kind === 'public-browse';
}
