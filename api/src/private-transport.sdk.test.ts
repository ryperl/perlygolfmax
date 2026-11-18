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
    let revision = 0;
    let blockNextBatch = false;
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
        if (request.url?.includes('$batch')) {
          if (blockNextBatch) {
            blockNextBatch = false;
            rows.set(`${event.id}|event-write-fence`, { PartitionKey: event.id, RowKey: 'event-write-fence',
              state: 'blocked', 'odata.etag': `W/"fictional-${String(++revision)}"` });
          }
          const pending = new Map(rows);
          const results: { readonly status: number; readonly etag?: string; readonly error?: string }[] = [];
          const pendingWrites: string[] = [];
          for (const part of text.split(/--changeset_[^\r\n]+/)) {
            const method = /^(POST|PATCH|PUT) .+ HTTP\/1\.1\r?$/m.exec(part)?.[1];
            const content = part.split(/\r?\n/).find((line) => line.startsWith('{'));
            if (!method || !content) continue;
            const entity: unknown = JSON.parse(content);
            if (!isRecord(entity) || typeof entity.PartitionKey !== 'string' || typeof entity.RowKey !== 'string') {
              results.push({ status: 400, error: 'InvalidInput' }); break;
            }
            const key = `${entity.PartitionKey}|${entity.RowKey}`;
            const saved = pending.get(key);
            const expected = /^if-match: (.+)\r?$/im.exec(part)?.[1]?.trim();
            if (method === 'POST' && saved) { results.push({ status: 409, error: 'EntityAlreadyExists' }); break; }
            if (method !== 'POST' && (!saved || expected !== saved['odata.etag'])) {
              results.push({ status: saved ? 412 : 404, error: saved ? 'UpdateConditionNotSatisfied' : 'ResourceNotFound' }); break;
            }
            const etag = `W/"fictional-${String(++revision)}"`;
            pending.set(key, { ...(method === 'PATCH' ? saved : {}), ...entity, 'odata.etag': etag });
            pendingWrites.push(content);
            results.push({ status: 204, etag });
          }
          if (!results.length) { response.writeHead(400); response.end(); return; }
          if (results.every((result) => result.status === 204)) {
            rows.clear();
            pending.forEach((value, key) => rows.set(key, value));
            writes.push(...pendingWrites);
          }
          const failed = results.find((result) => result.error);
          const body = [
            '--batchresponse_fictional', 'Content-Type: multipart/mixed; boundary=changesetresponse_fictional', '',
            ...(failed ? [failed] : results).flatMap((result) => [
              '--changesetresponse_fictional', 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', '',
              `HTTP/1.1 ${String(result.status)} ${result.error ?? 'No Content'}`,
              ...(result.etag ? [`ETag: ${result.etag}`] : ['Content-Type: application/json']), '',
              ...(result.error ? [JSON.stringify({ 'odata.error': { code: result.error, message: { value: 'Fictional conditional batch rejected' } } })] : []),
            ]),
            '--changesetresponse_fictional--', '--batchresponse_fictional--', '',
          ].join('\r\n');
          response.writeHead(202, { 'Content-Type': 'multipart/mixed; boundary=batchresponse_fictional' });
          response.end(body);
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
        const etag = `W/"fictional-${String(++revision)}"`;
        rows.set(key, { ...entity, 'odata.etag': etag });
        response.writeHead(204, { ETag: etag });
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
      const count = rows.size;
      blockNextBatch = true;
      await expect(stagePrivateContent(table, event.id, 'round:late', creator, text)).rejects.toMatchObject({ code: 'EVENT_DELETION_IN_PROGRESS' });
      expect(rows.size).toBe(count);
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
