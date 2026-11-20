import { HttpRequest, InvocationContext } from '@azure/functions';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ChurchyGameDefinition } from '../../../src/domain/churchy.js';
import { defaultChurchySpecials } from '../../../src/domain/churchy.js';
import { decodeRoundScores, isScoreHistoryPage } from '../../../src/contracts/scoring.js';
import { isRecord } from '../../../src/contracts/events.js';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { publicFixture } from '../public-access/test-support.js';
import { createPublicHandler } from '../public-access/handlers.js';
import { createPurseHandler } from '../purse/handlers.js';
import { createScoringHandler } from './handlers.js';

async function fixture(version: 1 | 2 | 3) {
  const f = await publicFixture();
  const common = { id: identifier(28000), name: version === 3 ? 'Churchie' : 'Churchy Game', kind: 'churchy' as const,
    basis: 'net' as const, currency: 'USD' as const, amountPerDotMinor: 50, groupNumber: 1,
    playerIds: f.input.playerIds.slice(0, 4) };
  const game: ChurchyGameDefinition = version === 1 ? { ...common, version }
    : version === 2 ? { ...common, version, enabledSpecials: defaultChurchySpecials }
      : { ...common, version, orderMode: 'tee', specials: [{ kind: 'birdie', units: 2 }] };
  const initial = await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(28001));
  const limiter = { check: vi.fn().mockResolvedValue(undefined) };
  const ownerApi = { verify: vi.fn().mockResolvedValue(creator), limiter, scores: f.scores };
  const publicApi = { publicEvents: f.publicEvents, workspace: f.workspace, scores: f.scores, purse: f.purse, limiter };
  const context = new InvocationContext({ invocationId: 'fictional-custom-names', logHandler: () => undefined });
  const request = (method: 'GET' | 'PUT', body?: unknown, query = '', etag: string | null = null, operation = 28002) => new HttpRequest({
    method, url: `https://fictional.example.test/api/fixture?${query}`,
    params: { id: event.id, roundId: f.roundId, playerId: f.playerId, holeNumber: '1' },
    ...(method === 'PUT' ? { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': identifier(operation),
      ...(etag === null ? { 'If-None-Match': '*' } : { 'If-Match': etag }) },
    body: { string: JSON.stringify(body) } } : {}),
  });
  return { ...f, game, initial, ownerApi, publicApi, context, request };
}

describe('Churchie custom-name HTTP negotiation and publication fences', () => {
  it('refuses publication of an old client’s complete custom-name upload, but retains inactive parts for a negotiated retry', async () => {
    const f = await fixture(3);
    const writer = createScoringHandler(() => f.ownerApi, 'round-games');
    const game = { ...f.game, name: 'Fictional staged challenge' };
    const bytes = Buffer.from(JSON.stringify({ games: [game] }));
    const upload = { id: identifier(28020), bytes: bytes.length, parts: 1,
      sha256: createHash('sha256').update(bytes).digest('hex') };
    const etag = f.initial.round.games?.configuration.etag ?? null;
    expect(await writer(f.request('PUT', { privateUpload: { ...upload, index: 0, content: bytes.toString('base64') } },
      '', etag, 28020), f.context)).toMatchObject({ status: 200, jsonBody: { privateStaged: { id: upload.id, index: 0 } } });
    const stagedRows = new Map(f.rows);
    f.submit.mockClear();
    expect(await writer(f.request('PUT', { privateCommit: upload }, '', etag, 28020), f.context))
      .toMatchObject({ status: 426, jsonBody: { code: 'CHURCHY_NAMES_CLIENT_UPDATE_REQUIRED' } });
    expect(f.rows).toEqual(stagedRows);
    expect((await f.scores.get(creator, event.id, f.roundId)).games?.configuration.games).toEqual([f.game]);
    expect(await writer(f.request('PUT', { privateCommit: upload }, 'churchyNames=1', etag, 28020), f.context))
      .toMatchObject({ status: 200 });
    expect((await f.scores.get(creator, event.id, f.roundId)).games?.configuration.games).toEqual([game]);
  });

  it.each([1, 2, 3] as const)('preserves version %i rules and old literal reads, while rejecting old custom-name publications before mutation', async (version) => {
    const f = await fixture(version);
    const reader = createScoringHandler(() => f.ownerApi, 'scores');
    const writer = createScoringHandler(() => f.ownerApi, 'round-games');
    const old = await reader(f.request('GET'), f.context);
    expect(old.status).toBe(200);
    expect(old.jsonBody).not.toHaveProperty('churchyCustomNames');
    expect(decodeRoundScores(old.jsonBody)?.games?.configuration.games).toEqual([f.game]);
    const custom = { ...f.game, name: 'Fictional group challenge' };
    const etag = f.initial.round.games?.configuration.etag ?? null;
    const rows = new Map(f.rows);
    f.submit.mockClear();
    for (const query of ['', 'churchyNames=0', 'churchyNames=1&churchyNames=1']) {
      expect(await writer(f.request('PUT', { games: [custom] }, query, etag), f.context))
        .toMatchObject({ status: 426, jsonBody: { code: 'CHURCHY_NAMES_CLIENT_UPDATE_REQUIRED' } });
    }
    expect(f.rows).toEqual(rows);
    expect(f.submit).not.toHaveBeenCalled();
    const saved = await writer(f.request('PUT', { games: [custom] }, 'churchyNames=1&format=lean', etag), f.context);
    expect(saved.status).toBe(200);
    if (!isRecord(saved.jsonBody)) throw new Error('Missing fictional game result.');
    const round = decodeRoundScores(saved.jsonBody.round);
    expect(round?.churchyCustomNames).toBe(true);
    expect(round?.games?.configuration.games).toEqual([custom]);
    expect(await writer(f.request('PUT', { games: [custom] }, 'churchyNames=1&format=lean', etag), f.context)).toEqual(saved);
    await f.scores.write(creator, event.id, f.roundId, f.playerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(28030));
    const lockedRows = new Map(f.rows);
    expect(await writer(f.request('PUT', { games: [{ ...custom, name: 'Fictional locked rename' }] },
      'churchyNames=1', round?.games?.configuration.etag ?? null, 28031), f.context))
      .toMatchObject({ status: 409, jsonBody: { code: 'CHURCHY_SETUP_LOCKED' } });
    expect(f.rows).toEqual(lockedRows);
  });

  it.each(['owner', 'public'] as const)('fences affected %s full/lean/paged reads and every response-bearing write before mutation, preserving canonical custom audits', async (role) => {
    const f = await fixture(3);
    const reader = role === 'owner' ? createScoringHandler(() => f.ownerApi, 'scores')
      : createPublicHandler(() => f.publicApi, 'scores');
    const writer = role === 'owner' ? createScoringHandler(() => f.ownerApi, 'score-hole')
      : createPublicHandler(() => f.publicApi, 'score-hole');
    const staged = role === 'owner' ? createScoringHandler(() => f.ownerApi, 'score-game-hole')
      : createPublicHandler(() => f.publicApi, 'score-game-hole');
    const games = role === 'owner' ? createScoringHandler(() => f.ownerApi, 'round-games')
      : createPublicHandler(() => f.publicApi, 'games');
    const game = { ...f.game, name: 'Fictional evening Churchie' };
    const setup = await games(f.request('PUT', { games: [game] }, 'churchyNames=1',
      f.initial.round.games?.configuration.etag ?? null), f.context);
    expect(setup.status).toBe(200);
    const current = await f.scores.get(f.actor, event.id, f.roundId);
    const before = new Map(f.rows);
    f.submit.mockClear();
    for (const format of ['', '&format=lean']) {
      expect(await reader(f.request('GET', undefined, `legacy=1${format}`), f.context))
        .toMatchObject({ status: 426, jsonBody: { code: 'CHURCHY_NAMES_CLIENT_UPDATE_REQUIRED' } });
      const read = await reader(f.request('GET', undefined, `churchyNames=1${format}`), f.context);
      expect(read.status).toBe(200);
      expect(decodeRoundScores(read.jsonBody)?.games?.configuration.games).toEqual([game]);
      const hash = createHash('sha256').update(JSON.stringify(read.jsonBody)).digest('hex');
      expect(await reader(f.request('GET', undefined, `churchyNames=1${format}&privatePart=0&privateHash=${hash}`), f.context))
        .toMatchObject({ status: 200, jsonBody: { privateRead: { sha256: hash, index: 0 } } });
    }
    expect(await writer(f.request('PUT', { score: { kind: 'strokes', strokes: 3 } }), f.context)).toMatchObject({ status: 426 });
    expect(await staged(f.request('PUT', { privateUpload: {} }), f.context)).toMatchObject({ status: 426 });
    expect(await games(f.request('PUT', { privateUpload: {} }), f.context)).toMatchObject({ status: 426 });
    expect(await games(f.request('PUT', { games: [f.game] }, '', current.games?.configuration.etag ?? null), f.context))
      .toMatchObject({ status: 426 });
    if (role === 'owner') {
      const kp = createScoringHandler(() => f.ownerApi, 'round-kp');
      expect(await kp(f.request('PUT', { privateUpload: {} }), f.context)).toMatchObject({ status: 426 });
      expect(await kp(f.request('PUT', { version: 1, context: 'fictional-kp-context', status: 'open', decisions: [] }), f.context))
        .toMatchObject({ status: 426 });
      const purse = createPurseHandler(() => ({ verify: f.ownerApi.verify, limiter: f.ownerApi.limiter, purse: f.purse }));
      const plan = { eventId: event.id, currency: 'USD', funding: { kind: 'fixed', budgetMinor: 100 },
        pools: [{ id: identifier(28010), name: 'Fictional pot', source: { kind: 'manual' },
          awardUnit: 'pot', amountMinor: 100, recipientIds: [f.playerId] }] };
      expect(await purse(f.request('PUT', { plan, resolutions: [] }), f.context)).toMatchObject({ status: 426 });
      expect(await purse(f.request('PUT', { privateUpload: {} }), f.context)).toMatchObject({ status: 426 });
      expect(f.rows).toEqual(before);
      expect(f.submit).not.toHaveBeenCalled();
      expect(await purse(f.request('PUT', { plan, resolutions: [] }, 'churchyNames=1', null, 28011), f.context))
        .toMatchObject({ status: 200 });
    } else {
      expect(f.rows).toEqual(before);
      expect(f.submit).not.toHaveBeenCalled();
    }
    const score = { kind: 'strokes', strokes: (current.layout[0]?.par ?? 4) - 1 };
    const saved = await writer(f.request('PUT', { score }, 'churchyNames=1&format=lean', null, 28012), f.context);
    expect(saved.status).toBe(200);
    expect(await writer(f.request('PUT', { score }, 'churchyNames=1&format=lean', null, 28012), f.context)).toEqual(saved);
    const receipt = { ...f.row(`score-change:${identifier(28012)}`) };
    const capture = { ...f.row(`index-capture:${f.roundId}`) };
    const history = createScoringHandler(() => f.ownerApi, 'score-history');
    expect(await history(f.request('GET'), f.context)).toMatchObject({ status: 426 });
    const modern = await history(f.request('GET', undefined, 'churchyNames=1'), f.context);
    expect(modern.status).toBe(200);
    if (!isScoreHistoryPage(modern.jsonBody)) throw new Error('Missing fictional history.');
    expect(modern.jsonBody.changes.flatMap((change) => change.dotAwardAudit ?? []))
      .toContainEqual(expect.objectContaining({ configuration: game }));
    expect(f.row(`score-change:${identifier(28012)}`)).toEqual(receipt);
    expect(f.row(`index-capture:${f.roundId}`)).toEqual(capture);
    expect((await f.scores.get(f.actor, event.id, f.roundId)).games?.configuration.games).toEqual([game]);
  });
});
