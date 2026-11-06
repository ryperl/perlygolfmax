import type { TableClient } from '@azure/data-tables';
import type { PublicScoreIdentity } from '../../../src/domain/public-access.js';
import { isPublicScoreIdentity } from '../../../src/contracts/public-access.js';
import { isEventSummary } from '../../../src/contracts/events.js';
import type { EventAccess } from '../event-access.js';
import { optionalRow, revision } from '../catalog/entities.js';
import { ApiError } from '../errors.js';

export async function readPublicAccess(table: TableClient, identity: PublicScoreIdentity, eventId: string): Promise<EventAccess> {
  if (!isPublicScoreIdentity(identity) || identity.eventId !== eventId) throw new ApiError(403, 'PUBLIC_EVENT_NOT_AVAILABLE');
  const event = await optionalRow(table, eventId, 'event');
  if (!event || event.partitionKey !== eventId || event.rowKey !== 'event'
    || event.status !== undefined && event.status !== 'active') throw new ApiError(404, 'PUBLIC_EVENT_NOT_AVAILABLE');
  const summary: unknown = { id: eventId, name: event.name, createdAt: event.createdAt,
    ...(event.startDate === undefined || event.startDate === '' ? {} : { startDate: event.startDate }),
    status: 'active', etag: revision(event), role: 'viewer' };
  if (!isEventSummary(summary)) throw new ApiError(503, 'INVALID_STORED_EVENT');
  return { event, summary, admittedPlayer: false, publicAccess: true, authorityProofs: [event] };
}
