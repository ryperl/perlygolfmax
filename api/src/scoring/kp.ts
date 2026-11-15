import type { TableClient } from '@azure/data-tables';
import { isPurseConfiguration } from '../../../src/contracts/purse-settings.js';
import { isRecord, isUuid } from '../../../src/contracts/events.js';
import { isKpPool } from '../../../src/domain/purse.js';
import { decode, optionalRow, revision } from '../catalog/entities.js';
import { privateContent } from '../private-values.js';
import { ApiError } from '../errors.js';

export function configuredKpRounds(value: unknown): readonly string[] {
  if (value === undefined) return [];
  return decode(value, (entry): entry is readonly string[] => Array.isArray(entry)
    && entry.every(isUuid) && new Set(entry).size === entry.length);
}

export async function readKpPot(table: TableClient, eventId: string, roundId: string, configured: unknown) {
  const row = await optionalRow(table, eventId, 'purse');
  if (configured !== undefined && configured !== true || Boolean(row) !== (configured === true)) throw new ApiError(503, 'INVALID_STORED_PURSE');
  if (!row) return undefined;
  if (row.kind !== 'purse' || row.schemaVersion !== 1) throw new ApiError(503, 'INVALID_STORED_PURSE');
  const content = decode(await privateContent(table, eventId, 'purse', row.content), isRecord);
  const value: unknown = { ...content, etag: revision(row) };
  if (!isPurseConfiguration(value) || value.eventId !== eventId) throw new ApiError(503, 'INVALID_STORED_PURSE');
  const pools = value.plan?.pools.filter(isKpPool).filter((pool) => pool.source.roundId === roundId) ?? [];
  if (pools.length > 1) throw new ApiError(503, 'INVALID_STORED_PURSE');
  const pool = pools[0];
  return pool && value.plan ? { amountMinor: pool.amountMinor, currency: value.plan.currency } : undefined;
}
