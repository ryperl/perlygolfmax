import { odata } from '@azure/data-tables';
import type { TableClient, TransactionAction } from '@azure/data-tables';
import type { IndexObservation, ManualIndexInput, PlayerCatalogPage, PlayerIndexHistory, PlayerProfile } from '../../../src/domain/catalog.js';
import type { AccountIdentity } from '../../../src/domain/events.js';
import type { EventRosterPlayer } from '../../../src/domain/setup.js';
import { isIndexObservation, isManualIndexInput, isPlayerProfile } from '../../../src/contracts/catalog.js';
import { isUuid } from '../../../src/contracts/events.js';
import { ApiError } from '../errors.js';
import { canonical, decode, isConflict, optionalRow, page, revision, transaction } from './entities.js';
import type { StoredRow } from './entities.js';
import { requireManager } from './courses.js';
import type { CatalogPermission } from './courses.js';

const partitionKey = 'catalog:players';
const playerKey = (id: string) => `player:${id}`;
const observationKey = (id: string, observationId: string) => `index:${id}:${observationId}`;

function player(row: StoredRow, id: string): PlayerProfile {
  const result = decode(row.content, isPlayerProfile);
  if (result.id !== id || row.partitionKey !== partitionKey || row.rowKey !== playerKey(id)) {
    throw new ApiError(503, 'INVALID_STORED_CATALOG');
  }

  return {
    id: result.id, displayName: result.displayName, createdAt: result.createdAt,
    currentIndex: result.currentIndex, etag: revision(row),
  };
}

/** Resolve only already-authorized roster identities; this never exposes catalog profiles. */
export async function currentRosterNames(table: TableClient, roster: readonly EventRosterPlayer[]): Promise<readonly EventRosterPlayer[]> {
  const names: EventRosterPlayer[] = [];
  for (let index = 0; index < roster.length; index += 16) {
    names.push(...await Promise.all(roster.slice(index, index + 16).map(async (entry) => {
      const row = await optionalRow(table, partitionKey, playerKey(entry.playerId));
      if (!row) throw new ApiError(503, 'INVALID_STORED_PLAYER_NAME');
      const current = player(row, entry.playerId);
      return { playerId: entry.playerId, displayName: current.displayName };
    })));
  }
  return names;
}

export interface IndexInput {
  readonly value: string;
  readonly effectiveDate: string;
  readonly source: string;
}

export class TablePlayerCatalog {
  constructor(private readonly table: TableClient, private readonly allowed: CatalogPermission) {}

  async list(identity: AccountIdentity, cursor?: string): Promise<PlayerCatalogPage> {
    requireManager(identity, this.allowed);
    const result = await page(this.table, odata`PartitionKey eq ${partitionKey} and RowKey ge ${'player:'} and RowKey lt ${'player;'}`, cursor);
    const players = result.rows.map((row) => {
      const value = decode(row.content, isPlayerProfile);
      return player(row, value.id);
    });
    return { players, ...(result.continuationToken ? { continuationToken: result.continuationToken } : {}) };
  }

  private async row(id: string): Promise<StoredRow> {
    const row = await optionalRow(this.table, partitionKey, playerKey(id));
    if (!row) throw new ApiError(404, 'PLAYER_NOT_FOUND');
    return row;
  }

  async get(identity: AccountIdentity, id: string): Promise<PlayerProfile> {
    requireManager(identity, this.allowed);
    return player(await this.row(id), id);
  }

  async create(identity: AccountIdentity, id: string, displayName: string, initialIndex?: ManualIndexInput): Promise<PlayerProfile> {
    requireManager(identity, this.allowed);
    if (initialIndex !== undefined && !isManualIndexInput(initialIndex)) throw new ApiError(400, 'INVALID_INDEX_OBSERVATION');
    const index = initialIndex === undefined ? null : {
      value: initialIndex.value, effectiveDate: initialIndex.effectiveDate, source: initialIndex.source,
    };
    const requestPayload = canonical({ displayName, initialIndex: index });
    const createdAt = new Date().toISOString();
    const currentIndex: IndexObservation | null = index === null ? null : {
      id, value: index.value, effectiveDate: index.effectiveDate, source: index.source,
      recordedAt: createdAt, recordedBy: { tenantId: identity.tenantId, objectId: identity.objectId }, previousObservationId: null,
    };
    const content: PlayerProfile = { id, displayName, createdAt, currentIndex, etag: 'stored-revision' };
    const entity = {
      partitionKey, rowKey: playerKey(id), content: canonical(content), requestPayload,
      requestName: displayName, lastObservationId: currentIndex ? id : '',
    };
    try {
      if (currentIndex === null) await this.table.createEntity(entity);
      else {
        const actions: TransactionAction[] = [
          ['create', entity],
          ['create', { partitionKey, rowKey: observationKey(id, id), content: canonical(currentIndex) }],
        ];
        await this.table.submitTransaction(actions);
      }
    } catch (error) {
      if (!isConflict(error)) throw error;
      const existing = await optionalRow(this.table, partitionKey, playerKey(id));
      if (!existing) throw new ApiError(409, 'PLAYER_REQUEST_CONFLICT');
      if (existing.requestPayload === undefined) {
        if (index !== null || existing.requestName !== displayName) throw new ApiError(409, 'PLAYER_REQUEST_CONFLICT');
      } else {
        if (typeof existing.requestPayload !== 'string') throw new ApiError(503, 'INVALID_STORED_CATALOG');
        if (existing.requestPayload !== requestPayload) throw new ApiError(409, 'PLAYER_REQUEST_CONFLICT');
      }
      if (index !== null) {
        const audit = await optionalRow(this.table, partitionKey, observationKey(id, id));
        if (!audit) throw new ApiError(503, 'INVALID_STORED_CATALOG');
        const observation = decode(audit.content, isIndexObservation);
        if (observation.id !== id || observation.previousObservationId !== null || observation.value !== index.value
          || observation.effectiveDate !== index.effectiveDate || observation.source !== index.source) throw new ApiError(503, 'INVALID_STORED_CATALOG');
      }
    }
    return this.get(identity, id);
  }

  async rename(identity: AccountIdentity, id: string, displayName: string, etag: string): Promise<PlayerProfile> {
    requireManager(identity, this.allowed);
    const row = await this.row(id);
    const current = player(row, id);
    if (current.etag !== etag) throw new ApiError(409, 'PLAYER_CHANGED');
    await transaction(this.table, [
      ['update', { partitionKey, rowKey: playerKey(id), content: canonical({ ...current, displayName }) }, 'Merge', { etag }],
    ], 'PLAYER_CHANGED');
    return this.get(identity, id);
  }

  async history(identity: AccountIdentity, id: string, cursor?: string): Promise<PlayerIndexHistory> {
    requireManager(identity, this.allowed);
    await this.get(identity, id);
    const prefix = `index:${id}:`;
    const result = await page(this.table, odata`PartitionKey eq ${partitionKey} and RowKey ge ${prefix} and RowKey lt ${`index:${id};`}`, cursor);
    const observations = result.rows.map((row) => {
      const observation = decode(row.content, isIndexObservation);
      if (row.rowKey !== observationKey(id, observation.id)) throw new ApiError(503, 'INVALID_STORED_CATALOG');
      return observation;
    });
    return { observations, ...(result.continuationToken ? { continuationToken: result.continuationToken } : {}) };
  }

  private async replay(identity: AccountIdentity, id: string, observationId: string, input: IndexInput): Promise<boolean> {
    const row = await optionalRow(this.table, partitionKey, observationKey(id, observationId));
    if (!row) return false;
    const observation = decode(row.content, isIndexObservation);
    if (observation.id !== observationId || observation.value !== input.value || observation.effectiveDate !== input.effectiveDate
      || observation.source !== input.source || observation.recordedBy.tenantId !== identity.tenantId
      || observation.recordedBy.objectId !== identity.objectId) throw new ApiError(409, 'INDEX_REQUEST_CONFLICT');
    return true;
  }

  async observe(identity: AccountIdentity, id: string, observationId: string, input: IndexInput, etag: string): Promise<PlayerProfile> {
    requireManager(identity, this.allowed);
    if (await this.replay(identity, id, observationId, input)) return this.get(identity, id);
    const row = await this.row(id);
    const current = player(row, id);
    if (current.etag !== etag) throw new ApiError(409, 'PLAYER_CHANGED');
    if (typeof row.lastObservationId !== 'string' || row.lastObservationId !== '' && !isUuid(row.lastObservationId)) {
      throw new ApiError(503, 'INVALID_STORED_CATALOG');
    }
    const observation: IndexObservation = {
      id: observationId, value: input.value, effectiveDate: input.effectiveDate, source: input.source,
      recordedAt: new Date().toISOString(), recordedBy: { tenantId: identity.tenantId, objectId: identity.objectId },
      previousObservationId: row.lastObservationId || null,
    };
    const currentIndex = !current.currentIndex || input.effectiveDate >= current.currentIndex.effectiveDate ? observation : current.currentIndex;
    try {
      await this.table.submitTransaction([
        ['update', { partitionKey, rowKey: playerKey(id), content: canonical({ ...current, currentIndex }), lastObservationId: observationId }, 'Merge', { etag }],
        ['create', { partitionKey, rowKey: observationKey(id, observationId), content: canonical(observation) }],
      ]);
    } catch (error) {
      if (!isConflict(error)) throw error;
      if (!await this.replay(identity, id, observationId, input)) throw new ApiError(409, 'PLAYER_CHANGED');
    }
    return this.get(identity, id);
  }
}
