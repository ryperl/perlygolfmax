import { createServer } from 'node:http';
import { TableClient } from '@azure/data-tables';
import { describe, expect, it } from 'vitest';
import { isRecord } from '../../../src/contracts/events.js';
import { isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event } from '../../test/fixtures.js';
import { TableCourseCatalog } from '../catalog/courses.js';
import { TablePlayerCatalog } from '../catalog/players.js';
import { optionalRow } from '../catalog/entities.js';
import { TableWorkspaceStore } from '../setup/store.js';
import { TableScoreStore } from './store.js';
import { scoringLock } from './lock.js';

function batchResponse(statuses: readonly { readonly status: number; readonly etag?: string; readonly code?: string }[]): string {
  return [
    '--batchresponse_fixture', 'Content-Type: multipart/mixed; boundary=changesetresponse_fixture', '',
    ...statuses.flatMap(({ status, etag, code }) => [
      '--changesetresponse_fixture', 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', '',
      `HTTP/1.1 ${String(status)} ${status === 204 ? 'No Content' : 'Precondition Failed'}`,
      ...(etag ? [`ETag: ${etag}`] : []),
      ...(code ? ['Content-Type: application/json'] : []), '',
      ...(code ? [JSON.stringify({ 'odata.error': { code, message: { value: 'Fictional conditional failure' } } })] : []),
    ]),
    '--changesetresponse_fixture--', '--batchresponse_fixture--',
  ].join('\r\n');
}

describe('scoring real installed Table SDK loopback transport', () => {
  it('creates/updates via atomic conditional batches, reads real revisions without Location, and decodes missing rows and conditional failures', async () => {
    const f = await scoringFixture();
    const rows = new Map<string, Record<string, unknown>>();
    for (const [key, row] of f.rows) {
      const { partitionKey, rowKey, etag: _etag, ...fields } = row;
      void _etag;
      rows.set(key, { ...fields, PartitionKey: partitionKey, RowKey: rowKey, 'odata.etag': 'W/"initial"' });
    }
    const batches: string[] = [];
    const requests: string[] = [];
    let race: 'event' | 'grant' | undefined;
    let missingCode = 'ResourceNotFound';
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? ''} ${request.url ?? ''}`);
      if (request.method === 'GET') {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        const filter = url.searchParams.get('$filter');
        if (filter !== null) {
          expect(url.searchParams.get('$top')).toBe('1');
          const conditions = [...filter.matchAll(/(PartitionKey|RowKey) (eq|ge|lt) '([^']*)'/g)];
          const evidence = [...rows.values()].filter((row) => conditions.every((condition) => {
            const value = row[condition[1] ?? ''];
            const expected = condition[3] ?? '';
            return typeof value === 'string' && (condition[2] === 'eq' ? value === expected : condition[2] === 'ge' ? value >= expected : value < expected);
          })).slice(0, 1);
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ value: evidence }));
          return;
        }
        const path = decodeURIComponent(request.url ?? '');
        const match = /PartitionKey='([^']+)',RowKey='([^']+)'/.exec(path);
        const key = match ? `${match[1] ?? ''}|${match[2] ?? ''}` : '';
        const row = rows.get(key);
        response.writeHead(row ? 200 : 404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(row ?? { 'odata.error': { code: missingCode, message: { value: 'Fictional missing record' } } }));
        return;
      }
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => { body += chunk; });
      request.on('end', () => {
        batches.push(body);
        if (race) {
          const key = `${event.id}|${race === 'event' ? 'event' : `member:${creator.objectId}`}`;
          const previous = rows.get(key);
          if (!previous) throw new Error('Missing fictional race row');
          rows.set(key, { ...previous, 'odata.etag': 'W/"racing-revision"' });
          race = undefined;
        }
        const pending = new Map(rows);
        const etag = `W/"batch-${String(batches.length)}"`;
        const operations = body.split(/content-type: application\/http/i).slice(1);
        if (operations.length === 0) throw new Error('Empty fictional scoring batch');
        let failure: { status: number; code: string } | undefined;
        for (const operation of operations) {
          const line = operation.split('\r\n').find((entry) => entry.startsWith('{'));
          if (!line) throw new Error('Missing fictional transport entity');
          const entity: unknown = JSON.parse(line);
          if (!isRecord(entity) || typeof entity.PartitionKey !== 'string' || typeof entity.RowKey !== 'string') throw new Error('Invalid fictional transport entity');
          const key = `${entity.PartitionKey}|${entity.RowKey}`;
          const previous = pending.get(key);
          const create = /POST http/.test(operation);
          const expected = /if-match: ([^\r\n]+)/i.exec(operation)?.[1];
          if (create && previous) failure = { status: 409, code: 'EntityAlreadyExists' };
          if (!create && !previous) failure = { status: 404, code: 'ResourceNotFound' };
          if (!create && expected !== previous?.['odata.etag']) failure = { status: 412, code: 'UpdateConditionNotSatisfied' };
          pending.set(key, { ...(operation.includes('PATCH http') ? previous : {}), ...entity, 'odata.etag': etag });
        }
        if (!failure) {
          rows.clear();
          for (const [key, row] of pending) rows.set(key, row);
        }
        response.writeHead(202, { 'Content-Type': 'multipart/mixed; boundary=batchresponse_fixture' });
        response.end(batchResponse(failure ? [failure] : operations.map(() => ({ status: 204, etag }))));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Fictional scoring server has no port');
      const table = new TableClient(`http://127.0.0.1:${String(address.port)}`, 'Events', {
        allowInsecureConnection: true, retryOptions: { maxRetries: 0 },
      });
      const workspace = new TableWorkspaceStore(table, new TableCourseCatalog(table, () => false), new TablePlayerCatalog(table, () => false), () => false);
      const scores = new TableScoreStore(table, workspace);
      const initial = await scores.get(creator, event.id, f.roundId);
      expect(initial.cards[0]?.etag).toBeNull();
      const first = await scores.write(creator, event.id, f.roundId, f.playerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(600));
      expect(first.round.setupLocked).toBe(true);
      expect(first.round.lastUpdatedAt).toEqual(expect.any(String));
      expect(first.round.cards[0]?.etag).toBe('W/"batch-1"');
      expect(isScoreWriteResult(first)).toBe(true);
      expect(first.round.cards[0]?.etag).toBe('W/"batch-1"');
      expect(batches[0]?.match(/if-match: W\/"initial"/gi)).toHaveLength(2);
      expect(batches[0]?.match(/POST http/g)).toHaveLength(3);
      expect(batches[0]).toContain(`"RowKey":"score-card:${f.roundId}:${f.playerId}"`);
      expect(batches[0]).toContain(`"RowKey":"score-change:${identifier(600)}"`);
      expect(batches[0]).toContain(`"RowKey":"score-lock:${f.roundId}"`);
      const corrected = await scores.write(creator, event.id, f.roundId, f.playerId, 1, { kind: 'picked-up' }, first.round.cards[0]?.etag ?? null, identifier(601));
      expect(corrected.round.cards[0]?.etag).toBe('W/"batch-2"');
      expect(corrected.change.before).toEqual({ kind: 'strokes', strokes: 4 });
      expect(batches[1]?.match(/if-match: W\/"batch-1"/gi)).toHaveLength(3);
      expect(batches[1]?.match(/POST http/g)).toHaveLength(1);
      expect(batches[1]).toMatch(/PUT http[^\r\n]+score-card/);
      expect(batches[1]).not.toContain('"RowKey":"score-lock:');
      expect(requests.filter((entry) => entry.startsWith('GET') && decodeURIComponent(entry).includes(`RowKey='score-card:${f.roundId}:${f.playerId}'`)).length).toBeGreaterThan(2);
      for (const kind of ['event', 'grant'] as const) {
        race = kind;
        await expect(scores.write(creator, event.id, f.roundId, f.playerId, 2, { kind: 'unplayed' }, corrected.round.cards[0]?.etag ?? null, identifier(kind === 'event' ? 602 : 603))).rejects.toMatchObject({ code: 'SCORECARD_CHANGED', status: 409 });
      }
      expect(rows.has(`${event.id}|score-change:${identifier(602)}`)).toBe(false);
      expect(rows.has(`${event.id}|score-change:${identifier(603)}`)).toBe(false);
      expect((await scores.get(creator, event.id, f.roundId)).cards[0]?.holes[0]?.score).toEqual({ kind: 'picked-up' });
      await scores.write(creator, event.id, f.roundId, identifier(201), 1, { kind: 'unplayed' }, null, identifier(604));
      expect(batches[4]?.match(/POST http/g)).toHaveLength(2);
      expect(batches[4]).toMatch(/PUT http[^\r\n]+score-lock/);
      expect(batches[4]).toMatch(/if-match: W\/"batch-1"/i);
      expect(await scoringLock(table, event.id, f.roundId)).toMatchObject({
        writtenPlayerIds: [f.playerId, identifier(201)], requestId: identifier(600), etag: 'W/"batch-5"',
      });
      const current = await workspace.get(creator, event.id);
      const lockKey = `${event.id}|score-lock:${f.roundId}`;
      const storedLock = rows.get(lockKey);
      if (!storedLock) throw new Error('Missing fictional transport lock');
      rows.delete(lockKey);
      const batchCount = batches.length;
      await expect(workspace.get(creator, event.id)).rejects.toMatchObject({ code: 'INVALID_STORED_SCORE_LOCK', status: 503 });
      await expect(workspace.save(creator, event.id, f.input, current.etag)).rejects.toMatchObject({ status: 403 });
      const managerWorkspace = new TableWorkspaceStore(table, new TableCourseCatalog(table, () => true), new TablePlayerCatalog(table, () => true), () => true);
      await expect(managerWorkspace.save(creator, event.id, f.input, current.etag)).rejects.toMatchObject({ code: 'INVALID_STORED_SCORE_LOCK', status: 503 });
      await expect(managerWorkspace.refreshIndices(creator, event.id, f.roundId, identifier(605), current.etag)).rejects.toMatchObject({ code: 'INVALID_STORED_SCORE_LOCK', status: 503 });
      expect(batches).toHaveLength(batchCount);
      expect(rows.has(lockKey)).toBe(false);
      rows.set(lockKey, storedLock);
      rows.delete(`${event.id}|score-card:${f.roundId}:${identifier(201)}`);
      await expect(scores.get(creator, event.id, f.roundId)).rejects.toMatchObject({ code: 'INVALID_STORED_SCORECARD' });
      expect(await optionalRow(table, event.id, 'missing-card')).toBeUndefined();
      missingCode = 'TableNotFound';
      await expect(optionalRow(table, event.id, 'missing-card')).rejects.toMatchObject({
        statusCode: 404, details: { odataError: { code: 'TableNotFound' } },
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve(); }));
    }
  });
});
