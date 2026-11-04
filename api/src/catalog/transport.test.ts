import { createServer } from 'node:http';
import { TableClient } from '@azure/data-tables';
import { describe, expect, it } from 'vitest';
import { isRecord } from '../../../src/contracts/events.js';
import { canonical } from './entities.js';
import { TableCourseCatalog } from './courses.js';
import { TablePlayerCatalog } from './players.js';
import { TableWorkspaceStore } from '../setup/store.js';
import { isIndexRefreshAudit } from '../setup/index-refresh.js';
import { decode } from './entities.js';
import { identifier, manifest, tee } from '../../test/catalog-fixtures.js';
import { creator, event } from '../../test/fixtures.js';

describe('catalog and workspace SDK batch transport', () => {
  it('publishes separate immutable rows atomically and reads headers back without relying on 204 Location/row keys', async () => {
    const stored = new Map<string, Record<string, unknown>>();
    const store = (partitionKey: string, rowKey: string, fields: Record<string, unknown>) => {
      stored.set(`${partitionKey}|${rowKey}`, { PartitionKey: partitionKey, RowKey: rowKey, 'odata.etag': 'W/"fixture-v1"', ...fields });
    };
    const importId = identifier(100);
    store(`catalog:import:${importId}`, 'manifest', { content: canonical(manifest), importedAt: '2026-01-01T00:00:00Z' });
    store(`catalog:import:${importId}`, `profile:${String(tee.id)}`, { content: canonical(tee) });
    store(event.id, 'event', { ...event, status: 'active' });
    store(event.id, `member:${creator.objectId}`, { ...creator, role: 'owner' });
    const playerIds = [200, 201, 202, 203].map(identifier);
    for (const id of playerIds) store('catalog:players', `player:${id}`, {
      content: canonical({ id, displayName: `Fictional ${id.slice(-3)}`, createdAt: '2026-01-01T00:00:00Z', currentIndex: null, etag: 'stored-revision' }),
      requestName: 'fictional', lastObservationId: '',
    });
    const batches: string[] = [];
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? ''} ${request.url ?? ''}`);
      if (request.method === 'GET') {
        const path = decodeURIComponent(request.url ?? '');
        const match = /PartitionKey='([^']+)',RowKey='([^']+)'/.exec(path);
        const key = match ? `${match[1] ?? ''}|${match[2] ?? ''}` : '';
        const row = stored.get(key);
        response.writeHead(row ? 200 : 404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(row ?? { 'odata.error': { code: 'ResourceNotFound', message: { value: 'Fictional missing row' } } }));
        return;
      }
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => { body += chunk; });
      request.on('end', () => {
        if (!request.url?.includes('$batch')) {
          const entity: unknown = JSON.parse(body);
          if (!isRecord(entity) || typeof entity.PartitionKey !== 'string' || typeof entity.RowKey !== 'string') throw new Error('Invalid fictional transport create');
          store(entity.PartitionKey, entity.RowKey, entity);
          response.writeHead(204, { ETag: 'W/"fixture-v1"' });
          response.end();
          return;
        }
        batches.push(body);
        const etag = `W/"fixture-v${String(batches.length + 1)}"`;
        const lines = body.split('\r\n').filter((line) => line.startsWith('{'));
        for (const line of lines) {
          const entity: unknown = JSON.parse(line);
          if (!isRecord(entity) || typeof entity.PartitionKey !== 'string' || typeof entity.RowKey !== 'string') throw new Error('Invalid fictional transport entity');
          const key = `${entity.PartitionKey}|${entity.RowKey}`;
          stored.set(key, { ...stored.get(key), ...entity, 'odata.etag': etag });
        }
        response.writeHead(202, { 'Content-Type': 'multipart/mixed; boundary=batchresponse_fixture' });
        response.end([
          '--batchresponse_fixture', 'Content-Type: multipart/mixed; boundary=changesetresponse_fixture', '',
          ...lines.flatMap(() => [
            '--changesetresponse_fixture', 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', '',
            'HTTP/1.1 204 No Content', `ETag: ${etag}`, '',
          ]),
          '--changesetresponse_fixture--', '--batchresponse_fixture--',
        ].join('\r\n'));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Fictional transport server has no port');
      const table = new TableClient(`http://127.0.0.1:${String(address.port)}`, 'Events', { allowInsecureConnection: true, retryOptions: { maxRetries: 0 } });
      const courses = new TableCourseCatalog(table, () => true);
      const players = new TablePlayerCatalog(table, () => true);
      const workspace = new TableWorkspaceStore(table, courses, players, () => true);
      const version = await courses.publish(creator, importId, null);
      expect(version.data.teeProfiles).toEqual([tee]);
      expect(batches).toHaveLength(1);
      expect(batches[0]).toContain(`"RowKey":"version:${version.id}:profile:${String(tee.id)}"`);
      expect(batches[0]).toContain(`"RowKey":"publication:${importId}"`);
      expect(requests.some((value) => decodeURIComponent(value).includes(`RowKey='version:${version.id}'`))).toBe(true);
      const saved = await workspace.save(creator, event.id, {
        name: 'Fictional Saved', location: 'Fictional Location', playerIds,
        rounds: [{
          id: identifier(500), name: 'Fictional Round', courseId: version.courseId, courseVersionId: version.id,
          teeProfileId: tee.id, groups: [{ number: 1, playerIds }],
        }],
      }, 'W/"fixture-v1"');
      expect(saved).toMatchObject({ event: { name: 'Fictional Saved' }, etag: 'W/"fixture-v3"' });
      expect(saved.rounds[0]?.teeProfile).toEqual(tee);
      expect(batches).toHaveLength(2);
      expect(batches[1]?.match(/if-match: W\/"fixture-v1"/gi)).toHaveLength(2);
      expect(batches[1]).toContain('"RowKey":"workspace"');
      expect(batches[1]).toContain(`"RowKey":"round:${identifier(500)}"`);
      const initialIndex = { value: '+1.2', effectiveDate: '2026-03-01', source: 'Fictional initial manual source' };
      const initial = await players.create(creator, identifier(204), 'Fictional Initially Known', initialIndex);
      expect(initial.currentIndex).toMatchObject({
        id: initial.id, ...initialIndex, recordedBy: creator, previousObservationId: null,
      });
      expect(batches[2]).toContain(`"RowKey":"player:${initial.id}"`);
      expect(batches[2]).toContain(`"RowKey":"index:${initial.id}:${initial.id}"`);
      expect(batches[2]?.match(/POST /g)).toHaveLength(2);
      const unknown = await players.create(creator, identifier(205), 'Fictional Unknown');
      expect(unknown.currentIndex).toBeNull();
      const player = await players.get(creator, playerIds[0] ?? '');
      const latest = await players.observe(creator, player.id, identifier(310), initialIndex, player.etag);
      const refreshed = await workspace.refreshIndices(creator, event.id, identifier(500), identifier(600), saved.etag);
      expect(refreshed.rounds[0]?.players[0]?.handicapIndex).toEqual(latest.currentIndex);
      expect(refreshed.rounds[0]?.players[1]?.handicapIndex).toBeNull();
      expect(refreshed.etag).not.toBe(saved.etag);
      expect(batches[4]?.match(/if-match: W\/"fixture-v3"/gi)).toHaveLength(2);
      expect(batches[4]).toContain(`"RowKey":"index-refresh:${identifier(600)}"`);
      const audit = decode(stored.get(`${event.id}|index-refresh:${identifier(600)}`)?.content, isIndexRefreshAudit);
      expect(audit.previous[0]?.handicapIndex).toBeNull();
      expect(audit.updated[0]?.handicapIndex).toEqual(latest.currentIndex);
      expect(await workspace.refreshIndices(creator, event.id, identifier(500), identifier(600), saved.etag)).toEqual(refreshed);
      expect(batches).toHaveLength(5);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => {
        if (error) reject(error); else resolve();
      }));
    }
  });
});
