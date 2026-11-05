import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import { event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { ApiError } from '../errors.js';
import { createScoringHandler } from '../scoring/handlers.js';
import { createCatalogHandler } from '../catalog/handlers.js';
import { createHandler } from '../events/handlers.js';
import { TableEventStore } from '../events/store.js';
import { createPurseHandler } from '../purse/handlers.js';
import { isEventWorkspace } from '../../../src/contracts/setup.js';
import { isRoundScores, isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { isEventLeaderboardView } from '../../../src/contracts/event-leaderboard.js';
import { isEventPurseView } from '../../../src/contracts/purse-settings.js';
import { isRecord } from '../../../src/contracts/events.js';
import { createPublicHandler } from './handlers.js';
import type { PublicAction } from './handlers.js';
import { publicFixture } from './test-support.js';

async function fixture() {
  const f = await publicFixture();
  const verify = vi.fn().mockRejectedValue(new ApiError(401, 'AUTHENTICATION_REQUIRED'));
  const api = { verify, publicEvents: f.publicEvents, workspace: f.workspace, scores: f.scores, purse: f.purse,
    courses: f.courses, players: f.players, canManageCatalog: () => false, canCreate: () => false,
    store: new TableEventStore(f.table), limiter: { check: vi.fn().mockResolvedValue(undefined) } };
  const context = new InvocationContext({ invocationId: 'fictional-public-http', logHandler: () => undefined });
  function request(action: PublicAction, body?: unknown, headers: Readonly<Record<string, string>> = {},
    params: Readonly<Record<string, string>> = {}, query = '', method?: string) {
    return new HttpRequest({
      url: `https://fictional.example.test/api/public/events/${event.id}/${action}${query}`,
      method: method ?? (action === 'score-hole' ? 'PUT' : 'GET'),
      params: { id: event.id, roundId: f.roundId, playerId: f.peerId, holeNumber: '1', ...params },
      headers: { 'Content-Type': 'application/json', 'If-None-Match': '*', 'Idempotency-Key': identifier(5100), ...headers },
      ...(body === undefined ? {} : { body: { string: JSON.stringify(body) } }),
    });
  }
  const invoke = (action: PublicAction, body?: unknown, headers?: Readonly<Record<string, string>>, params?: Readonly<Record<string, string>>, query?: string) =>
    createPublicHandler(() => api, action)(request(action, body, headers, params, query), context);
  return { ...f, api, context, request, invoke };
}

describe('explicit unsigned public HTTP namespace', () => {
  it('serves discovery, workspace, every group, overall and purse without verifying JWT or credentials', async () => {
    const f = await fixture();
    expect(await f.invoke('events')).toMatchObject({ status: 200, jsonBody: {
      events: [{ id: event.id, role: 'viewer', status: 'active' }],
    } });
    const workspace = await f.invoke('workspace');
    expect(isEventWorkspace(workspace.jsonBody)).toBe(true);
    expect(workspace).toMatchObject({ status: 200, headers: { 'Cache-Control': 'no-store' }, jsonBody: { publicAccess: true } });
    expect(isRoundScores((await f.invoke('scores')).jsonBody)).toBe(true);
    for (const [index, playerId] of [f.peerId, f.foreignId].entries()) {
      const saved = await f.invoke('score-hole', { score: { kind: 'strokes', strokes: 4 } },
        { 'Idempotency-Key': identifier(5110 + index) }, { playerId });
      expect(saved.status).toBe(200);
      expect(isScoreWriteResult(saved.jsonBody)).toBe(true);
    }
    expect(isEventLeaderboardView((await f.invoke('event-leaderboard')).jsonBody)).toBe(true);
    expect(isEventPurseView((await f.invoke('purse')).jsonBody)).toBe(true);
    expect(f.api.verify).not.toHaveBeenCalled();
    expect(f.api.limiter.check).toHaveBeenCalledWith({ kind: 'public-browse' }, 'events-read');
    expect(f.api.limiter.check).toHaveBeenCalledWith(f.actor, 'scores-write');
    expect(f.api.limiter.check).toHaveBeenCalledWith(f.actor, 'scores-read');
    expect(f.api.limiter.check).toHaveBeenCalledWith(f.actor, 'setup-read');
  });

  it('retains exact ETags, UUID operations, hole parsing, score-only bodies and the ordinary 4 KiB cap', async () => {
    const f = await fixture();
    const score = { score: { kind: 'strokes', strokes: 4 } };
    for (const headers of [{ 'If-Match': '*' }, { 'If-Match': 'one,two' }, { 'Idempotency-Key': 'invalid' }]) {
      expect((await f.invoke('score-hole', score, headers)).status).toBe(400);
    }
    for (const body of [{ ...score, role: 'owner' }, { ...score, actor: f.actor },
      { score: { kind: 'strokes', strokes: 0 } }, { score: { kind: 'unplayed' }, padding: 'x'.repeat(5000) }]) {
      expect([400, 413]).toContain((await f.invoke('score-hole', body)).status);
    }
    for (const holeNumber of ['0', '01', '19', '1.0', 'NaN']) {
      expect((await f.invoke('score-hole', score, {}, { holeNumber })).status).toBe(400);
    }
    const noPrecondition = f.request('score-hole', score);
    noPrecondition.headers.delete('If-None-Match');
    expect((await createPublicHandler(() => f.api, 'score-hole')(noPrecondition, f.context)).status).toBe(400);
    expect(f.submit).not.toHaveBeenCalled();
    const saved = await f.invoke('score-hole', score);
    if (!isScoreWriteResult(saved.jsonBody)) throw new Error('Missing fictional public HTTP save');
    const card = saved.jsonBody.round.cards.find((entry) => entry.playerId === f.peerId);
    if (!card?.etag) throw new Error('Missing fictional public HTTP card');
    const update = f.request('score-hole', { score: { kind: 'picked-up', reportedStrokes: 7 } }, {
      'If-Match': card.etag, 'Idempotency-Key': identifier(5120),
    });
    update.headers.delete('If-None-Match');
    expect((await createPublicHandler(() => f.api, 'score-hole')(update, f.context)).status).toBe(200);
  });

  it('validates bounded continuationToken paging and never selects archived events through a query', async () => {
    const f = await fixture();
    const list = vi.spyOn(f.publicEvents, 'list');
    for (const token of ['', 'not-a-cursor', 'x'.repeat(2049), Buffer.from(JSON.stringify({ nextPartitionKey: 3 })).toString('base64')]) {
      expect((await f.invoke('events', undefined, {}, {}, `?continuationToken=${encodeURIComponent(token)}`)).status).toBe(400);
    }
    expect(list).not.toHaveBeenCalled();
    const token = Buffer.from(JSON.stringify({ nextPartitionKey: event.id, nextRowKey: 'event' })).toString('base64');
    expect((await f.invoke('events', undefined, {}, {}, `?continuationToken=${encodeURIComponent(token)}&status=archived`)).status).toBe(200);
    expect(list).toHaveBeenCalledWith({ kind: 'public-browse' }, token);
    f.seed({ ...f.row('event'), status: 'archived' });
    expect(await f.invoke('events')).toMatchObject({ status: 200, jsonBody: { events: [] } });
  });

  it('keeps ALL private reads/management/history/catalogs JWT-only without public principal elevation', async () => {
    const f = await fixture();
    const requests = [
      () => createHandler(() => f.api, 'events')(f.request('events'), f.context),
      () => createHandler(() => f.api, 'events')(f.request('events', {}, {}, {}, '', 'POST'), f.context),
      () => createHandler(() => f.api, 'event-status')(f.request('workspace', {}, {}, {}, '', 'PATCH'), f.context),
      () => createCatalogHandler(() => f.api, 'courses')(f.request('workspace'), f.context),
      () => createCatalogHandler(() => f.api, 'players')(f.request('workspace'), f.context),
      () => createCatalogHandler(() => f.api, 'indices')(f.request('workspace'), f.context),
      () => createCatalogHandler(() => f.api, 'workspace')(f.request('workspace'), f.context),
      () => createCatalogHandler(() => f.api, 'workspace')(f.request('workspace', {}, {}, {}, '', 'PUT'), f.context),
      () => createScoringHandler(() => f.api, 'scores')(f.request('scores'), f.context),
      () => createScoringHandler(() => f.api, 'score-history')(f.request('scores'), f.context),
      () => createScoringHandler(() => f.api, 'round-games')(f.request('scores', {}, {}, {}, '', 'PUT'), f.context),
      () => createPurseHandler(() => f.api)(f.request('purse'), f.context),
      () => createPurseHandler(() => f.api)(f.request('purse', {}, {}, {}, '', 'PUT'), f.context),
    ];
    for (const invoke of requests) expect((await invoke()).status).toBe(401);
    expect(f.api.verify).toHaveBeenCalledTimes(requests.length);
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.api.limiter.check).not.toHaveBeenCalled();
    for (const action of ['events', 'workspace', 'scores', 'score-hole', 'event-leaderboard', 'purse'] as const) {
      const wrongMethod = f.request(action, {}, {}, {}, '', 'POST');
      expect((await createPublicHandler(() => f.api, action)(wrongMethod, f.context)).status).toBe(405);
    }
  });

  it('returns the same no-store unavailable classification for missing/archived event reads, purse and writes', async () => {
    const f = await fixture();
    f.seed({ ...f.row('event'), status: 'archived' });
    for (const id of [event.id, identifier(5999), 'invalid']) {
      for (const action of ['workspace', 'scores', 'score-hole', 'event-leaderboard', 'purse'] as const) {
        expect(await f.invoke(action, action === 'score-hole' ? { score: { kind: 'strokes', strokes: 4 } } : undefined, {}, { id }))
          .toMatchObject({ status: 404, headers: { 'Cache-Control': 'no-store' }, jsonBody: { code: 'PUBLIC_EVENT_NOT_AVAILABLE' } });
      }
    }
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('uses existing digest-bound response pages, never silently truncating public data', async () => {
    const f = await fixture();
    const base = await f.workspace.get(f.actor, event.id);
    vi.spyOn(f.workspace, 'get').mockResolvedValue({ ...base, location: 'x'.repeat(80_000) });
    const first = await f.invoke('workspace');
    if (!isRecord(first.jsonBody) || !isRecord(first.jsonBody.privateRead)) throw new Error('Missing fictional public digest page');
    expect(first.jsonBody.privateRead.index).toBe(0);
    expect(typeof first.jsonBody.privateRead.parts).toBe('number');
    const hash = String(first.jsonBody.privateRead.sha256);
    expect((await f.invoke('workspace', undefined, {}, {}, `?privatePart=1&privateHash=${hash}`)).status).toBe(200);
    expect((await f.invoke('workspace', undefined, {}, {}, `?privatePart=1&privateHash=${'0'.repeat(64)}`)).status).toBe(409);
  });

  it('fails closed on shared quota/configuration errors before reads/writes and keeps provider detail out of logs', async () => {
    const f = await fixture();
    const list = vi.spyOn(f.publicEvents, 'list');
    const log = vi.spyOn(f.context, 'error');
    f.api.limiter.check.mockRejectedValueOnce(new ApiError(429, 'REQUEST_LIMIT_EXCEEDED'));
    expect(await f.invoke('events')).toMatchObject({ status: 429, headers: { 'Retry-After': '60' } });
    expect(list).not.toHaveBeenCalled();
    f.api.limiter.check.mockRejectedValueOnce(new Error('Fictional private provider diagnostic'));
    const failed = await f.invoke('score-hole', { score: { kind: 'strokes', strokes: 4 } });
    expect(failed).toMatchObject({ status: 503, headers: { 'Cache-Control': 'no-store' } });
    expect(JSON.stringify(log.mock.calls)).not.toContain('Fictional private provider diagnostic');
    expect(f.submit).not.toHaveBeenCalled();
    expect((await createPublicHandler(() => { throw new Error('Fictional missing settings'); }, 'events')(f.request('events'), f.context)).status).toBe(503);
  });
});
