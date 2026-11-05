import { EventChangedError, SessionExpiredError } from './events';

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

export function createPrivateRequest(apiUrl: string, getToken: () => Promise<string>, send: typeof fetch, maximumBytes = 4096) {
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
        Authorization: `Bearer ${token}`,
        ...(write ? { 'Content-Type': 'application/json' } : {}),
        ...(write?.etag ? { 'If-Match': write.etag } : {}),
        ...(write?.createOnly ? { 'If-None-Match': '*' } : {}),
        ...(write?.requestId ? { 'Idempotency-Key': write.requestId } : {}),
      },
    });
    signal.throwIfAborted();
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
