import { createHash } from 'node:crypto';
import type { HttpRequest } from '@azure/functions';
import type { TableClient } from '@azure/data-tables';
import type { AccountIdentity } from '../../src/domain/events.js';
import {
  isPrivateUpload, isPrivateUploadPart, maximumPrivateValueBytes, privateReadPartCharacters, privateWritePartBytes,
} from '../../src/contracts/private-values.js';
import { isRecord } from '../../src/contracts/events.js';
import { canonical, isConflict, optionalRow } from './catalog/entities.js';
import { ApiError } from './errors.js';

export interface StagedPublication {
  readonly id: string;
  readonly sha256: string;
}

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Call only after checking current event/grant authority. Each request still consumes its ordinary write quota. */
export async function receivePrivateWrite(table: TableClient, identity: AccountIdentity, eventId: string, target: string,
  expected: string | null, requestId: string | null, body: unknown): Promise<
    { readonly kind: 'value'; readonly value: unknown; readonly publication?: StagedPublication }
    | { readonly kind: 'part'; readonly id: string; readonly index: number }
  > {
  if (!isRecord(body) || !Object.hasOwn(body, 'privateUpload') && !Object.hasOwn(body, 'privateCommit')) return { kind: 'value', value: body };
  if (Object.keys(body).length !== 1) throw new ApiError(400, 'INVALID_PRIVATE_UPLOAD');
  const upload = body.privateUpload ?? body.privateCommit;
  if (!isPrivateUpload(upload)) throw new ApiError(400, 'INVALID_PRIVATE_UPLOAD');
  const binding = canonical({ eventId, target, identity, expected, requestId, id: upload.id, bytes: upload.bytes, parts: upload.parts, sha256: upload.sha256 });
  const prefix = `private-upload:${upload.id}:`;
  // The manifest reserves this operation ID for exactly one actor, target, revision and byte sequence.
  const manifest = { partitionKey: eventId, rowKey: `${prefix}manifest`, binding };
  try { await table.createEntity(manifest); }
  catch (error) {
    if (!isConflict(error)) throw error;
    const saved = await optionalRow(table, eventId, manifest.rowKey);
    if (saved?.binding !== binding) throw new ApiError(409, 'PRIVATE_UPLOAD_CONFLICT');
  }
  if (body.privateUpload !== undefined) {
    if (!isPrivateUploadPart(upload)) throw new ApiError(400, 'INVALID_PRIVATE_UPLOAD');
    const bytes = Buffer.from(upload.content, 'base64');
    if (bytes.toString('base64') !== upload.content || bytes.length !== Math.min(privateWritePartBytes, upload.bytes - upload.index * privateWritePartBytes)) {
      throw new ApiError(400, 'INVALID_PRIVATE_UPLOAD');
    }
    const entity = { partitionKey: eventId, rowKey: `${prefix}${String(upload.index).padStart(6, '0')}`, binding, content: upload.content };
    try { await table.createEntity(entity); }
    catch (error) {
      if (!isConflict(error)) throw error;
      const saved = await optionalRow(table, eventId, entity.rowKey);
      if (saved?.binding !== binding || saved.content !== upload.content) throw new ApiError(409, 'PRIVATE_UPLOAD_CONFLICT');
    }
    return { kind: 'part', id: upload.id, index: upload.index };
  }
  const buffers: Buffer[] = [];
  for (let index = 0; index < upload.parts; index++) {
    const row = await optionalRow(table, eventId, `${prefix}${String(index).padStart(6, '0')}`);
    if (!row || row.partitionKey !== eventId || row.rowKey !== `${prefix}${String(index).padStart(6, '0')}`
      || row.binding !== binding || typeof row.content !== 'string'
      || row.content.length > 4 * Math.ceil(privateWritePartBytes / 3)) throw new ApiError(409, 'PRIVATE_UPLOAD_INCOMPLETE');
    const buffer = Buffer.from(row.content, 'base64');
    if (buffer.toString('base64') !== row.content || buffer.length !== Math.min(privateWritePartBytes, upload.bytes - index * privateWritePartBytes)) {
      throw new ApiError(409, 'PRIVATE_UPLOAD_INCOMPLETE');
    }
    buffers.push(buffer);
  }
  const bytes = Buffer.concat(buffers);
  if (bytes.length !== upload.bytes || hash(bytes) !== upload.sha256) throw new ApiError(409, 'PRIVATE_UPLOAD_INCOMPLETE');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new ApiError(400, 'INVALID_JSON'); }
  return { kind: 'value', value, publication: { id: upload.id, sha256: upload.sha256 } };
}

/** Recomputed pages are digest-bound: a concurrent edit rejects, never combines two revisions. */
export function privateReadResponse(request: HttpRequest, value: unknown): unknown {
  const text = JSON.stringify(value);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > maximumPrivateValueBytes) throw new ApiError(413, 'PRIVATE_VALUE_TOO_LARGE');
  const rawIndex = request.query.get('privatePart');
  const expected = request.query.get('privateHash');
  if (rawIndex === null && text.length <= privateReadPartCharacters) return value;
  if (rawIndex !== null && (!/^(0|[1-9]\d{0,6})$/.test(rawIndex) || expected === null)) throw new ApiError(400, 'INVALID_PRIVATE_PAGE');
  const sha256 = hash(text);
  if (expected !== null && expected !== sha256) throw new ApiError(409, 'EVENT_CHANGED');
  const parts = Math.ceil(text.length / privateReadPartCharacters);
  const index = rawIndex === null ? 0 : Number(rawIndex);
  if (index >= parts) throw new ApiError(400, 'INVALID_PRIVATE_PAGE');
  return { privateRead: { sha256, index, parts, bytes, content: text.slice(index * privateReadPartCharacters, (index + 1) * privateReadPartCharacters) } };
}
