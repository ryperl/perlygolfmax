import { createHash } from 'node:crypto';
import { HttpRequest } from '@azure/functions';
import { describe, expect, it } from 'vitest';
import { privateWritePartBytes, maximumPrivateWriteBytes } from '../../src/contracts/private-values.js';
import { memoryTable, identifier } from '../test/catalog-fixtures.js';
import { creator, event, member } from '../test/fixtures.js';
import { privateReadResponse, receivePrivateWrite } from './private-transport.js';

function upload(value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value));
  const manifest = { id: identifier(900), bytes: bytes.length, parts: Math.ceil(bytes.length / privateWritePartBytes),
    sha256: createHash('sha256').update(bytes).digest('hex') };
  const parts = Array.from({ length: manifest.parts }, (_, index) => ({ privateUpload: {
    ...manifest, index, content: bytes.subarray(index * privateWritePartBytes, (index + 1) * privateWritePartBytes).toString('base64'),
  } }));
  return { manifest, parts };
}

describe('bounded private transport', () => {
  it('idempotently stages bounded owner-bound parts and returns only a complete hash-checked value', async () => {
    const f = memoryTable();
    const value = { fictional: '⛳'.repeat(20_000) };
    const u = upload(value);
    const receive = (body: unknown) => receivePrivateWrite(f.table, creator, event.id, 'workspace', 'v1', null, body);
    for (const part of u.parts) {
      expect(Buffer.byteLength(JSON.stringify(part))).toBeLessThan(12 * 1024);
      expect((await receive(part)).kind).toBe('part');
      expect((await receive(part)).kind).toBe('part');
    }
    expect(await receive({ privateCommit: u.manifest })).toEqual({ kind: 'value', value, publication: { id: u.manifest.id, sha256: u.manifest.sha256 } });
    expect(await receive({ privateCommit: u.manifest })).toMatchObject({ kind: 'value', value });
    expect(f.rows.has(`${event.id}|workspace`)).toBe(false);
    for (const identity of [member, { ...creator, tenantId: member.objectId }]) {
      await expect(receivePrivateWrite(f.table, identity, event.id, 'workspace', 'v1', null, { privateCommit: u.manifest }))
        .rejects.toMatchObject({ code: 'PRIVATE_UPLOAD_CONFLICT' });
    }
    for (const [target, revision, request] of [['games', 'v1', null], ['workspace', 'v2', null], ['workspace', 'v1', identifier(999)]]) {
      if (typeof target !== 'string' || typeof revision !== 'string' || request !== null && typeof request !== 'string') throw new Error('Invalid fictional scope');
      await expect(receivePrivateWrite(f.table, creator, event.id, target, revision, request, { privateCommit: u.manifest }))
        .rejects.toMatchObject({ code: 'PRIVATE_UPLOAD_CONFLICT' });
    }
  });

  it('rejects missing/tampered parts, changed bytes, oversized manifests and malformed parts without partial publication', async () => {
    const f = memoryTable();
    const u = upload({ fictional: 'F'.repeat(20_000) });
    const receive = (body: unknown) => receivePrivateWrite(f.table, creator, event.id, 'workspace', 'v1', null, body);
    await receive(u.parts[0]);
    await expect(receive({ privateCommit: u.manifest })).rejects.toMatchObject({ code: 'PRIVATE_UPLOAD_INCOMPLETE' });
    for (const part of u.parts.slice(1)) await receive(part);
    await expect(receive({ privateCommit: { ...u.manifest, sha256: '0'.repeat(64) } })).rejects.toMatchObject({ code: 'PRIVATE_UPLOAD_CONFLICT' });
    await expect(receive({ privateCommit: { ...u.manifest, bytes: maximumPrivateWriteBytes + 1 } })).rejects.toMatchObject({ status: 400 });
    const first = u.parts[0]?.privateUpload;
    if (!first) throw new Error('Missing fictional part');
    await expect(receive({ privateUpload: { ...first, content: '%' } })).rejects.toMatchObject({ status: 400 });
    const row = [...f.rows.values()].find((entry) => typeof entry.content === 'string');
    if (!row) throw new Error('Missing fictional stored part');
    f.seed({ ...row, content: 'AAAA' });
    await expect(receive({ privateCommit: u.manifest })).rejects.toMatchObject({ code: 'PRIVATE_UPLOAD_INCOMPLETE' });
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('returns digest-bound read pages, preserves small legacy responses and rejects revision/page drift', () => {
    const request = (query = '') => new HttpRequest({ method: 'GET', url: `http://fictional.example.test/api/events/${event.id}/workspace${query}` });
    expect(privateReadResponse(request(), { fictional: 'small' })).toEqual({ fictional: 'small' });
    const value = { fictional: '⛳'.repeat(30_000) };
    const first = privateReadResponse(request(), value);
    expect(first).toHaveProperty('privateRead.index', 0);
    const hash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
    expect(privateReadResponse(request(`?privatePart=1&privateHash=${hash}`), value)).toHaveProperty('privateRead.index', 1);
    expect(() => privateReadResponse(request(`?privatePart=1&privateHash=${'0'.repeat(64)}`), value)).toThrow('EVENT_CHANGED');
    for (const query of ['?privatePart=-1', '?privatePart=999', `?privatePart=999&privateHash=${hash}`]) {
      expect(() => privateReadResponse(request(query), value)).toThrow('INVALID_PRIVATE_PAGE');
    }
  });
});
