import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import { creator, event, member } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { ApiError } from '../errors.js';
import { createAdmissionHandler } from './handlers.js';
import { admissionFixture } from './test-support.js';
import type { AdmissionAction } from './handlers.js';

function fixture() {
  const f = admissionFixture();
  const api = { verify: vi.fn().mockResolvedValue(creator), store: f.store, limiter: { check: vi.fn().mockResolvedValue(undefined) } };
  const context = new InvocationContext({ invocationId: 'fictional-admission-test', logHandler: () => undefined });
  function request(action: AdmissionAction, body?: unknown, headers: Readonly<Record<string, string>> = {}) {
    return new HttpRequest({
      url: `https://fictional.example.test/api/events/${event.id}/admissions/${action}${action === 'status' ? `?inviteId=${f.inviteId}` : ''}`,
      method: action === 'list' || action === 'status' ? 'GET' : 'POST',
      params: { id: event.id },
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': identifier(400), 'If-Match': f.etag(), ...headers },
      ...(body === undefined ? {} : { body: { string: JSON.stringify(body) } }),
    });
  }
  const invoke = (action: AdmissionAction, body?: unknown, headers?: Readonly<Record<string, string>>) =>
    createAdmissionHandler(() => api, action)(request(action, body, headers), context);
  return { ...f, api, request, context, invoke };
}

describe('admission HTTP boundary', () => {
  it('executes invite, explicit caller-bound pending claim, friendly-code approval and revocation without secret projections', async () => {
    const f = fixture();
    expect((await f.invoke('invite', { inviteId: f.inviteId, playerId: f.playerId, tokenHash: f.tokenHash })).status).toBe(200);
    f.api.verify.mockResolvedValue(member);
    const claimed = await f.invoke('claim', { inviteId: f.inviteId, token: f.token }, { 'Idempotency-Key': identifier(401) });
    expect(claimed).toMatchObject({ status: 200, jsonBody: { state: 'pending' } });
    expect((await f.invoke('list')).status).toBe(404);
    expect((await f.invoke('status')).status).toBe(200);
    f.api.verify.mockResolvedValue(creator);
    const pending = f.row(`admission:${f.inviteId}`);
    const approved = await f.invoke('approve', { inviteId: f.inviteId, revision: pending.revision, verificationCode: pending.verificationCode },
      { 'Idempotency-Key': identifier(402) });
    expect(approved).toMatchObject({ status: 200, jsonBody: { state: 'approved' } });
    expect(JSON.stringify((await f.invoke('list')).jsonBody)).not.toContain(member.objectId);
    expect(JSON.stringify((await f.invoke('list')).jsonBody)).not.toContain(f.tokenHash);
    expect((await f.invoke('revoke', { inviteId: f.inviteId, revision: identifier(402) }, { 'Idempotency-Key': identifier(403) })).status).toBe(200);
    expect(f.api.limiter.check).toHaveBeenCalledWith(member, 'events-manage');
  });

  it.each(['objectId', 'tenantId', 'email', 'role', 'claimObjectId'])('rejects %s identity overrides rather than guessing or autolinking', async (key) => {
    const f = fixture();
    const result = await f.invoke('invite', { inviteId: f.inviteId, playerId: f.playerId, tokenHash: f.tokenHash, [key]: member.objectId });
    expect(result.status).toBe(400);
    expect(f.submit).not.toHaveBeenCalled();
    await f.invite();
    f.api.verify.mockResolvedValue(member);
    expect((await f.invoke('claim', { inviteId: f.inviteId, token: f.token, [key]: creator.objectId })).status).toBe(400);
  });

  it('requires verified JWT identity, exact requests and event preconditions before touching storage', async () => {
    const f = fixture();
    const body = { inviteId: f.inviteId, playerId: f.playerId, tokenHash: f.tokenHash };
    expect((await f.invoke('invite', body, { 'If-Match': '*' })).status).toBe(400);
    expect((await f.invoke('invite', body, { 'Idempotency-Key': '../invalid' })).status).toBe(400);
    expect((await f.invoke('invite', body, { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await f.invoke('invite', { ...body, excess: 'x'.repeat(5000) })).status).toBe(413);
    f.api.verify.mockRejectedValue(new ApiError(401, 'INVALID_ACCESS_TOKEN'));
    expect((await f.invoke('invite', body)).status).toBe(401);
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('never accepts a token from query parameters or logs raw request/error secrets', async () => {
    const f = fixture();
    await f.invite();
    f.api.verify.mockResolvedValue(member);
    const queryOnly = new HttpRequest({ url: `${f.request('claim').url}?token=${f.token}&inviteId=${f.inviteId}`,
      params: { id: event.id }, method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': identifier(401) }, body: { string: '{}' } });
    expect((await createAdmissionHandler(() => f.api, 'claim')(queryOnly, f.context)).status).toBe(400);
    const log = vi.spyOn(f.context, 'error');
    f.api.verify.mockRejectedValue(new Error(`Fictional secret ${f.token}`));
    const result = await f.invoke('claim', { inviteId: f.inviteId, token: f.token });
    expect(result).toMatchObject({ status: 503, jsonBody: { code: 'SERVICE_UNAVAILABLE' }, headers: { 'Cache-Control': 'no-store' } });
    expect(JSON.stringify(log.mock.calls)).not.toContain(f.token);
    expect(JSON.stringify(result)).not.toContain(f.token);
  });

  it('fails closed on quota/configuration errors and uses only existing GET/POST methods', async () => {
    const f = fixture();
    f.api.limiter.check.mockRejectedValueOnce(new ApiError(429, 'REQUEST_LIMIT_EXCEEDED'));
    expect(await f.invoke('list')).toMatchObject({ status: 429, headers: { 'Retry-After': '60' } });
    expect((await createAdmissionHandler(() => { throw new Error('Fictional missing settings'); }, 'list')(f.request('list'), f.context)).status).toBe(503);
    expect((await createAdmissionHandler(() => f.api, 'invite')(new HttpRequest({
      url: f.request('invite').url, method: 'PUT', params: { id: event.id },
    }), f.context)).status).toBe(405);
  });
});
