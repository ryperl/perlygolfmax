import { EventChangedError, SessionExpiredError } from './events';
import { isRecord } from '../contracts/events';
import {
  isPrivateReadPart, maximumPrivateWriteBytes, privateWritePartBytes,
} from '../contracts/private-values';
import type { PrivateUpload } from '../contracts/private-values';

export class PrivateRequestError extends Error {
  readonly retryAfterSeconds: number | undefined;

  constructor(readonly status: number, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'PrivateRequestError';
    this.retryAfterSeconds = retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
      ? Math.min(3600, Math.ceil(retryAfterSeconds)) : status === 429 ? 60 : undefined;
  }
}

function retryAfterSeconds(header: string | null): number | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Math.min(3600, Number(value));
  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/i.test(value)) return undefined;
  const instant = Date.parse(value);
  if (!Number.isFinite(instant) || new Date(instant).toUTCString().toLowerCase() !== value.toLowerCase()) return undefined;
  return Math.max(0, Math.ceil((instant - Date.now()) / 1000));
}

interface Write {
  readonly method: 'POST' | 'PUT' | 'PATCH';
  readonly body: unknown;
  readonly etag?: string;
  readonly requestId?: string;
  readonly createOnly?: boolean;
}

export function createPrivateRequest(apiUrl: string, getToken: () => Promise<string>, send: typeof fetch, maximumBytes = 4096,
  authorization: 'Bearer' | 'Tester' = 'Bearer') {
  return async (path: string, signal: AbortSignal, write?: Write): Promise<unknown> => {
    signal.throwIfAborted();
    const body = write ? JSON.stringify(write.body) : undefined;
    if (body !== undefined && new TextEncoder().encode(body).byteLength > maximumBytes) {
      throw new Error(`Request exceeds the ${String(maximumBytes)}-byte UTF-8 service limit. Nothing was sent or confirmed saved.`);
    }

    const token = await getToken();
    signal.throwIfAborted();
    const response = await send(`${apiUrl}/${path}`, {
      signal, cache: 'no-store', credentials: 'omit',
      ...(write ? { method: write.method } : {}),
      ...(body !== undefined ? { body } : {}),
      headers: {
        Authorization: `${authorization} ${token}`,
        ...(write ? { 'Content-Type': 'application/json' } : {}),
        ...(write?.etag ? { 'If-Match': write.etag } : {}),
        ...(write?.createOnly ? { 'If-None-Match': '*' } : {}),
        ...(write?.requestId ? { 'Idempotency-Key': write.requestId } : {}),
      },
    });
    signal.throwIfAborted();
    if (authorization === 'Tester' && [401, 403, 404].includes(response.status)) {
      throw new SessionExpiredError('This tester link is unavailable, expired or revoked. Ask the organizer for a new link.');
    }
    if (response.status === 401) throw new SessionExpiredError('Your session expired. Sign in again.');
    if (response.status === 409) throw new EventChangedError('This data changed. Refresh before approving and retrying. Your draft was preserved.');
    if (!response.ok) throw new PrivateRequestError(response.status, response.status === 403
      ? 'You do not have permission for this operation. Nothing was confirmed saved.'
      : response.status === 429 ? 'Too many requests. Wait before retrying. Nothing was confirmed saved.'
        : `Service request failed (${String(response.status)}). Nothing was confirmed saved.`, retryAfterSeconds(response.headers.get('Retry-After')));
    const value: unknown = await response.json();
    signal.throwIfAborted();
    return value;
  };
}

type PrivateRequest = ReturnType<typeof createPrivateRequest>;

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function waitForQuota(seconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, Math.max(1, seconds) * 1000);
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function transferRequest(request: PrivateRequest, path: string, signal: AbortSignal, write?: Write): Promise<unknown> {
  for (;;) {
    signal.throwIfAborted();
    try { return await request(path, signal, write); }
    catch (error) {
      if (!(error instanceof PrivateRequestError) || error.status !== 429) throw error;
      await waitForQuota(error.retryAfterSeconds ?? 60, signal);
    }
  }
}

/** Reassembles digest-bound pages before exposing a complete typed response to a consumer. */
export async function readPrivateValue(request: PrivateRequest, path: string, signal: AbortSignal): Promise<unknown> {
  const initial = await request(path, signal);
  if (!isRecord(initial) || !Object.hasOwn(initial, 'privateRead')) return initial;
  if (!isPrivateReadPart(initial) || initial.privateRead.index !== 0) throw new Error('Invalid private response page. Nothing was loaded.');
  const first = initial.privateRead;
  const content = [first.content];
  for (let index = 1; index < first.parts; index++) {
    const page = await transferRequest(request, `${path}${path.includes('?') ? '&' : '?'}privatePart=${String(index)}&privateHash=${first.sha256}`, signal);
    if (!isPrivateReadPart(page) || page.privateRead.index !== index || page.privateRead.sha256 !== first.sha256
      || page.privateRead.parts !== first.parts || page.privateRead.bytes !== first.bytes) throw new Error('Invalid private response page. Nothing was loaded.');
    content.push(page.privateRead.content);
  }
  const text = content.join('');
  const bytes = new TextEncoder().encode(text);
  if (bytes.length !== first.bytes || await sha256(bytes) !== first.sha256) throw new Error('Incomplete private response. Nothing was loaded.');
  const value: unknown = JSON.parse(text);
  signal.throwIfAborted();
  return value;
}

/** Ordinary writes stay small; larger setup/game JSON uses bounded, owner-bound immutable parts. */
export async function writePrivateValue(request: PrivateRequest, path: string, signal: AbortSignal, write: Write, ordinaryBytes: number): Promise<unknown> {
  const bytes = new TextEncoder().encode(JSON.stringify(write.body));
  if (bytes.length <= ordinaryBytes) return request(path, signal, write);
  if (bytes.length > maximumPrivateWriteBytes) throw new Error('Private write exceeds the service byte budget. Nothing was sent or confirmed saved.');
  const contentHash = await sha256(bytes);
  const operationHash = await sha256(new TextEncoder().encode(JSON.stringify({ path, etag: write.etag ?? null, contentHash })));
  const operationId = `${operationHash.slice(0, 8)}-${operationHash.slice(8, 12)}-4${operationHash.slice(13, 16)}-8${operationHash.slice(17, 20)}-${operationHash.slice(20, 32)}`;
  const upload: PrivateUpload = {
    id: write.requestId ?? operationId, bytes: bytes.length, parts: Math.ceil(bytes.length / privateWritePartBytes), sha256: contentHash,
  };
  for (let index = 0; index < upload.parts; index++) {
    const part = bytes.subarray(index * privateWritePartBytes, (index + 1) * privateWritePartBytes);
    const content = btoa(Array.from(part, (byte) => String.fromCharCode(byte)).join(''));
    const acknowledgement = await transferRequest(request, path, signal, { ...write, body: { privateUpload: { ...upload, index, content } } });
    if (!isRecord(acknowledgement) || !isRecord(acknowledgement.privateStaged)
      || acknowledgement.privateStaged.id !== upload.id || acknowledgement.privateStaged.index !== index) {
      throw new Error('Invalid upload acknowledgement. Nothing was confirmed saved.');
    }
  }
  return transferRequest(request, path, signal, { ...write, body: { privateCommit: upload } });
}
