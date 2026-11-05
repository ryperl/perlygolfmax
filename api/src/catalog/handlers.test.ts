import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import { catalogFixture, identifier, manifest, tee } from '../../test/catalog-fixtures.js';
import { creator, event, member, settings } from '../../test/fixtures.js';
import { canManageCatalog } from '../identity.js';
import { ApiError } from '../errors.js';
import { createCatalogHandler } from './handlers.js';
import type { CatalogAction } from './handlers.js';
import { maximumEventSetupBytes } from '../../../src/domain/setup.js';

function fixture() {
  const f = catalogFixture();
  const api = {
    verify: vi.fn().mockResolvedValue(creator), canManageCatalog: (identity: typeof creator) => canManageCatalog(identity, settings),
    limiter: { check: vi.fn().mockResolvedValue(undefined) },
    courses: f.courses, players: f.players, workspace: f.workspace,
  };
  const context = new InvocationContext({ invocationId: 'fictional-catalog-test', logHandler: () => undefined });
  const call = (action: CatalogAction, method = 'GET', body?: unknown, params: Record<string, string> = {}, headers: Record<string, string> = {}, query = '') => {
    const request = new HttpRequest({
      url: `https://fictional.example.test/api/fixture${query}`, method, params,
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': identifier(100), ...headers },
      ...(body === undefined ? {} : { body: { string: typeof body === 'string' ? body : JSON.stringify(body) } }),
    });
    return createCatalogHandler(() => api, action)(request, context);
  };
  return { ...f, api, call, context };
}

describe('bounded authorized catalog/setup HTTP handlers', () => {
  it('scopes the larger exact UTF-8 budget to workspace PUT, not index refresh or catalogs', async () => {
    const f = fixture();
    const version = await f.publish();
    const save = vi.spyOn(f.workspace, 'save').mockResolvedValue({
      event: { ...event, role: 'owner', status: 'active', etag: 'fictional' },
      location: '', roster: [], rounds: [], etag: 'fictional',
    });
    const ids = [200, 201, 202, 203].map(identifier);
    const body = JSON.stringify({ name: 'Fictional 界 event', location: '', playerIds: ids,
      rounds: [{ id: identifier(500), name: 'Fictional round', courseId: version.courseId,
        courseVersionId: version.id, teeProfileId: tee.id, groups: [{ number: 1, playerIds: ids }] }],
      overallCompetition: null,
    });
    const exact = body + ' '.repeat(maximumEventSetupBytes - Buffer.byteLength(body, 'utf8'));
    expect(Buffer.byteLength(exact, 'utf8')).toBe(maximumEventSetupBytes);
    expect(await f.call('workspace', 'PUT', exact, { id: event.id }, { 'If-Match': 'fictional' })).toMatchObject({ status: 200 });
    expect(save).toHaveBeenCalledOnce();
    expect(await f.call('workspace', 'PUT', `${exact} `, { id: event.id }, { 'If-Match': 'fictional' })).toMatchObject({ status: 413 });
    expect(await f.call('workspace', 'PUT', body, { id: event.id },
      { 'If-Match': 'fictional', 'Content-Length': String(maximumEventSetupBytes + 1) })).toMatchObject({ status: 413 });
    expect(await f.call('round-indices-refresh', 'POST', ' '.repeat(4096) + '{}',
      { id: event.id, roundId: identifier(500) }, { 'If-Match': 'fictional' })).toMatchObject({ status: 413 });
    expect(await f.call('players', 'POST', ' '.repeat(4096) + '{}')).toMatchObject({ status: 413 });
  });
  it('implements staged import/profile/publish/version discovery with the agreed body and IDs', async () => {
    const f = fixture();
    expect(await f.call('imports', 'POST', manifest)).toMatchObject({ status: 200, jsonBody: { id: identifier(100), profilesReceived: [] } });
    expect(await f.call('import-profile', 'PUT', tee, { importId: identifier(100), profileId: String(tee.id) })).toMatchObject({ status: 200, jsonBody: { profilesReceived: [tee.id] } });
    const published = await f.call('import-publish', 'POST', { expectedEtag: null }, { importId: identifier(100) });
    expect(published.status).toBe(200);
    const version = await f.courses.publish(creator, identifier(100), null);
    expect(await f.call('course-version', 'GET', undefined, { courseId: version.courseId, versionId: version.id })).toMatchObject({ status: 200, jsonBody: version });
    expect(await f.call('courses')).toMatchObject({ status: 200, jsonBody: { courses: [{ currentVersionId: version.id }] } });
    expect(await f.call('import', 'GET', undefined, { importId: identifier(100) })).toMatchObject({ status: 200, jsonBody: { publishedVersionId: version.id } });
    expect(f.api.limiter.check).toHaveBeenCalledWith(creator, 'catalog-write');
    expect(f.api.limiter.check).toHaveBeenCalledWith(creator, 'catalog-read');
  });

  it('implements player create/rename/index/history without trusting supplied audit fields', async () => {
    const f = fixture();
    const playerId = identifier(100);
    expect(await f.call('players', 'POST', { displayName: 'Fictional Golfer' })).toMatchObject({ status: 200, jsonBody: { id: playerId, currentIndex: null } });
    const player = await f.players.get(creator, playerId);
    expect(await f.call('player', 'PATCH', { displayName: 'Fictional Renamed' }, { playerId }, { 'If-Match': player.etag })).toMatchObject({ status: 200, jsonBody: { displayName: 'Fictional Renamed' } });
    const renamed = await f.players.get(creator, playerId);
    expect(await f.call('indices', 'POST', {
      value: '+2.3', effectiveDate: '2026-03-01', source: 'Fictional manual entry',
      recordedBy: member, recordedAt: '1900-01-01', previousObservationId: identifier(900),
    }, { playerId }, { 'If-Match': renamed.etag, 'Idempotency-Key': identifier(300) })).toMatchObject({
      status: 200, jsonBody: { currentIndex: { value: '+2.3', recordedBy: creator, previousObservationId: null } },
    });
    expect(await f.call('indices', 'GET', undefined, { playerId })).toMatchObject({ status: 200, jsonBody: { observations: [{ id: identifier(300) }] } });
    expect(await f.call('players')).toMatchObject({ status: 200, jsonBody: { players: [{ displayName: 'Fictional Renamed' }] } });
  });

  it('reads and saves configured workspace through its separate bounded request classes', async () => {
    const f = fixture();
    f.seedEvent();
    const version = await f.publish();
    const players = await Promise.all([200, 201, 202, 203].map((id) => f.players.create(creator, identifier(id), `Fictional Player ${String(id)}`)));
    const empty = await f.workspace.get(creator, event.id);
    const playerIds = players.map((player) => player.id);
    expect(await f.call('workspace', 'GET', undefined, { id: event.id })).toMatchObject({ status: 200, jsonBody: empty });
    expect(await f.call('workspace', 'PUT', {
      name: 'Fictional Saved', location: '', playerIds,
      rounds: [{
        id: identifier(500), name: 'Fictional Round', courseId: version.courseId, courseVersionId: version.id,
        teeProfileId: tee.id, groups: [{ number: 2, playerIds }],
      }],
    }, { id: event.id }, { 'If-Match': empty.etag })).toMatchObject({ status: 200, jsonBody: { roster: players.map((player) => ({ playerId: player.id, displayName: player.displayName })) } });
    expect(f.api.limiter.check).toHaveBeenCalledWith(creator, 'setup-read');
    expect(f.api.limiter.check).toHaveBeenCalledWith(creator, 'setup-write');
    const saved = await f.workspace.get(creator, event.id);
    const first = players[0];
    if (!first) throw new Error('Missing fictional first player');
    await f.players.observe(creator, first.id, identifier(300), {
      value: '+2.3', effectiveDate: '2026-03-01', source: 'Fictional later current index',
    }, first.etag);
    const headers = { 'If-Match': saved.etag, 'Idempotency-Key': identifier(600) };
    const params = { id: event.id, roundId: identifier(500) };
    const refreshed = await f.call('round-indices-refresh', 'POST', {}, params, headers);
    expect(refreshed).toMatchObject({
      status: 200, jsonBody: { rounds: [{ players: [{ handicapIndex: { value: '+2.3' } }, { handicapIndex: null }, { handicapIndex: null }, { handicapIndex: null }] }] },
    });
    expect(await f.call('round-indices-refresh', 'POST', {}, params, headers)).toEqual(refreshed);
    expect(f.api.limiter.check).toHaveBeenLastCalledWith(creator, 'setup-write');
    f.api.verify.mockResolvedValue(member);
    expect(await f.call('round-indices-refresh', 'POST', {}, params, headers)).toMatchObject({ status: 404 });
  });

  it('creates an initial index atomically, ignores supplied audit identities and replays after a lost response', async () => {
    const f = fixture();
    const body = {
      displayName: 'Fictional Initially Known Player',
      initialIndex: {
        value: '+1.2', effectiveDate: '2026-03-01', source: 'Fictional manual initial entry',
        recordedAt: '1900-01-01', recordedBy: member, previousObservationId: identifier(900),
      },
    };
    f.submit.mockImplementationOnce((actions) => {
      f.apply(actions);
      return Promise.reject(new Error('Fictional lost creation reply'));
    });
    expect(await f.call('players', 'POST', body)).toMatchObject({ status: 503, jsonBody: { code: 'SERVICE_UNAVAILABLE' } });
    expect(await f.call('players', 'POST', body)).toMatchObject({
      status: 200, jsonBody: {
        currentIndex: {
          id: identifier(100), value: '+1.2', effectiveDate: '2026-03-01',
          source: 'Fictional manual initial entry', recordedBy: creator, previousObservationId: null,
        },
      },
    });
    expect((await f.players.get(creator, identifier(100))).currentIndex?.recordedAt).not.toBe('1900-01-01');
    expect((await f.players.history(creator, identifier(100))).observations).toHaveLength(1);
    expect(await f.call('players', 'POST', { ...body, initialIndex: { ...body.initialIndex, value: '4' } })).toMatchObject({ status: 409 });
  });

  it.each([
    null, {}, { value: '2' }, { value: '-1', effectiveDate: '2026-03-01', source: 'Fictional source' },
    { value: '2', effectiveDate: '2026-02-30', source: 'Fictional source' },
    { value: '2', effectiveDate: '2026-03-01', source: '' },
  ])('rejects invalid initial index %j before creating a profile', async (initialIndex) => {
    const f = fixture();
    expect(await f.call('players', 'POST', { displayName: 'Fictional Player', initialIndex })).toMatchObject({
      status: 400, jsonBody: { code: 'INVALID_INDEX_OBSERVATION' },
    });
    expect(f.create).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
  });

  it.each([
    ['POST', {}, { id: event.id, roundId: 'invalid' }, { 'If-Match': 'etag' }, 400],
    ['POST', {}, { id: event.id, roundId: identifier(500) }, { 'If-Match': '*' }, 400],
    ['POST', {}, { id: event.id, roundId: identifier(500) }, { 'If-Match': 'etag', 'Idempotency-Key': '*' }, 400],
    ['POST', [], { id: event.id, roundId: identifier(500) }, { 'If-Match': 'etag' }, 400],
    ['POST', { playerIds: [] }, { id: event.id, roundId: identifier(500) }, { 'If-Match': 'etag' }, 400],
    ['POST', 'x'.repeat(4097), { id: event.id, roundId: identifier(500) }, { 'If-Match': 'etag' }, 413],
    ['GET', undefined, { id: event.id, roundId: identifier(500) }, {}, 405],
  ] as const)('rejects malformed or unsupported refresh requests before storage mutation', async (method, body, params, headers, status) => {
    const f = fixture();
    expect(await f.call('round-indices-refresh', method, body, params, headers)).toMatchObject({ status });
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.get).not.toHaveBeenCalled();
  });

  it('rejects invalid tokens, nonmanagers and cross-tenant callers before any global catalog IO', async () => {
    const f = fixture();
    f.api.verify.mockRejectedValueOnce(new ApiError(401, 'INVALID_ACCESS_TOKEN'));
    expect(await f.call('courses')).toMatchObject({ status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
    expect(f.api.limiter.check).not.toHaveBeenCalled();
    for (const identity of [member, { ...creator, tenantId: member.objectId }]) {
      f.api.verify.mockResolvedValue(identity);
      for (const [action, method] of [['courses', 'GET'], ['players', 'GET'], ['imports', 'POST'], ['indices', 'GET']] as const) {
        expect(await f.call(action, method, method === 'POST' ? {} : undefined)).toMatchObject({ status: 403, jsonBody: { code: 'CATALOG_MANAGEMENT_FORBIDDEN' } });
      }
    }
    expect(f.get).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.list).not.toHaveBeenCalled();
  });

  it.each([
    ['imports', 'POST', {}, {}, {}, 400],
    ['imports', 'POST', manifest, {}, { 'Idempotency-Key': '*' }, 400],
    ['imports', 'POST', manifest, {}, { 'Content-Type': 'text/plain' }, 415],
    ['imports', 'POST', '{', {}, {}, 400],
    ['imports', 'POST', 'x'.repeat(4097), {}, { 'Content-Length': '1' }, 413],
    ['imports', 'POST', 'é'.repeat(2100), {}, {}, 413],
    ['imports', 'POST', manifest, {}, { 'Content-Length': '-1' }, 413],
    ['import-profile', 'PUT', tee, { importId: identifier(100), profileId: '101junk' }, {}, 400],
    ['import-profile', 'PUT', { ...tee, category: '' }, { importId: identifier(100), profileId: '101' }, {}, 400],
    ['import-publish', 'POST', {}, { importId: identifier(100) }, {}, 400],
    ['import-publish', 'POST', { expectedEtag: '*' }, { importId: identifier(100) }, {}, 400],
    ['course-version', 'GET', undefined, { courseId: 'wrong', versionId: 'a'.repeat(64) }, {}, 400],
    ['player', 'PATCH', { displayName: 'Fictional Player' }, { playerId: identifier(200) }, {}, 400],
    ['player', 'PATCH', { displayName: ' ' }, { playerId: identifier(200) }, { 'If-Match': 'etag' }, 400],
    ['indices', 'POST', { value: null, effectiveDate: '2026-01-01', source: 'manual' }, { playerId: identifier(200) }, { 'If-Match': 'etag' }, 400],
    ['indices', 'POST', { value: '-1', effectiveDate: '2026-01-01', source: 'manual' }, { playerId: identifier(200) }, { 'If-Match': 'etag' }, 400],
    ['indices', 'POST', { value: '1', effectiveDate: '2026-02-30', source: 'manual' }, { playerId: identifier(200) }, { 'If-Match': 'etag' }, 400],
    ['workspace', 'PUT', {}, { id: event.id }, { 'If-Match': 'etag' }, 400],
    ['workspace', 'PUT', {}, { id: event.id }, { 'If-Match': '*' }, 400],
    ['courses', 'POST', {}, {}, {}, 405],
  ] as const)('rejects invalid %s requests before mutation', async (action, method, body, params, headers, status) => {
    const f = fixture();
    expect(await f.call(action, method, body, params, headers)).toMatchObject({ status, headers: { 'Cache-Control': 'no-store' } });
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });

  it('validates bounded cursors and applies filters again instead of trusting a cursor as authority', async () => {
    const f = fixture();
    for (const cursor of ['', 'notjson', 'x'.repeat(2049), Buffer.from('{"nextPartitionKey":4}').toString('base64')]) {
      expect(await f.call('courses', 'GET', undefined, {}, {}, `?cursor=${encodeURIComponent(cursor)}`)).toMatchObject({ status: 400 });
    }
    expect(f.list).not.toHaveBeenCalled();
    const cursor = Buffer.from('{"nextPartitionKey":"catalog:course:ghin:12:11","nextRowKey":"catalog-course"}').toString('base64');
    expect(await f.call('courses', 'GET', undefined, {}, {}, `?cursor=${encodeURIComponent(cursor)}`)).toMatchObject({ status: 200 });
    expect(f.list.mock.calls[0]?.[0]?.queryOptions?.filter).toContain("RowKey eq 'catalog-course'");
  });

  it('fails closed on limiter and storage failures with safe diagnostics and no-store responses', async () => {
    const f = fixture();
    f.api.limiter.check.mockRejectedValueOnce(new ApiError(429, 'REQUEST_LIMIT_EXCEEDED'));
    expect(await f.call('courses')).toMatchObject({ status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } });
    expect(f.list).not.toHaveBeenCalled();
    f.api.limiter.check.mockRejectedValueOnce(new Error('Fictional private provider message'));
    const log = vi.spyOn(f.context, 'error');
    expect(await f.call('courses')).toMatchObject({ status: 503, jsonBody: { code: 'SERVICE_UNAVAILABLE' } });
    expect(JSON.stringify(log.mock.calls)).not.toContain('Fictional private provider message');
    f.get.mockRejectedValueOnce(new Error('Fictional private storage message'));
    expect(await f.call('import', 'GET', undefined, { importId: identifier(100) })).toMatchObject({ status: 503, jsonBody: { code: 'SERVICE_UNAVAILABLE' } });
    expect(JSON.stringify(log.mock.calls)).not.toContain('Fictional private storage message');
  });
});
