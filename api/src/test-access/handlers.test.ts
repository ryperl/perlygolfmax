import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { ApiError } from '../errors.js';
import { createScoringHandler } from '../scoring/handlers.js';
import { isEventWorkspace } from '../../../src/contracts/setup.js';
import { isRoundScores, isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { isTesterAccessManagement } from '../../../src/contracts/test-access.js';
import { createTesterHandler } from './handlers.js';
import type { TesterAction } from './handlers.js';
import { testerFixture } from './test-support.js';

async function fixture() {
  const f = await testerFixture();
  const verify = vi.fn((header: string | null) => {
    if (header !== 'Bearer fictional-owner-jwt') return Promise.reject(new ApiError(401, 'INVALID_ACCESS_TOKEN'));
    return Promise.resolve(creator);
  });
  const api = { verify, testers: f.testers, workspace: f.workspace, scores: f.scores,
    limiter: { check: vi.fn().mockResolvedValue(undefined) } };
  const context = new InvocationContext({ invocationId: 'fictional-tester-test', logHandler: () => undefined });
  function request(action: TesterAction, body?: unknown, headers: Readonly<Record<string, string>> = {},
    params: Readonly<Record<string, string>> = {}, query = '') {
    const guest = ['workspace', 'scores', 'score-hole'].includes(action);
    return new HttpRequest({
      url: `https://fictional.example.test/api/${guest ? 'tester/' : ''}events/${event.id}/${action}${query}`,
      method: action === 'score-hole' ? 'PUT' : ['create', 'revoke', 'renew'].includes(action) ? 'POST' : 'GET',
      params: { id: event.id, roundId: f.roundId, playerId: f.peerId, holeNumber: '1', ...params },
      headers: { authorization: guest ? f.header : 'Bearer fictional-owner-jwt',
        'Content-Type': 'application/json', 'If-Match': f.row('event').etag, 'Idempotency-Key': identifier(3200), ...headers },
      ...(body === undefined ? {} : { body: { string: JSON.stringify(body) } }),
    });
  }
  const invoke = (action: TesterAction, body?: unknown, headers?: Readonly<Record<string, string>>, params?: Readonly<Record<string, string>>) =>
    createTesterHandler(() => api, action)(request(action, body, headers, params), context);
  return { ...f, api, context, request, invoke };
}

describe('separate tester HTTP credential boundary', () => {
  it('renews only through the owner POST with exact revisions and no caller-chosen expiry', async () => {
    const f = await fixture();
    const current = await f.testers.list(creator, event.id);
    const link = current.links[0];
    if (!link) throw new Error('Missing fictional tester link.');
    const body = { linkId: f.linkId, revision: link.revision };
    expect((await f.invoke('renew', body, { authorization: f.header })).status).toBe(401);
    expect((await f.invoke('renew', { ...body, expiresAt: '2099-01-01T00:00:00Z' })).status).toBe(400);
    expect((await f.invoke('renew', body, { 'If-Match': '*' })).status).toBe(400);
    expect((await f.invoke('renew', body, { 'Idempotency-Key': 'invalid' })).status).toBe(400);
    expect(await f.invoke('renew', body)).toMatchObject({ status: 200, jsonBody: {
      state: 'active', linkId: f.linkId, operationId: identifier(3200),
    } });
    expect(await f.testers.verify(event.id, f.header)).toEqual(f.actor);
  });
  it('executes owner create and guest workspace/read/all-group scoring without JWT, claim or approval', async () => {
    const f = await fixture();
    const created = await f.invoke('create', { linkId: identifier(3210), tokenHash: f.tokenHash });
    expect(created).toMatchObject({ status: 200, jsonBody: { state: 'active' } });
    expect(await f.testers.verify(event.id, `Tester ${identifier(3210)}.${f.token}`))
      .toEqual({ kind: 'tester-link', eventId: event.id, linkId: identifier(3210) });
    expect(isTesterAccessManagement((await f.invoke('list')).jsonBody)).toBe(true);
    f.api.verify.mockClear();
    const workspace = await f.invoke('workspace');
    expect(isEventWorkspace(workspace.jsonBody)).toBe(true);
    expect(workspace).toMatchObject({ status: 200, jsonBody: { testerAccess: true } });
    const scores = await f.invoke('scores');
    expect(isRoundScores(scores.jsonBody)).toBe(true);
    for (const [index, playerId] of [f.peerId, f.foreignId].entries()) {
      const request = f.request('score-hole', { score: { kind: 'strokes', strokes: 4 } }, { 'Idempotency-Key': identifier(3220 + index) },
        { playerId });
      request.headers.delete('If-Match');
      request.headers.set('If-None-Match', '*');
      const result = await createTesterHandler(() => f.api, 'score-hole')(request, f.context);
      expect(result.status).toBe(200);
      expect(isScoreWriteResult(result.jsonBody)).toBe(true);
    }
    expect(f.api.verify).not.toHaveBeenCalled();
    expect(f.api.limiter.check).toHaveBeenCalledWith(f.actor, 'scores-write');
    expect(JSON.stringify(workspace.jsonBody)).not.toContain('handicapIndex');
  });

  it.each([
    '', 'Bearer fictional-owner-jwt', 'tester wrong', 'Tester ../invalid.secret', 'Tester link.token',
  ])('returns no-store 403 for invalid guest authorization %j, never sign-in', async (authorization) => {
    const f = await fixture();
    const result = await f.invoke('workspace', undefined, { authorization });
    expect(result).toMatchObject({ status: 403, headers: { 'Cache-Control': 'no-store' }, jsonBody: { code: 'TESTER_ACCESS_ENDED' } });
    expect(f.api.verify).not.toHaveBeenCalled();
    expect(f.api.limiter.check).not.toHaveBeenCalled();
  });

  it('accepts only the exact header scheme, never query secrets or forged event scope', async () => {
    const f = await fixture();
    for (const authorization of [`tester ${f.linkId}.${f.token}`, `Tester ${f.linkId}.${f.token} extra`, `Tester ${f.linkId}.${'B'.repeat(43)}`]) {
      expect((await f.invoke('workspace', undefined, { authorization })).status).toBe(403);
    }
    const queryOnly = f.request('workspace', undefined, { authorization: '' }, {}, `?token=${f.token}&linkId=${f.linkId}`);
    expect((await createTesterHandler(() => f.api, 'workspace')(queryOnly, f.context)).status).toBe(403);
    expect((await f.invoke('workspace', undefined, {}, { id: identifier(9999) })).status).toBe(403);
    await f.revoke();
    expect((await f.invoke('scores')).status).toBe(403);
  });

  it('keeps owner and regular score routes JWT-only even with a valid tester header', async () => {
    const f = await fixture();
    expect((await f.invoke('list', undefined, { authorization: f.header })).status).toBe(401);
    expect((await f.invoke('create', { linkId: identifier(3210), tokenHash: f.tokenHash }, { authorization: f.header })).status).toBe(401);
    const result = await createScoringHandler(() => f.api, 'scores')(f.request('scores'), f.context);
    expect(result.status).toBe(401);
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('requires exact owner/score preconditions, UUID operations and score-only request bodies', async () => {
    const f = await fixture();
    const create = { linkId: identifier(3210), tokenHash: f.tokenHash };
    for (const headers of [{ 'If-Match': '*' }, { 'If-Match': 'one,two' }, { 'If-None-Match': '*' }, { 'Idempotency-Key': 'invalid' }]) {
      expect((await f.invoke('create', create, headers)).status).toBe(400);
    }
    for (const body of [{ ...create, token: f.token }, { ...create, objectId: creator.objectId }]) {
      expect((await f.invoke('create', body)).status).toBe(400);
    }
    expect((await f.invoke('score-hole', { score: { kind: 'strokes', strokes: 4 }, role: 'owner' })).status).toBe(400);
    expect((await f.invoke('score-hole', { score: { kind: 'strokes', strokes: 4 } }, { 'If-Match': '*' })).status).toBe(400);
    expect((await f.invoke('score-hole', { score: { kind: 'strokes', strokes: 4 } }, {}, { holeNumber: '19' })).status).toBe(400);
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('fails closed on quota/configuration errors without exposing raw errors, credentials or identity', async () => {
    const f = await fixture();
    f.api.limiter.check.mockRejectedValueOnce(new ApiError(429, 'REQUEST_LIMIT_EXCEEDED'));
    expect(await f.invoke('scores')).toMatchObject({ status: 429, headers: { 'Retry-After': '60' } });
    const log = vi.spyOn(f.context, 'error');
    f.api.limiter.check.mockRejectedValueOnce(new Error(`Fictional provider ${f.header}`));
    const result = await f.invoke('workspace');
    expect(result).toMatchObject({ status: 503, headers: { 'Cache-Control': 'no-store' } });
    expect(JSON.stringify(log.mock.calls)).not.toContain(f.token);
    expect(JSON.stringify(result)).not.toContain(f.token);
    expect((await createTesterHandler(() => { throw new Error('Fictional missing settings'); }, 'workspace')(f.request('workspace'), f.context)).status).toBe(503);
  });
});
