import { createServer } from 'node:http';
import { TableClient } from '@azure/data-tables';
import { describe, expect, it } from 'vitest';
import { creator } from '../test/fixtures.js';
import { TableRequestLimiter } from './limits.js';
import { isMissingTableEntity, tableErrorCode } from './table-errors.js';

describe('Table Storage missing-entity classification', () => {
  it('recognizes direct and SDK-mapped OData codes, but not other failures', () => {
    expect(isMissingTableEntity({ statusCode: 404, code: 'ResourceNotFound' })).toBe(true);
    expect(isMissingTableEntity({ statusCode: 404, details: { odataError: { code: 'ResourceNotFound' } } })).toBe(true);
    for (const error of [
      { statusCode: 404 },
      { statusCode: 404, code: 'TableNotFound' },
      { statusCode: 404, details: { odataError: { code: 'TableNotFound' } } },
      { statusCode: 403, details: { odataError: { code: 'ResourceNotFound' } } },
      { statusCode: 404, code: 'PARSE_ERROR', details: { odataError: { code: 'ResourceNotFound' } } },
      null,
    ]) {
      expect(isMissingTableEntity(error)).toBe(false);
    }
  });

  it('initializes a missing quota through the real SDK HTTP pipeline', async () => {
    const methods: string[] = [];
    const server = createServer((request, response) => {
      methods.push(request.method ?? '');
      request.resume();
      if (request.method === 'GET') {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          'odata.error': { code: 'ResourceNotFound', message: { lang: 'en-US', value: 'Fictional entity is absent.' } },
        }));
      } else {
        response.writeHead(204);
        response.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Local SDK test server has no port.');
      const table = new TableClient(`http://127.0.0.1:${String(address.port)}`, 'Events', {
        allowInsecureConnection: true, retryOptions: { maxRetries: 0 },
      });
      let failure: unknown;
      try { await table.getEntity('fictional', 'counter'); }
      catch (error) { failure = error; }
      expect(failure).toMatchObject({
        name: 'RestError', statusCode: 404,
        details: { odataError: { code: 'ResourceNotFound' } },
      });
      expect(tableErrorCode(failure)).toBe('ResourceNotFound');
      await expect(new TableRequestLimiter(table, () => 1).check(creator, 'identity-read')).resolves.toBeUndefined();
      expect(methods).toEqual(['GET', 'GET', 'POST']);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => {
        if (error) reject(error);
        else resolve();
      }));
    }
  });
});
