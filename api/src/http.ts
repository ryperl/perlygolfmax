import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { isRecord } from '../../src/contracts/events.js';
import { ApiError } from './errors.js';

export function response(status: number, jsonBody: unknown): HttpResponseInit {
  return { status, jsonBody, headers: {
    'Cache-Control': 'no-store', 'Content-Type': 'application/json',
    ...(status === 429 ? { 'Retry-After': '60' } : {}),
    ...(status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}),
  } };
}

export async function readJson(request: HttpRequest, maximum = 4096): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new ApiError(413, 'REQUEST_TOO_LARGE');
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError(415, 'JSON_REQUIRED');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'INVALID_JSON');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array)) throw new ApiError(400, 'INVALID_JSON');
      bytes += value.byteLength;
      if (bytes > maximum) {
        await reader.cancel();
        throw new ApiError(413, 'REQUEST_TOO_LARGE');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const result: unknown = JSON.parse(text);
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'INVALID_JSON');
  } finally { reader.releaseLock(); }
}

export function readCursor(request: HttpRequest): string | undefined {
  const cursor = request.query.get('cursor') ?? undefined;
  if (cursor === undefined) return undefined;
  if (!cursor || cursor.length > 2048 || !/^[A-Za-z0-9+/_=-]+$/.test(cursor)) throw new ApiError(400, 'INVALID_PAGE_CURSOR');
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    if (!isRecord(decoded) || typeof decoded.nextPartitionKey !== 'string'
      || decoded.nextPartitionKey.length > 1024
      || (decoded.nextRowKey !== undefined && (typeof decoded.nextRowKey !== 'string' || decoded.nextRowKey.length > 1024))) {
      throw new Error('Invalid cursor');
    }
  } catch { throw new ApiError(400, 'INVALID_PAGE_CURSOR'); }
  return cursor;
}
