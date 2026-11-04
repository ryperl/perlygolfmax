import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import { ApiError } from '../errors.js';
import { createScoringHandler } from './handlers.js';
import type { ScoringAction } from './handlers.js';
import { stablefordPoints } from '../../../src/domain/stableford.js';

async function fixture() {
  const f = await scoringFixture();
  const api = { verify: vi.fn().mockResolvedValue(creator), limiter: { check: vi.fn().mockResolvedValue(undefined) }, scores: f.scores };
  const context = new InvocationContext({ invocationId: 'fictional-scoring', logHandler: () => undefined });
  const call = (action: ScoringAction = 'score-hole', headers: Record<string, string> = { 'If-None-Match': '*' },
    body: unknown = { score: { kind: 'strokes', strokes: 4 } }, params: Record<string, string> = {}, method?: string, query = '') =>
    createScoringHandler(() => api, action)(new HttpRequest({
      url: `https://fictional.example.test/api/fixture${query}`, method: method ?? (action === 'score-hole' || action === 'round-games' ? 'PUT' : 'GET'),
      params: { id: event.id, roundId: f.roundId, playerId: f.playerId, holeNumber: '1', ...params },
      headers: { authorization: 'Bearer fictional-test-token', 'Content-Type': 'application/json', 'Idempotency-Key': identifier(600), ...headers },
      ...(action === 'score-hole' || action === 'round-games' ? { body: { string: typeof body === 'string' ? body : JSON.stringify(body) } } : {}),
    }), context);
  return { ...f, api, context, call };
}

describe('JWT-first owner-only bounded scoring HTTP routes', () => {
  it('saves versioned games with the existing write quota and no-store without creating stroke cards', async () => {
    const f = await fixture();
    const game = { id: identifier(700), name: 'Fictional Stableford', preset: 'standard', basis: 'gross', handicapAllowancePercent: 95, points: stablefordPoints('standard') };
    const saved = await f.call('round-games', { 'If-None-Match': '*' }, { games: [game] });
    expect(saved).toMatchObject({
      status: 200, headers: { 'Cache-Control': 'no-store' },
      jsonBody: { change: { before: [], after: [game] }, round: { setupLocked: false, games: { configuration: { games: [game] } } } },
    });
    expect(f.api.limiter.check).toHaveBeenCalledWith(creator, 'scores-write');
    expect(await f.call('round-games', { 'If-None-Match': '*' }, { games: [game] })).toEqual(saved);
    expect(f.submit).toHaveBeenCalledOnce();
    expect(await f.call('round-games', {}, { games: [game] })).toMatchObject({ status: 400, jsonBody: { code: 'GAME_REVISION_REQUIRED' } });
  });

  it('rejects invalid game definitions, extra fields, oversized bodies and wrong methods before writes', async () => {
    const f = await fixture();
    const game = { id: identifier(700), name: 'Fictional Stableford', preset: 'modified', basis: 'net', handicapAllowancePercent: 95, points: stablefordPoints('modified') };
    for (const body of [null, { games: [] }, { games: [game, game] }, { games: [{ ...game, handicapAllowancePercent: 101 }] },
      { games: [game], role: 'owner' }, { games: [{ ...game, points: { ...game.points, betterScorePoints: Infinity } }] }]) {
      expect(await f.call('round-games', { 'If-None-Match': '*' }, body)).toMatchObject({ status: 400 });
    }
    expect(await f.call('round-games', { 'If-None-Match': '*' }, 'x'.repeat(4097))).toMatchObject({ status: 413 });
    expect(await f.call('round-games', { 'If-None-Match': '*' }, { games: [game] }, {}, 'GET')).toMatchObject({ status: 405 });
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('round-trips X7 JSON exactly through reads/history/retries and audits correction to completed seven separately', async () => {
    const f = await fixture();
    const pickup = { kind: 'picked-up', reportedStrokes: 7 };
    const first = await f.call('score-hole', { 'If-None-Match': '*' }, { score: pickup });
    expect(first).toMatchObject({
      status: 200, jsonBody: {
        change: { before: { kind: 'unplayed' }, after: pickup },
        round: { cards: [{ holes: [{ number: 1, score: pickup }, ...Array.from({ length: 17 }, () => ({}))] }, {}, {}, {}] },
      },
    });
    expect(await f.call('score-hole', { 'If-None-Match': '*' }, { score: pickup })).toEqual(first);
    expect(await f.call('score-hole', { 'If-None-Match': '*' }, { score: { kind: 'picked-up', reportedStrokes: 8 } }))
      .toMatchObject({ status: 409, jsonBody: { code: 'SCORE_REQUEST_CONFLICT' } });
    const read = await f.scores.get(creator, event.id, f.roundId);
    const headers = { 'If-Match': read.cards[0]?.etag ?? 'missing', 'Idempotency-Key': identifier(601) };
    expect(await f.call('score-hole', headers, { score: { kind: 'strokes', strokes: 7 } })).toMatchObject({
      status: 200, jsonBody: { change: { before: pickup, after: { kind: 'strokes', strokes: 7 } } },
    });
    expect(await f.call('score-history')).toMatchObject({
      status: 200, jsonBody: { changes: [
        { before: { kind: 'unplayed' }, after: pickup },
        { before: pickup, after: { kind: 'strokes', strokes: 7 } },
      ] },
    });
    expect(f.submit).toHaveBeenCalledTimes(2);
  });

  it('implements round, write and history with no-store and dedicated read/write quotas', async () => {
    const f = await fixture();
    expect(await f.call('scores')).toMatchObject({ status: 200, jsonBody: { setupLocked: false, cards: [{ etag: null }, {}, {}, {}] }, headers: { 'Cache-Control': 'no-store' } });
    expect(await f.call()).toMatchObject({
      status: 200, jsonBody: { change: { recordedBy: creator, after: { kind: 'strokes', strokes: 4 } }, round: { setupLocked: true } },
      headers: { 'Cache-Control': 'no-store' },
    });
    expect(await f.call('score-history')).toMatchObject({ status: 200, jsonBody: { changes: [{ id: identifier(600) }] } });
    expect(f.api.verify).toHaveBeenCalledWith('Bearer fictional-test-token');
    expect(f.api.limiter.check).toHaveBeenNthCalledWith(1, creator, 'scores-read');
    expect(f.api.limiter.check).toHaveBeenNthCalledWith(2, creator, 'scores-write');
    expect(f.api.limiter.check).toHaveBeenNthCalledWith(3, creator, 'scores-read');
    const written = await f.scores.get(creator, event.id, f.roundId);
    expect(await f.call('score-hole', { 'If-Match': written.cards[0]?.etag ?? 'missing', 'Idempotency-Key': identifier(601) }, { score: { kind: 'picked-up' } })).toMatchObject({ status: 200 });
  });

  it.each([
    {}, { 'If-Match': '*' }, { 'If-Match': '' }, { 'If-None-Match': '"revision"' },
    { 'If-Match': 'revision', 'If-None-Match': '*' }, { 'If-Match': '"a", "b"' },
    { 'If-Match': 'x'.repeat(513) },
  ])('rejects missing/both/wildcard/multiple/bounded preconditions %j', async (headers) => {
    const f = await fixture();
    expect(await f.call('score-hole', headers)).toMatchObject({ status: 400, jsonBody: { code: 'SCORE_REVISION_REQUIRED' } });
    expect(f.submit).not.toHaveBeenCalled();
  });

  it.each([
    { score: { kind: 'strokes', strokes: 0 } }, { score: { kind: 'strokes', strokes: -1 } },
    { score: { kind: 'strokes', strokes: 1.1 } }, { score: { kind: 'strokes', strokes: Number.MAX_SAFE_INTEGER } },
    { score: { kind: 'picked-up', strokes: 0 } }, { score: { kind: 'net', strokes: 3 } },
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER, null, '7', true, {}, []].map((reportedStrokes) => ({
      score: { kind: 'picked-up', reportedStrokes },
    })),
    { score: { kind: 'unplayed' }, role: 'owner' }, { strokes: 3 }, null, 'invalid json',
  ])('rejects malformed or excess score input %j', async (body) => {
    const f = await fixture();
    expect(await f.call('score-hole', { 'If-None-Match': '*' }, body)).toMatchObject({ status: 400 });
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('enforces body cap, JSON, UUIDs, bounded cursor, method and real ordinal holes', async () => {
    const f = await fixture();
    expect(await f.call('score-hole', { 'If-None-Match': '*', 'content-length': '4097' })).toMatchObject({ status: 413 });
    expect(await f.call('score-hole', { 'If-None-Match': '*' }, 'x'.repeat(4097))).toMatchObject({ status: 413 });
    expect(await f.call('score-hole', { 'If-None-Match': '*', 'Content-Type': 'text/plain' })).toMatchObject({ status: 415 });
    expect(await f.call('score-hole', { 'If-None-Match': '*', 'Idempotency-Key': 'not-uuid' })).toMatchObject({ status: 400 });
    for (const holeNumber of ['0', '19', '201', '01', '-1', '1.0']) expect(await f.call('score-hole', { 'If-None-Match': '*' }, { score: { kind: 'unplayed' } }, { holeNumber })).toMatchObject({ status: 400 });
    expect(await f.call('scores', {}, {}, { id: 'not-uuid' })).toMatchObject({ status: 400 });
    expect(await f.call('score-history', {}, {}, {}, 'GET', '?cursor=bad')).toMatchObject({ status: 400 });
    expect(await f.call('score-history', {}, {}, {}, 'POST')).toMatchObject({ status: 405 });
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('verifies tokens before quota/storage and fails closed on identity and quota outages', async () => {
    const f = await fixture();
    f.get.mockClear();
    f.api.verify.mockRejectedValueOnce(new ApiError(401, 'INVALID_TOKEN'));
    expect(await f.call()).toMatchObject({ status: 401, headers: { 'WWW-Authenticate': 'Bearer', 'Cache-Control': 'no-store' } });
    expect(f.api.limiter.check).not.toHaveBeenCalled();
    expect(f.get).not.toHaveBeenCalled();
    f.api.limiter.check.mockRejectedValueOnce(new ApiError(429, 'REQUEST_LIMIT_EXCEEDED'));
    expect(await f.call()).toMatchObject({ status: 429, headers: { 'Retry-After': '60' } });
    f.api.limiter.check.mockRejectedValueOnce(new Error('Fictional quota outage'));
    expect(await f.call()).toMatchObject({ status: 503, jsonBody: { code: 'SERVICE_UNAVAILABLE' } });
    expect(f.get).not.toHaveBeenCalled();
    f.api.verify.mockResolvedValue(member);
    expect(await f.call('scores')).toMatchObject({ status: 404 });
  });

  it('logs only safe diagnostics, never score bodies, JWTs or raw SDK errors', async () => {
    const f = await fixture();
    const log = vi.spyOn(f.context, 'error');
    f.get.mockRejectedValueOnce(new Error('Fictional private-body-and-token marker'));
    expect(await f.call()).toMatchObject({ status: 503, headers: { 'Cache-Control': 'no-store' } });
    const output = JSON.stringify(log.mock.calls);
    expect(output).toContain('fictional-scoring');
    expect(output).not.toContain('private-body-and-token');
    expect(output).not.toContain('fictional-test-token');
    expect(output).not.toContain('strokes');
  });
});
