import type { TableClient } from '@azure/data-tables';
import { isConflict, optionalRow, revision } from '../catalog/entities.js';
import { ApiError } from '../errors.js';

/** Fence inactive staging independently of business revisions, including pre-header Quick creation uploads. */
export async function createEventOwnedEntity(table: TableClient, eventId: string,
  entity: Readonly<Record<string, unknown>> & { readonly partitionKey: string; readonly rowKey: string }): Promise<void> {
  if (entity.partitionKey !== eventId || entity.rowKey === 'event' || entity.rowKey === 'event-write-fence') {
    throw new ApiError(503, 'INVALID_EVENT_STAGING_TARGET');
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    let fence = await optionalRow(table, eventId, 'event-write-fence');
    if (!fence) {
      try { await table.createEntity({ partitionKey: eventId, rowKey: 'event-write-fence', state: 'writable' }); }
      catch (error) { if (!isConflict(error)) throw error; }
      fence = await optionalRow(table, eventId, 'event-write-fence');
    }
    if (!fence || fence.state !== 'writable') throw new ApiError(409, 'EVENT_DELETION_IN_PROGRESS');
    try {
      await table.submitTransaction([
        ['update', { partitionKey: eventId, rowKey: 'event-write-fence', state: 'writable' }, 'Merge', { etag: revision(fence) }],
        ['create', entity],
      ]);
      return;
    } catch (error) {
      if (!isConflict(error) || await optionalRow(table, eventId, entity.rowKey)) throw error;
    }
  }
  throw new ApiError(409, 'EVENT_STAGING_CHANGED');
}
