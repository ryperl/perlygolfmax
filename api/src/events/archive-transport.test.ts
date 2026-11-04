import { createServer } from 'node:http';
import { TableClient } from '@azure/data-tables';
import { describe, expect, it } from 'vitest';
import { creator, event } from '../../test/fixtures.js';
import { TableEventStore } from './store.js';

describe('archive transaction SDK transport', () => {
  it('sends both conditional merges and reads the revision back after a batch without Location headers', async () => {
    let archived = false;
    let batch = '';
    const server = createServer((request, response) => {
      if (request.method === 'GET') {
        const membership = request.url?.includes('member');
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(membership ? {
          PartitionKey: event.id, RowKey: `member:${creator.objectId}`,
          'odata.etag': 'W/"owner-v1"', ...creator, role: 'owner',
        } : {
          PartitionKey: event.id, RowKey: 'event', ...event,
          'odata.etag': archived ? 'W/"event-v2"' : 'W/"event-v1"',
          status: archived ? 'archived' : 'active',
        }));
        return;
      }
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => { batch += chunk; });
      request.on('end', () => {
        archived = true;
        response.writeHead(202, { 'Content-Type': 'multipart/mixed; boundary=batchresponse_fixture' });
        response.end([
          '--batchresponse_fixture',
          'Content-Type: multipart/mixed; boundary=changesetresponse_fixture',
          '',
          '--changesetresponse_fixture',
          'Content-Type: application/http',
          'Content-Transfer-Encoding: binary',
          '',
          'HTTP/1.1 204 No Content',
          'ETag: W/"event-v2"',
          '',
          '--changesetresponse_fixture',
          'Content-Type: application/http',
          'Content-Transfer-Encoding: binary',
          '',
          'HTTP/1.1 204 No Content',
          'ETag: W/"owner-v2"',
          '',
          '--changesetresponse_fixture--',
          '--batchresponse_fixture--',
        ].join('\r\n'));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Local archive test server has no port.');
      const client = new TableClient(`http://127.0.0.1:${String(address.port)}`, 'Events', {
        allowInsecureConnection: true, retryOptions: { maxRetries: 0 },
      });
      await expect(new TableEventStore(client).setStatus(creator, event.id, 'archived', 'W/"event-v1"'))
        .resolves.toMatchObject({ status: 'archived', etag: 'W/"event-v2"', name: event.name });
      expect(batch).toMatch(/if-match: W\/"event-v1"/i);
      expect(batch).toMatch(/if-match: W\/"owner-v1"/i);
      expect(batch).toContain('"status":"archived"');
      expect(batch).not.toContain('DELETE ');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => {
        if (error) reject(error);
        else resolve();
      }));
    }
  });
});
