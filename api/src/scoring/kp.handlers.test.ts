import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import { kpStoreFixture } from '../../test/kp-fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import { createScoringHandler } from './handlers.js';
import { createHash } from 'node:crypto';
import { decodeRoundScores } from '../../../src/contracts/scoring.js';
import { isRecord } from '../../../src/contracts/events.js';

describe('KP bounded owner HTTP lifecycle', () => {
  it.each(['', '?format=lean'])('stages owner-bound digest content without changing active KP until conditional publication %s', async (format) => {
    const f = await kpStoreFixture();
    const api = { verify: vi.fn().mockResolvedValue(creator), limiter: { check: vi.fn().mockResolvedValue(undefined) }, scores: f.scores };
    const handler = createScoringHandler(() => api, 'round-kp');
    const context = new InvocationContext({ invocationId: 'fictional-kp-staged', logHandler: () => undefined });
    const selection = { ...f.selection, status: 'closed' };
    const bytes = Buffer.from(JSON.stringify(selection));
    const upload = { id: identifier(992), bytes: bytes.length, parts: 1, sha256: createHash('sha256').update(bytes).digest('hex') };
    const call = (body: unknown) => handler(new HttpRequest({
      method: 'PUT', url: `https://fictional.example.test/api/kp${format}`, params: { id: event.id, roundId: f.roundId },
      headers: { authorization: 'Bearer fictional-token', 'Content-Type': 'application/json',
        'Idempotency-Key': identifier(993), 'If-Match': f.configured.round.kp?.etag ?? '' },
      body: { string: JSON.stringify(body) },
    }), context);
    expect(await call({ privateUpload: { ...upload, index: 0, content: bytes.toString('base64') } }))
      .toMatchObject({ status: 200, jsonBody: { privateStaged: { id: upload.id, index: 0 } } });
    expect((await f.scores.get(creator, event.id, f.roundId)).kp?.status).toBe('open');
    expect(f.submit).not.toHaveBeenCalled();
    const saved = await call({ privateCommit: upload });
    expect(saved).toMatchObject({ status: 200, jsonBody: { selection, requestId: identifier(993) } });
    if (!isRecord(saved.jsonBody)) throw new Error('Missing fictional KP receipt');
    expect(decodeRoundScores(saved.jsonBody.round)?.kp?.status).toBe('closed');
    if (format) expect(saved.jsonBody.round).toMatchObject({ kind: 'round-scores-lean' });
    expect((await f.scores.get(creator, event.id, f.roundId)).kp?.status).toBe('closed');
    expect(await call({ privateCommit: upload })).toMatchObject({ status: 200, jsonBody: { requestId: identifier(993) } });
    expect(f.submit).toHaveBeenCalledOnce();
  });
  it('requires JWT owner authority, explicit revision, exact idempotent receipt and ordinary scoring quotas', async () => {
    const f = await kpStoreFixture();
    const api = { verify: vi.fn().mockResolvedValue(creator), limiter: { check: vi.fn().mockResolvedValue(undefined) }, scores: f.scores };
    const handler = createScoringHandler(() => api, 'round-kp');
    const context = new InvocationContext({ invocationId: 'fictional-kp', logHandler: () => undefined });
    const selection = { ...f.selection, status: 'closed' };
    const call = (body: unknown = selection, headers: Record<string, string> = { 'If-Match': f.configured.round.kp?.etag ?? '' }) =>
      handler(new HttpRequest({ method: 'PUT', url: 'https://fictional.example.test/api/kp',
        params: { id: event.id, roundId: f.roundId },
        headers: { authorization: 'Bearer fictional-token', 'Content-Type': 'application/json', 'Idempotency-Key': identifier(990), ...headers },
        body: { string: typeof body === 'string' ? body : JSON.stringify(body) } }), context);
    expect(await call(selection, {})).toMatchObject({ status: 400, jsonBody: { code: 'KP_REVISION_REQUIRED' } });
    expect(await call({ ...selection, injected: true })).toMatchObject({ status: 400 });
    expect(await call('x'.repeat(12289))).toMatchObject({ status: 413 });
    const saved = await call();
    expect(saved).toMatchObject({ status: 200, jsonBody: { requestId: identifier(990), selection, round: { kp: { status: 'closed' }, setupLocked: false } } });
    expect(await call()).toEqual(saved);
    expect(api.limiter.check).toHaveBeenCalledWith(creator, 'scores-write');
    api.verify.mockResolvedValueOnce(member);
    expect(await call()).toMatchObject({ status: 404 });
    expect(f.submit).toHaveBeenCalledOnce();
  });
});
