import type { StoredRow } from '../catalog/entities.js';
import { ApiError } from '../errors.js';

export function assertEventNotDeleting(event: StoredRow | undefined): void {
  if (event?.status === 'deleting' || event?.status === 'deleted'
    || event?.kind === 'event-deletion') throw new ApiError(404, 'EVENT_NOT_FOUND');
}
