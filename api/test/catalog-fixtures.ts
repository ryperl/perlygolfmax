import { TableClient } from '@azure/data-tables';
import type { TransactionAction } from '@azure/data-tables';
import { vi } from 'vitest';
import { isRecord } from '../../src/contracts/events.js';
import type { CourseImportManifest, TeeProfile } from '../../src/domain/catalog.js';
import { canManageCatalog } from '../src/identity.js';
import { TableCourseCatalog } from '../src/catalog/courses.js';
import { TablePlayerCatalog } from '../src/catalog/players.js';
import type { StoredRow } from '../src/catalog/entities.js';
import { TableWorkspaceStore } from '../src/setup/store.js';
import { creator, event, settings } from './fixtures.js';

export const identifier = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export const tee: TeeProfile = {
  id: 101, name: 'Fictional Blue', category: 'Fictional category A', holeCount: 18,
  totalYardage: 6300, totalMeters: 5760, totalPar: 72, strokeAllocation: true, shorter: false,
  eligibleSides: 'All',
  ratings: [
    { type: 'Total', course: 72, slope: 120, bogey: 95 },
    { type: 'Front', course: 36, slope: 120, bogey: 47.5 },
    { type: 'Back', course: 36, slope: 120, bogey: 47.5 },
  ],
  holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, sourceId: index + 201, length: 350, par: 4, allocation: index + 1 })),
};
export const manifest: CourseImportManifest = {
  course: {
    provider: 'usga-ghin', sourceId: 11, name: 'Fictional Sample Course', status: 'Active',
    number: '11', city: 'Example Town', state: 'Example State',
    facility: { id: 12, status: 'Active', name: 'Fictional Sample Facility', number: '12', golfAssociationId: 13, address: 'Fictional address', longitude: 0, latitude: 0 },
    season: { name: 'All year', start: '01/01', end: '12/31', allYear: true },
  },
  teeProfileIds: [tee.id],
  provenance: { source: 'Fictional test source', exportedAt: null },
};

const missing = () => Object.assign(new Error('Fictional entity missing'), { statusCode: 404, code: 'ResourceNotFound' });
const conflict = (statusCode: number) => Object.assign(new Error('Fictional revision conflict'), { statusCode });
function rowKey(row: Readonly<Record<string, unknown>>): string {
  if (typeof row.partitionKey !== 'string' || typeof row.rowKey !== 'string') throw new Error('Invalid fictional table row');
  return `${row.partitionKey}|${row.rowKey}`;
}

export function memoryTable() {
  const table = new TableClient('https://fictional.table.core.windows.net', 'Events');
  let counter = 0;
  const rows = new Map<string, StoredRow>();
  const seed = (input: Readonly<Record<string, unknown>>, target = rows) => {
    const row: StoredRow = { ...input, etag: `revision-${String(++counter)}` };
    target.set(rowKey(input), row);
    return row;
  };
  const apply = (actions: TransactionAction[]) => {
    if (new Set(actions.map((action) => action[1].partitionKey)).size !== 1) throw new Error('Cross-partition transaction');
    const pending = new Map(rows);
    for (const action of actions) {
      const [operation, entity] = action;
      const key = rowKey(entity);
      const existing = pending.get(key);
      if (operation === 'create' && existing) throw conflict(409);
      if ((operation === 'update' || operation === 'delete') && !existing) throw missing();
      const options = action[3];
      if (options?.etag && options.etag !== existing?.etag) throw conflict(412);
      if (operation === 'delete') pending.delete(key);
      else seed(operation === 'update' && action[2] !== 'Replace' ? { ...existing, ...entity } : entity, pending);
    }
    rows.clear();
    for (const [key, row] of pending) rows.set(key, row);
  };
  const get = vi.spyOn(table, 'getEntity').mockImplementation((partition, row) => {
    const value = rows.get(`${partition}|${row}`);
    return value ? Promise.resolve({ ...value }) : Promise.reject(missing());
  });
  const create = vi.spyOn(table, 'createEntity').mockImplementation((row) => {
    if (rows.has(rowKey(row))) return Promise.reject(conflict(409));
    const saved = seed(row);
    return Promise.resolve({ etag: saved.etag });
  });
  const submit = vi.spyOn(table, 'submitTransaction').mockImplementation((actions) => {
    try { apply(actions); }
    catch (error) { return Promise.reject(error instanceof Error ? error : new Error('Invalid fictional transaction')); }
    return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
  });
  const list = vi.spyOn(table, 'listEntities').mockImplementation((options) => {
    const source = new TableClient('https://fictional.table.core.windows.net', 'Events').listEntities();
    vi.spyOn(source, 'byPage').mockImplementation(async function* (settings) {
      const filter = options?.queryOptions?.filter ?? '';
      const conditions = [...filter.matchAll(/(PartitionKey|RowKey|kind|roundId|playerId) (eq|ge|lt) '([^']*)'/g)];
      const matches = [...rows.values()].filter((row) => conditions.every((condition) => {
        const value = condition[1] === 'PartitionKey' ? row.partitionKey : condition[1] === 'RowKey' ? row.rowKey : row[condition[1] ?? ''];
        const expected = condition[3] ?? '';
        return typeof value === 'string' && (condition[2] === 'eq' ? value === expected : condition[2] === 'ge' ? value >= expected : value < expected);
      })).sort((left, right) => rowKey(left).localeCompare(rowKey(right)));
      const size = settings?.maxPageSize ?? 50;
      let start = 0;
      if (settings?.continuationToken) {
        const cursor: unknown = JSON.parse(Buffer.from(settings.continuationToken, 'base64').toString('utf8'));
        if (!isRecord(cursor)) throw new Error('Invalid fictional cursor');
        const nextPartitionKey = cursor.nextPartitionKey;
        const nextRowKey = cursor.nextRowKey;
        start = matches.findIndex((row) => row.partitionKey === nextPartitionKey && row.rowKey === nextRowKey);
        if (start < 0) start = matches.length;
      }
      const next = matches[start + size];
      const continuationToken = next ? Buffer.from(JSON.stringify({ nextPartitionKey: next.partitionKey, nextRowKey: next.rowKey })).toString('base64') : undefined;
      yield await Promise.resolve(Object.assign(matches.slice(start, start + size), continuationToken ? { continuationToken } : {}));
    });
    return source;
  });
  return { table, rows, seed, get, create, submit, list, apply };
}

export function catalogFixture() {
  const memory = memoryTable();
  const allowed = (identity: Parameters<typeof canManageCatalog>[0]) => canManageCatalog(identity, settings);
  const courses = new TableCourseCatalog(memory.table, allowed);
  const players = new TablePlayerCatalog(memory.table, allowed);
  const workspace = new TableWorkspaceStore(memory.table, courses, players, allowed);
  const seedEvent = () => {
    memory.seed({ partitionKey: event.id, rowKey: 'event', ...event, status: 'active' });
    memory.seed({ partitionKey: event.id, rowKey: `member:${creator.objectId}`, ...creator, role: 'owner' });
  };
  const publish = async (id = identifier(100), input = manifest, profiles: readonly TeeProfile[] = [tee], expected: string | null = null) => {
    await courses.start(creator, id, input);
    for (const profile of profiles) await courses.putProfile(creator, id, profile.id, profile);
    return courses.publish(creator, id, expected);
  };
  return { ...memory, courses, players, workspace, seedEvent, publish };
}
