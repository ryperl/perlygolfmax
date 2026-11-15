import { createServer } from 'node:http';
import { TableClient } from '@azure/data-tables';
import { describe, expect, it } from 'vitest';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';

describe('event skins configuration installed SDK transport', () => {
  it('serializes event, owner and header conditionals plus immutable audit in one real Table SDK transaction', async () => {
    const f = await scoringFixture(1);
    const owner = f.rows.get(`${event.id}|member:${creator.objectId}`);
    const header = f.rows.get(`${event.id}|workspace`);
    if (!owner || !header) throw new Error('Missing fictional setup.');
    let batch = '';
    const server = createServer((request, response) => {
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => { batch += chunk; });
      request.on('end', () => {
        response.writeHead(202, { 'Content-Type': 'multipart/mixed; boundary=batchresponse_fixture' });
        response.end(['--batchresponse_fixture', 'Content-Type: multipart/mixed; boundary=changesetresponse_fixture', '',
          ...Array.from({ length: 4 }, (_, index) => [
            '--changesetresponse_fixture', 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', '',
            'HTTP/1.1 204 No Content', `ETag: W/"fictional-${String(index)}"`, '',
          ]).flat(), '--changesetresponse_fixture--', '--batchresponse_fixture--'].join('\r\n'));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Fictional loopback has no port.');
      const sdk = new TableClient(`http://127.0.0.1:${String(address.port)}`, 'Events',
        { allowInsecureConnection: true, retryOptions: { maxRetries: 0 } });
      f.submit.mockImplementation(async (actions) => {
        const result = await sdk.submitTransaction(actions);
        f.apply(actions);
        return result;
      });
      const change = await f.scores.saveEventSkins(creator, event.id, { version: 1 }, f.saved.etag, identifier(8700));
      expect(change.after).toEqual({ version: 1 });
      expect(batch.toLowerCase()).toContain(`if-match: ${f.saved.etag}`);
      expect(batch.toLowerCase()).toContain(`if-match: ${owner.etag}`);
      expect(batch.toLowerCase()).toContain(`if-match: ${header.etag}`);
      expect(batch).toContain('event-skins-change:');
      expect(batch).toContain('\\"eventSkins\\":{\\"version\\":1}');
      expect((batch.match(/PATCH http/g) ?? [])).toHaveLength(3);
      expect((batch.match(/POST http/g) ?? [])).toHaveLength(1);
      expect(batch).not.toContain('DELETE ');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve(); }));
    }
  });
});
