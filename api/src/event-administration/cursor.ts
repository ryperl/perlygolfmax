import { isRecord } from '../../../src/contracts/events.js';
import { ApiError } from '../errors.js';

export function encodeAdministrationCursor(source: string, token: string | undefined): string | undefined {
  return token ? Buffer.from(JSON.stringify({ source, token })).toString('base64url') : undefined;
}

export function decodeAdministrationCursor(source: string, cursor?: string): string | undefined {
  if (cursor === undefined) return undefined;
  try {
    if (!cursor || cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('Invalid cursor');
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!isRecord(value) || Object.keys(value).some((key) => key !== 'source' && key !== 'token')
      || value.source !== source || typeof value.token !== 'string' || value.token.length > 2048) throw new Error('Invalid cursor');
    const token: unknown = JSON.parse(Buffer.from(value.token, 'base64').toString('utf8'));
    if (!isRecord(token) || typeof token.nextPartitionKey !== 'string' || token.nextPartitionKey.length > 1024
      || token.nextRowKey !== undefined && (typeof token.nextRowKey !== 'string' || token.nextRowKey.length > 1024)) throw new Error('Invalid cursor');
    return value.token;
  } catch { throw new ApiError(400, 'INVALID_PAGE_CURSOR'); }
}
