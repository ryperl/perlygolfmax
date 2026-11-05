import { createHash } from 'node:crypto';
import type { TableClient } from '@azure/data-tables';
import type { ScoreActor } from '../../src/domain/test-access.js';
import { isScoreActor } from '../../src/contracts/scoring.js';
import { sameScoreActor } from '../../src/domain/scoring.js';
import { isRecord } from '../../src/contracts/events.js';
import { isSha256, maximumPrivateValueBytes } from '../../src/contracts/private-values.js';
import { canonical, decode, isConflict, optionalRow } from './catalog/entities.js';
import { ApiError } from './errors.js';

const fragmentBytes = 16 * 1024;
const inlineUtf16Bytes = 48 * 1024;

interface ContentPointer {
  readonly privateValue: 1;
  readonly target: string;
  readonly owner: ScoreActor;
  readonly sha256: string;
  readonly version: string;
  readonly bytes: number;
  readonly parts: number;
}

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function isPointer(value: unknown): value is ContentPointer {
  return isRecord(value) && value.privateValue === 1 && typeof value.target === 'string'
    && isScoreActor(value.owner)
    && isSha256(value.sha256) && isSha256(value.version)
    && typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= maximumPrivateValueBytes
    && typeof value.parts === 'number' && value.parts === Math.ceil(value.bytes / fragmentBytes);
}

function fragmentKey(version: string, index: number): string {
  return `private-fragment:${version}:${String(index).padStart(6, '0')}`;
}

/** Stages inactive immutable fragments. Only the caller's conditional publication activates the returned content. */
export async function stagePrivateContent(table: TableClient, eventId: string, target: string, owner: ScoreActor, text: string): Promise<string> {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > maximumPrivateValueBytes) throw new ApiError(413, 'PRIVATE_VALUE_TOO_LARGE');
  if (Buffer.byteLength(text, 'utf16le') <= inlineUtf16Bytes) return text;
  const sha256 = hash(bytes);
  const version = hash(canonical({ eventId, target, owner, sha256 }));
  const pointer: ContentPointer = { privateValue: 1, target, owner, sha256, version, bytes: bytes.length, parts: Math.ceil(bytes.length / fragmentBytes) };
  for (let index = 0; index < pointer.parts; index++) {
    const rowKey = fragmentKey(version, index);
    const content = bytes.subarray(index * fragmentBytes, (index + 1) * fragmentBytes).toString('base64');
    const entity = { partitionKey: eventId, rowKey, kind: 'private-fragment', target, version, index,
      ...('kind' in owner ? { ownerActor: canonical(owner) }
        : { ownerTenantId: owner.tenantId, ownerObjectId: owner.objectId }), content, sha256: hash(content) };
    try { await table.createEntity(entity); }
    catch (error) {
      if (!isConflict(error)) throw error;
      const saved = await optionalRow(table, eventId, rowKey);
      if (!saved || Object.entries(entity).some(([key, value]) => saved[key] !== value)) {
        throw new ApiError(503, 'INVALID_PRIVATE_FRAGMENT');
      }
    }
  }
  return canonical(pointer);
}

/** Legacy inline JSON and versioned fragments share the same logical row's content property. */
export async function privateContent(table: TableClient, eventId: string, target: string, content: unknown): Promise<string> {
  const parsed = decode(content, (value): value is Record<string, unknown> => isRecord(value));
  if (!Object.hasOwn(parsed, 'privateValue')) {
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > maximumPrivateValueBytes) throw new ApiError(503, 'INVALID_PRIVATE_VALUE');
    return content;
  }
  if (!isPointer(parsed) || parsed.target !== target
    || parsed.version !== hash(canonical({ eventId, target, owner: parsed.owner, sha256: parsed.sha256 }))) {
    throw new ApiError(503, 'INVALID_PRIVATE_VALUE');
  }
  const buffers: Buffer[] = [];
  for (let index = 0; index < parsed.parts; index++) {
    const key = fragmentKey(parsed.version, index);
    const row = await optionalRow(table, eventId, key);
    if (!row || row.partitionKey !== eventId || row.rowKey !== key
      || row.kind !== 'private-fragment' || row.target !== target || row.version !== parsed.version || row.index !== index
      || ('kind' in parsed.owner
        ? !sameScoreActor(decode(row.ownerActor, isScoreActor), parsed.owner)
        : row.ownerTenantId !== parsed.owner.tenantId || row.ownerObjectId !== parsed.owner.objectId)
      || typeof row.content !== 'string' || row.content.length > 4 * Math.ceil(fragmentBytes / 3) || row.sha256 !== hash(row.content)) {
      throw new ApiError(503, 'INVALID_PRIVATE_FRAGMENT');
    }
    const buffer = Buffer.from(row.content, 'base64');
    if (buffer.toString('base64') !== row.content || buffer.length !== Math.min(fragmentBytes, parsed.bytes - index * fragmentBytes)) {
      throw new ApiError(503, 'INVALID_PRIVATE_FRAGMENT');
    }
    buffers.push(buffer);
  }
  const value = Buffer.concat(buffers);
  if (value.length !== parsed.bytes || hash(value) !== parsed.sha256) throw new ApiError(503, 'INVALID_PRIVATE_VALUE');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(value); }
  catch { throw new ApiError(503, 'INVALID_PRIVATE_VALUE'); }
}
