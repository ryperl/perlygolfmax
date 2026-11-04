import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import { creator, event, member } from '../../test/fixtures.js';
import { ApiError } from '../errors.js';
import { createHandler } from './handlers.js';

function fixture(allowed = true) {
  const api = {
    verify: vi.fn().mockResolvedValue(allowed ? creator : member),
    canCreate: vi.fn().mockReturnValue(allowed),
    store: { list: vi.fn().mockResolvedValue({ events: [] }), create: vi.fn().mockResolvedValue({ ...event, role: 'owner', status: 'active', etag: 'fictional-v1' }), setStatus: vi.fn().mockResolvedValue({ ...event, role: 'owner', status: 'archived', etag: 'fictional-v2' }) },
    limiter: { check: vi.fn().mockResolvedValue(undefined) },
  };
  const request = (body = JSON.stringify({ name: event.name }), headers: Record<string, string> = {}) => new HttpRequest({
    url: 'https://fictional.example.test/api/events', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': event.id, ...headers }, body: { string: body },
  });
  return { api, request, context: new InvocationContext({ invocationId: 'fictional-test', logHandler: () => undefined }) };
}

describe('event API handlers', () => {
  it('uses only verified server identity, never client-supplied owner or principal headers', async () => {
    const { api, request, context } = fixture();
    const result = await createHandler(() => api, 'events')(request(JSON.stringify({ name: event.name, owner: member.objectId }), { 'x-ms-client-principal': 'forged' }), context);
    expect(result.status).toBe(200);
    expect(api.verify).toHaveBeenCalledWith(null);
    expect(api.store.create).toHaveBeenCalledWith(creator, expect.objectContaining({ name: event.name, id: event.id }));
    api.verify.mockRejectedValue(new ApiError(401, 'INVALID_ACCESS_TOKEN'));
    expect((await createHandler(() => api, 'events')(request(), context)).status).toBe(401);
  });

  it('rejects event creation by an ordinary member/appointed owner without a global creator grant', async () => {
    const { api, request, context } = fixture(false);
    expect((await createHandler(() => api, 'events')(request(), context)).status).toBe(403);
    expect(api.store.create).not.toHaveBeenCalled();
  });

  it.each([
    ['{', {}, 400],
    [JSON.stringify({ name: '' }), {}, 400],
    [JSON.stringify({ name: 'x'.repeat(5000) }), {}, 413],
    [JSON.stringify({ name: 'x'.repeat(5000) }), { 'Content-Length': '1' }, 413],
    [JSON.stringify({ name: event.name }), { 'Idempotency-Key': '../bad' }, 400],
    [JSON.stringify({ name: event.name }), { 'Content-Type': 'text/plain' }, 415],
  ] as const)('rejects invalid/unbounded payloads', async (body, headers, status) => {
    const { api, request, context } = fixture();
    expect((await createHandler(() => api, 'events')(request(body, headers), context)).status).toBe(status);
    expect(api.store.create).not.toHaveBeenCalled();
  });

  it('rejects invalid page cursors before storage discovery', async () => {
    const { api, context } = fixture();
    const request = new HttpRequest({ url: 'https://fictional.example.test/api/events?cursor=notjson', method: 'GET' });
    expect((await createHandler(() => api, 'events')(request, context)).status).toBe(400);
    expect(api.store.list).not.toHaveBeenCalled();
  });

  it('returns explicit unconfigured/storage/quota failures without echoing private exception details', async () => {
    const { api, request, context } = fixture();
    const handler = createHandler(() => { throw new ApiError(503, 'SERVICE_NOT_CONFIGURED'); }, 'events');
    expect(await handler(request(), context)).toMatchObject({ status: 503, jsonBody: { code: 'SERVICE_NOT_CONFIGURED' } });
    api.store.create.mockRejectedValue(new Error('private database details'));
    expect(await createHandler(() => api, 'events')(request(), context)).toMatchObject({ status: 503, jsonBody: { code: 'SERVICE_UNAVAILABLE' } });
    api.limiter.check.mockRejectedValue(new ApiError(429, 'REQUEST_LIMIT_EXCEEDED'));
    expect(await createHandler(() => api, 'events')(request(), context)).toMatchObject({ status: 429, headers: { 'Retry-After': '60' } });
  });

  it('logs safe SDK classifications without exposing private exception messages', async () => {
    const { api, request, context } = fixture();
    const log = vi.spyOn(context, 'error').mockImplementation(() => undefined);
    api.store.create.mockRejectedValue(Object.assign(new Error('fixture-private-details'), {
      name: 'RestError', code: 'AuthorizationPermissionMismatch', statusCode: 403,
    }));
    expect(await createHandler(() => api, 'events')(request(), context)).toMatchObject({
      status: 503, jsonBody: { code: 'SERVICE_UNAVAILABLE' },
    });
    expect(JSON.stringify(log.mock.calls)).toContain('AuthorizationPermissionMismatch');
    expect(JSON.stringify(log.mock.calls)).not.toContain('fixture-private-details');
  });

  it('passes archive/restore only to authoritative owner storage, not the global creator grant', async () => {
    const { api, context } = fixture(false);
    const request = new HttpRequest({
      url: `https://fictional.example.test/api/events/${event.id}/status`, method: 'PATCH',
      params: { id: event.id }, headers: { 'Content-Type': 'application/json', 'If-Match': 'event-v1' },
      body: { string: JSON.stringify({ status: 'archived', owner: creator.objectId }) },
    });
    expect((await createHandler(() => api, 'event-status')(request, context)).status).toBe(200);
    expect(api.canCreate).not.toHaveBeenCalled();
    expect(api.store.setStatus).toHaveBeenCalledWith(member, event.id, 'archived', 'event-v1');
    expect(api.limiter.check).toHaveBeenCalledWith(member, 'events-manage');
    api.store.setStatus.mockRejectedValue(new ApiError(403, 'EVENT_MANAGEMENT_FORBIDDEN'));
    const retry = new HttpRequest({
      url: request.url, method: 'PATCH', params: { id: event.id },
      headers: { 'Content-Type': 'application/json', 'If-Match': 'event-v1' },
      body: { string: '{"status":"active"}' },
    });
    expect((await createHandler(() => api, 'event-status')(retry, context)).status).toBe(403);
  });

  it.each([
    [event.id, '*', '{"status":"archived"}', 400],
    [event.id, 'event-v1', '{"status":"deleted"}', 400],
    ['bad-id', 'event-v1', '{"status":"archived"}', 400],
    [event.id, 'event-v1', 'x'.repeat(4097), 413],
  ])('rejects invalid archive payloads before storage', async (id, etag, body, status) => {
    const { api, context } = fixture();
    const request = new HttpRequest({
      url: 'https://fictional.example.test/api/events/status', method: 'PATCH', params: { id },
      headers: { 'Content-Type': 'application/json', 'If-Match': etag }, body: { string: body },
    });
    expect((await createHandler(() => api, 'event-status')(request, context)).status).toBe(status);
    expect(api.store.setStatus).not.toHaveBeenCalled();
  });

  it('binds discovery to a validated lifecycle mode', async () => {
    const { api, context } = fixture();
    await createHandler(() => api, 'events')(new HttpRequest({
      url: 'https://fictional.example.test/api/events?status=archived', method: 'GET',
    }), context);
    expect(api.store.list).toHaveBeenCalledWith(creator, undefined, 'archived');
    api.store.list.mockClear();
    expect((await createHandler(() => api, 'events')(new HttpRequest({
      url: 'https://fictional.example.test/api/events?status=all', method: 'GET',
    }), context)).status).toBe(400);
    expect(api.store.list).not.toHaveBeenCalled();
  });
});
