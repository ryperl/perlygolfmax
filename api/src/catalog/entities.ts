import { createHash } from 'node:crypto';
import type { TableClient, TableEntityResult, TransactionAction } from '@azure/data-tables';
import { isEventRevision, isRecord } from '../../../src/contracts/events.js';
import { ApiError } from '../errors.js';
import { isMissingTableEntity } from '../table-errors.js';

export type StoredRow = TableEntityResult<Record<string, unknown>>;

export async function optionalRow(table: TableClient, partition: string, row: string): Promise<StoredRow | undefined> {
  try { return await table.getEntity(partition, row); }
  catch (error) {
    if (isMissingTableEntity(error)) return undefined;
    throw error;
  }
}

export function decode<T>(value: unknown, validate: (value: unknown) => value is T): T {
  if (typeof value !== 'string') throw new ApiError(503, 'INVALID_STORED_CATALOG');
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new ApiError(503, 'INVALID_STORED_CATALOG'); }
  if (!validate(parsed)) throw new ApiError(503, 'INVALID_STORED_CATALOG');
  return parsed;
}

export function revision(row: StoredRow): string {
  if (!isEventRevision(row.etag)) throw new ApiError(503, 'INVALID_STORED_REVISION');
  return row.etag;
}

export function canonical(value: unknown): string {
  if (value === undefined) throw new ApiError(503, 'INVALID_STORED_CATALOG');
  if (Array.isArray(value)) return `[${value.map((item: unknown) => canonical(item)).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function isConflict(error: unknown): boolean {
  return isRecord(error) && (error.statusCode === 409 || error.statusCode === 412 || isMissingTableEntity(error));
}

export async function transaction(table: TableClient, actions: TransactionAction[], code: string): Promise<void> {
  try { await table.submitTransaction(actions); }
  catch (error) {
    if (isConflict(error)) throw new ApiError(409, code);
    throw error;
  }
}

export async function page(table: TableClient, filter: string, cursor?: string): Promise<{ rows: readonly StoredRow[]; continuationToken?: string }> {
  const next = await table.listEntities({ queryOptions: { filter } })
    .byPage({ maxPageSize: 50, ...(cursor ? { continuationToken: cursor } : {}) }).next();
  if (next.done) return { rows: [] };
  return { rows: next.value, ...(next.value.continuationToken ? { continuationToken: next.value.continuationToken } : {}) };
}
