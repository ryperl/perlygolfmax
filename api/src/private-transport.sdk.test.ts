import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { TableClient } from '@azure/data-tables';
import { describe, expect, it } from 'vitest';
import { isRecord } from '../../src/contracts/events.js';
import { privateWritePartBytes } from '../../src/contracts/private-values.js';
import { identifier } from '../test/catalog-fixtures.js';
import { creator, event } from '../test/fixtures.js';
import { receivePrivateWrite } from './private-transport.js';
import { privateContent, stagePrivateContent } from './private-values.js';

describe('large-value installed Table SDK loopback', () => {
  it('round-trips bounded immutable upload/storage rows and preserves conflicts, missing fragments and transport errors', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const writes: string[] = [];
    let failNext = false;
    const server = createServer((request, response) => {
      if (request.method === 'GET') {
        const match = /PartitionKey='([^']+)',RowKey='([^']+)'/.exec(decodeURIComponent(request.url ?? ''));
        const row = match ? rows.get(`${match[1] ?? ''}|${match[2] ?? ''}`) : undefined;
        response.writeHead(row ? 200 : 404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(row ?? { 'odata.error': { code: 'ResourceNotFound', message: { value: 'Fictional missing fragment' } } }));
        return;
      }
      let text = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => { text += chunk; });
      request.on('end', () => {
        if (failNext) {
          failNext = false;
          response.writeHead(503, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ 'odata.error': { code: 'ServerBusy', message: { value: 'Fictional transport failure' } } }));
          return;
        }
        const entity: unknown = JSON.parse(text);
        if (request.method !== 'POST' || !isRecord(entity) || typeof entity.PartitionKey !== 'string' || typeof entity.RowKey !== 'string') {
          response.writeHead(400); response.end(); return;
        }
        const key = `${entity.PartitionKey}|${entity.RowKey}`;
        if (rows.has(key)) {
          response.writeHead(409, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ 'odata.error': { code: 'EntityAlreadyExists', message: { value: 'Fictional immutable row exists' } } }));
          return;
        }
        writes.push(text);
        rows.set(key, { ...entity, 'odata.etag': 'W/"fictional"' });
        response.writeHead(204, { ETag: 'W/"fictional"' });
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing fictional loopback port');
      const table = new TableClient(`http://127.0.0.1:${String(address.port)}`, 'Events', { allowInsecureConnection: true, retryOptions: { maxRetries: 0 } });
      const value = { fictional: 'Fictional ⛳ '.repeat(8000) };
      const bytes = Buffer.from(JSON.stringify(value));
      const upload = { id: identifier(9000), bytes: bytes.length, parts: Math.ceil(bytes.length / privateWritePartBytes),
        sha256: createHash('sha256').update(bytes).digest('hex') };
      const receive = (body: unknown) => receivePrivateWrite(table, creator, event.id, 'workspace', 'v1', null, body);
      for (let index = 0; index < upload.parts; index++) {
        const body = { privateUpload: { ...upload, index,
          content: bytes.subarray(index * privateWritePartBytes, (index + 1) * privateWritePartBytes).toString('base64') } };
        expect((await receive(body)).kind).toBe('part');
        if (index === 0) expect((await receive(body)).kind).toBe('part');
      }
      expect(await receive({ privateCommit: upload })).toMatchObject({ kind: 'value', value });
      await expect(receivePrivateWrite(table, creator, event.id, 'workspace', 'v2', null, { privateCommit: upload }))
        .rejects.toMatchObject({ code: 'PRIVATE_UPLOAD_CONFLICT' });
      const text = JSON.stringify(value);
      const pointer = await stagePrivateContent(table, event.id, 'workspace', creator, text);
      expect(await privateContent(table, event.id, 'workspace', pointer)).toBe(text);
      expect(writes.every((write) => {
        const entity: unknown = JSON.parse(write);
        return isRecord(entity) && (typeof entity.content !== 'string' || Buffer.byteLength(entity.content, 'utf16le') < 65536);
      })).toBe(true);
      const fragment = [...rows.keys()].find((key) => key.includes('|private-fragment:'));
      if (!fragment) throw new Error('Missing fictional storage fragment');
      rows.delete(fragment);
      await expect(privateContent(table, event.id, 'workspace', pointer)).rejects.toMatchObject({ code: 'INVALID_PRIVATE_FRAGMENT' });
      failNext = true;
      await expect(stagePrivateContent(table, event.id, 'round:fictional', creator, text)).rejects.toMatchObject({ statusCode: 503 });
      expect(rows.has(`${event.id}|workspace`)).toBe(false);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => {
        if (error) reject(error);
        else resolve();
      }));
    }
  });
});
