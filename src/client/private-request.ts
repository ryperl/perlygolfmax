import { EventChangedError, SessionExpiredError } from './events';

interface Write {
  readonly method: 'POST' | 'PUT' | 'PATCH';
  readonly body: unknown;
  readonly etag?: string;
  readonly requestId?: string;
}

export function createPrivateRequest(apiUrl: string, getToken: () => Promise<string>, send: typeof fetch) {
  return async (path: string, signal: AbortSignal, write?: Write): Promise<unknown> => {
    signal.throwIfAborted();
    const body = write ? JSON.stringify(write.body) : undefined;
    if (body !== undefined && new TextEncoder().encode(body).byteLength > 4096) {
      throw new Error('Request exceeds the 4096-byte UTF-8 service limit. Nothing was sent or confirmed saved.');
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
        ...(write?.requestId ? { 'Idempotency-Key': write.requestId } : {}),
      },
    });
    signal.throwIfAborted();
    if (response.status === 401) throw new SessionExpiredError('Your session expired. Sign in again.');
    if (response.status === 409) throw new EventChangedError('This data changed. Refresh before approving and retrying. Your draft was preserved.');
    if (!response.ok) throw new Error(response.status === 403
      ? 'You do not have permission for this operation. Nothing was confirmed saved.'
      : response.status === 429 ? 'Too many requests. Wait before retrying. Nothing was confirmed saved.'
        : `Service request failed (${String(response.status)}). Nothing was confirmed saved.`);
    const value: unknown = await response.json();
    signal.throwIfAborted();
    return value;
  };
}
