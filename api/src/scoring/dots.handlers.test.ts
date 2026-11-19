import { HttpRequest, InvocationContext } from '@azure/functions';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { DotsGameDefinition } from '../../../src/domain/dots.js';
import type { ChurchyGameDefinitionV3 } from '../../../src/domain/churchy.js';
import { decodeRoundScores, isScoreHistoryPage, isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { isRecord } from '../../../src/contracts/events.js';
import { maximumGameConfigurationBytes } from '../../../src/domain/games.js';
import { publicFixture } from '../public-access/test-support.js';
import { createPublicHandler } from '../public-access/handlers.js';
import type { PublicAction } from '../public-access/handlers.js';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { createScoringHandler } from './handlers.js';
import { ApiError } from '../errors.js';
import { createPurseHandler } from '../purse/handlers.js';

async function fixture() {
  const f = await publicFixture();
  const game: DotsGameDefinition = { id: identifier(21000), name: 'Fictional Dots', kind: 'dots', version: 1,
    groupNumber: 1, playerIds: f.input.playerIds.slice(0, 4), mode: 'individual', stakeMinor: null,
    specials: [{ kind: 'murphy', units: 1 }] };
  const limiter = { check: vi.fn().mockResolvedValue(undefined) };
  const api = { publicEvents: f.publicEvents, scores: f.scores, workspace: f.workspace, purse: f.purse, limiter };
  const context = new InvocationContext({ invocationId: 'fictional-dots-http', logHandler: () => undefined });
  const request = (body: unknown, operation: number, headers: Readonly<Record<string, string>> = {}, query = '') => new HttpRequest({
    method: 'PUT', url: `https://fictional.example.test/api/fixture${query}`,
    params: { id: event.id, roundId: f.roundId, playerId: f.playerId, holeNumber: '1' },
    headers: { 'Content-Type': 'application/json', 'If-None-Match': '*',
      'Idempotency-Key': identifier(operation), ...headers },
    body: { string: typeof body === 'string' ? body : JSON.stringify(body) },
  });
  const call = (action: PublicAction, body: unknown, operation: number, headers?: Readonly<Record<string, string>>) =>
    createPublicHandler(() => api, action)(request(body, operation, headers), context);
  return { ...f, game, api, context, request, call };
}

describe('Dots HTTP namespaces and public internal authority', () => {
  it.each(['owner', 'public'] as const)('negotiates category sweeps for %s before mutations and publishes coherent full/lean pages without rewriting saved inputs', async (role) => {
    const f = await fixture();
    const workspace = await f.workspace.get(creator, event.id);
    const snapshot = workspace.rounds.find((round) => round.id === f.roundId);
    if (!snapshot) throw new Error('Missing fictional round');
    f.seed({ ...f.row(`round:${f.roundId}`), content: JSON.stringify({ ...snapshot,
      teeProfile: { ...snapshot.teeProfile, totalPar: snapshot.teeProfile.totalPar + 1,
        holes: snapshot.teeProfile.holes.map((hole) => hole.number === 1 ? { ...hole, par: 5 } : hole) } }) });
    const game: DotsGameDefinition = { ...f.game,
      specials: [{ kind: 'long-drive', units: 1 }, { kind: 'blue-plate', units: 1 }] };
    const ownerApi = { verify: vi.fn().mockResolvedValue(creator), limiter: f.api.limiter, scores: f.scores };
    const writer = role === 'owner' ? createScoringHandler(() => ownerApi, 'score-hole')
      : createPublicHandler(() => f.api, 'score-hole');
    const staged = role === 'owner' ? createScoringHandler(() => ownerApi, 'score-game-hole')
      : createPublicHandler(() => f.api, 'score-game-hole');
    const gameWriter = role === 'owner' ? createScoringHandler(() => ownerApi, 'round-games')
      : createPublicHandler(() => f.api, 'games');
    const reader = role === 'owner' ? createScoringHandler(() => ownerApi, 'scores')
      : createPublicHandler(() => f.api, 'scores');
    const get = (query = '') => new HttpRequest({ method: 'GET', url: `https://fictional.example.test/api/fixture?${query}`,
      params: { id: event.id, roundId: f.roundId } });
    const empty = new Map(f.rows);
    f.submit.mockClear();
    expect(await gameWriter(f.request({ games: [game] }, 26000), f.context))
      .toMatchObject({ status: 426, jsonBody: { code: 'CATEGORY_SWEEPS_CLIENT_UPDATE_REQUIRED' } });
    expect(f.rows).toEqual(empty);
    const setup = await gameWriter(f.request({ games: [game] }, 26000, {}, '?categorySweeps=1'), f.context);
    expect(setup.status).toBe(200);
    const initial = await f.scores.get(f.actor, event.id, f.roundId);
    const score = { kind: 'strokes', strokes: 5, dots: [{ number: 1, gameId: game.id,
      gameEtag: initial.games?.configuration.etag ?? '', players: [], contests: [
        { kind: 'long-drive', status: 'awarded', winnerId: f.playerId },
        { kind: 'blue-plate', status: 'awarded', winnerId: f.playerId },
      ] }] };
    const untouched = await reader(get(), f.context);
    expect(untouched.status).toBe(200);
    expect(untouched.jsonBody).not.toHaveProperty('dotsCategorySweepsVersion');
    expect(decodeRoundScores(untouched.jsonBody)).not.toBeNull();
    const rows = new Map(f.rows);
    f.submit.mockClear();
    for (const query of ['', '?categorySweeps=0', '?categorySweeps=1&categorySweeps=1']) {
      expect(await writer(f.request({ score }, 26001, {}, query), f.context))
        .toMatchObject({ status: 426, jsonBody: { code: 'CATEGORY_SWEEPS_CLIENT_UPDATE_REQUIRED' } });
    }
    expect(await staged(f.request({ privateUpload: {} }, 26001), f.context)).toMatchObject({ status: 426 });
    expect(await gameWriter(f.request({ privateUpload: {} }, 26002), f.context)).toMatchObject({ status: 426 });
    if (role === 'owner') {
      const kp = createScoringHandler(() => ownerApi, 'round-kp');
      expect(await kp(f.request({ privateUpload: {} }, 26003), f.context)).toMatchObject({ status: 426 });
      expect(await kp(f.request({ version: 1, context: 'fictional-kp-context', status: 'open', decisions: [] }, 26003), f.context))
        .toMatchObject({ status: 426 });
    }
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.rows).toEqual(rows);
    const saved = await writer(f.request({ score }, 26001, {}, '?categorySweeps=1&format=lean'), f.context);
    expect(saved.status).toBe(200);
    expect(await writer(f.request({ score }, 26001, {}, '?categorySweeps=1&format=lean'), f.context)).toEqual(saved);
    if (!isRecord(saved.jsonBody)) throw new Error('Missing fictional response');
    const round = decodeRoundScores(saved.jsonBody.round);
    expect(round?.dotsCategorySweepsVersion).toBe(1);
    expect(round?.games?.results[0]?.dots?.awards.map((award) => [award.kind, award.dots]))
      .toEqual([['blue-plate', 1], ['long-drive', 1], ['category-sweep', 1]]);
    const originalReceipt = { ...f.row(`score-change:${identifier(26001)}`) };
    const originalCapture = { ...f.row(`index-capture:${f.roundId}`) };
    const originalCard = { ...f.row(`score-card:${f.roundId}:${f.playerId}`) };
    for (const format of ['', '&format=lean']) {
      expect(await reader(get(`legacy=1${format}`), f.context)).toMatchObject({ status: 426 });
      const current = await reader(get(`categorySweeps=1${format}`), f.context);
      expect(current.status).toBe(200);
      expect(decodeRoundScores(current.jsonBody)?.games?.results[0]?.players[0]?.totalPoints).toBe(3);
      const hash = createHash('sha256').update(JSON.stringify(current.jsonBody)).digest('hex');
      const page = await reader(get(`categorySweeps=1${format}&privatePart=0&privateHash=${hash}`), f.context);
      expect(page).toMatchObject({ status: 200, jsonBody: { privateRead: { sha256: hash, index: 0 } } });
    }
    const history = createScoringHandler(() => ownerApi, 'score-history');
    const historyRequest = (query: string) => new HttpRequest({ method: 'GET',
      url: `https://fictional.example.test/api/fixture?${query}`,
      params: { id: event.id, roundId: f.roundId, playerId: f.playerId } });
    expect(await history(historyRequest(''), f.context)).toMatchObject({ status: 426 });
    const currentHistory = await history(historyRequest('categorySweeps=1'), f.context);
    expect(currentHistory.status).toBe(200);
    expect(isScoreHistoryPage(currentHistory.jsonBody)).toBe(true);
    if (!isScoreHistoryPage(currentHistory.jsonBody)) throw new Error('Missing fictional history');
    expect(currentHistory.jsonBody.changes.flatMap((change) => change.dotAwardAudit ?? []))
      .toContainEqual(expect.objectContaining({ dotsCategorySweepsVersion: 1 }));
    expect(f.row(`score-change:${identifier(26001)}`)).toEqual(originalReceipt);
    expect(f.row(`index-capture:${f.roundId}`)).toEqual(originalCapture);
    expect(f.row(`score-card:${f.roundId}:${f.playerId}`)).toEqual(originalCard);
    if (role === 'owner') {
      const purse = createPurseHandler(() => ({ verify: ownerApi.verify, limiter: f.api.limiter, purse: f.purse }));
      const beforeMoney = new Map(f.rows);
      f.submit.mockClear();
      const plan = { eventId: event.id, currency: 'USD', funding: { kind: 'fixed', budgetMinor: 100 },
        pools: [{ id: identifier(26010), name: 'Fictional sweep pot', source: { kind: 'manual' },
          awardUnit: 'pot', amountMinor: 100, recipientIds: [f.playerId] }] };
      expect(await purse(f.request({ plan, resolutions: [] }, 26011), f.context))
        .toMatchObject({ status: 426, jsonBody: { code: 'CATEGORY_SWEEPS_CLIENT_UPDATE_REQUIRED' } });
      expect(await purse(f.request({ privateUpload: {} }, 26011), f.context)).toMatchObject({ status: 426 });
      expect(f.rows).toEqual(beforeMoney);
      expect(f.submit).not.toHaveBeenCalled();
      expect(await purse(f.request({ plan, resolutions: [] }, 26011, {}, '?categorySweeps=1'), f.context))
        .toMatchObject({ status: 200 });
    }
  });
  it.each(['owner', 'public'] as const)('negotiates corrected String for %s before mutations, preserves retry identity and pages the projected leaf once', async (role) => {
    const f = await fixture();
    const game: DotsGameDefinition = { ...f.game, specials: [{ kind: 'string', units: 1 }, { kind: 'birdy-string', units: 2 }] };
    await f.scores.saveGames(f.actor, event.id, f.roundId, [game], null, identifier(25000));
    const ownerApi = { verify: vi.fn().mockResolvedValue(creator), limiter: f.api.limiter, scores: f.scores };
    const writer = role === 'owner' ? createScoringHandler(() => ownerApi, 'score-hole')
      : createPublicHandler(() => f.api, 'score-hole');
    const staged = role === 'owner' ? createScoringHandler(() => ownerApi, 'score-game-hole')
      : createPublicHandler(() => f.api, 'score-game-hole');
    const reader = role === 'owner' ? createScoringHandler(() => ownerApi, 'scores')
      : createPublicHandler(() => f.api, 'scores');
    const request = (query = '') => new HttpRequest({ method: 'GET', url: `https://fictional.example.test/api/fixture${query}`,
      params: { id: event.id, roundId: f.roundId } });
    const untouched = await reader(request(), f.context);
    expect(untouched.status).toBe(200);
    expect(untouched.jsonBody).not.toHaveProperty('stringRulesVersion');
    expect(decodeRoundScores(untouched.jsonBody)).not.toBeNull();
    const rows = new Map(f.rows);
    f.submit.mockClear();
    expect(await writer(f.request({ score: { kind: 'strokes', strokes: 3 } }, 25001), f.context))
      .toMatchObject({ status: 426, jsonBody: { code: 'STRING_RULES_CLIENT_UPDATE_REQUIRED' } });
    for (const query of ['stringRules=3', 'stringRules=2&stringRules=1']) {
      expect(await writer(f.request({ score: { kind: 'strokes', strokes: 3 } }, 25001, {}, `?${query}`), f.context))
        .toMatchObject({ status: 426 });
    }
    expect(await staged(f.request({ privateUpload: {} }, 25001), f.context))
      .toMatchObject({ status: 426 });
    const gameWriter = role === 'owner' ? createScoringHandler(() => ownerApi, 'round-games')
      : createPublicHandler(() => f.api, 'games');
    expect(await gameWriter(f.request({ privateUpload: {} }, 25010), f.context))
      .toMatchObject({ status: 426 });
    if (role === 'owner') {
      const kp = createScoringHandler(() => ownerApi, 'round-kp');
      expect(await kp(f.request({ privateUpload: {} }, 25011), f.context)).toMatchObject({ status: 426 });
      expect(await kp(f.request({ version: 1, context: 'fictional-kp-context', status: 'open', decisions: [] }, 25011), f.context))
        .toMatchObject({ status: 426 });
    }
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.rows).toEqual(rows);
    const modern = await writer(f.request({ score: { kind: 'strokes', strokes: 3 } }, 25001, {}, '?stringRules=2&format=lean'), f.context);
    expect(modern.status).toBe(200);
    expect(await writer(f.request({ score: { kind: 'strokes', strokes: 3 } }, 25001, {}, '?stringRules=2&format=lean'), f.context)).toEqual(modern);
    const originalReceipt = { ...f.row(`score-change:${identifier(25001)}`) };
    const originalCapture = { ...f.row(`index-capture:${f.roundId}`) };
    let round = await f.scores.get(f.actor, event.id, f.roundId);
    for (const hole of [2, 3]) {
      round = (await f.scores.write(f.actor, event.id, f.roundId, f.playerId, hole, { kind: 'strokes', strokes: 4 },
        round.cards.find((card) => card.playerId === f.playerId)?.etag ?? null, identifier(25001 + hole))).round;
    }
    for (const format of ['', '&format=lean']) {
      expect(await reader(request(`?legacy=1${format}`), f.context))
        .toMatchObject({ status: 426, jsonBody: { code: 'STRING_RULES_CLIENT_UPDATE_REQUIRED' } });
      const current = await reader(request(`?stringRules=2${format}`), f.context);
      expect(current.status).toBe(200);
      expect(decodeRoundScores(current.jsonBody)?.games?.results[0]?.players[0]?.totalPoints).toBe(1);
      expect(decodeRoundScores(current.jsonBody)?.stringRulesVersion).toBe(2);
      const digest = createHash('sha256').update(JSON.stringify(current.jsonBody)).digest('hex');
      const page = await reader(request(`?stringRules=2${format}&privatePart=0&privateHash=${digest}`), f.context);
      expect(page.status).toBe(200);
      expect(page.jsonBody).toMatchObject({ privateRead: { sha256: digest, index: 0 } });
    }
    const history = createScoringHandler(() => ownerApi, 'score-history');
    const historyRequest = (query: string) => new HttpRequest({ method: 'GET',
      url: `https://fictional.example.test/api/fixture?${query}`,
      params: { id: event.id, roundId: f.roundId, playerId: f.playerId } });
    expect(await history(historyRequest(''), f.context)).toMatchObject({ status: 426 });
    const currentHistory = await history(historyRequest('stringRules=2'), f.context);
    expect(currentHistory.status).toBe(200);
    expect(isScoreHistoryPage(currentHistory.jsonBody)).toBe(true);
    if (!isScoreHistoryPage(currentHistory.jsonBody)) throw new Error('Missing fictional history');
    expect(currentHistory.jsonBody.changes.flatMap((change) => change.dotAwardAudit ?? []))
      .toContainEqual(expect.objectContaining({ stringRulesVersion: 2 }));
    expect(f.row(`score-change:${identifier(25001)}`)).toEqual(originalReceipt);
    expect(f.row(`index-capture:${f.roundId}`)).toEqual(originalCapture);
  });
  it.each(['owner', 'public'] as const)('accepts Churchie v3 canonical declarations on the dedicated %s route without raising ordinary limits', async (role) => {
    const f = await fixture();
    const game: ChurchyGameDefinitionV3 = { id: f.game.id, name: 'Churchie', kind: 'churchy', version: 3,
      basis: 'net', currency: 'USD', amountPerDotMinor: 50, groupNumber: 1, playerIds: f.game.playerIds,
      orderMode: 'approach', specials: [{ kind: 'dime', units: 1 }, { kind: 'murphy', units: 2 }] };
    const configured = await f.scores.saveGames(f.actor, event.id, f.roundId, [game], null, identifier(24500));
    const score = { kind: 'strokes', strokes: 4, churchy: { version: 3, number: 1, gameId: game.id,
      gameEtag: configured.round.games?.configuration.etag ?? '', rotation: { playerIds: game.playerIds },
      contests: [], players: [{ playerId: f.playerId, counts: { dime: 1 },
        calls: Array.from({ length: 60 }, (_, index) => ({ id: identifier(24510 + index), kind: 'murphy', result: 'pending', murphyPresses: 2 })) }],
    } };
    const ownerApi = { verify: vi.fn().mockResolvedValue(creator), limiter: f.api.limiter, scores: f.scores };
    const ordinary = role === 'owner' ? createScoringHandler(() => ownerApi, 'score-hole')
      : createPublicHandler(() => f.api, 'score-hole');
    const dedicated = role === 'owner' ? createScoringHandler(() => ownerApi, 'score-game-hole')
      : createPublicHandler(() => f.api, 'score-game-hole');
    expect(await ordinary(f.request({ score }, 24501), f.context)).toMatchObject({ status: 413 });
    const saved = await dedicated(f.request({ score }, 24502, {}, '?format=lean'), f.context);
    expect(saved.status).toBe(200);
    if (!isRecord(saved.jsonBody)) throw new Error('Missing fictional Churchie response');
    expect(saved.jsonBody.change).not.toHaveProperty('dotAwardAudit');
    const round = decodeRoundScores(saved.jsonBody.round);
    expect(round?.games?.results[0]?.churchy?.order?.playerIds).toEqual(game.playerIds);
    expect(round?.games?.results[0]?.churchy?.awards?.[0]).toMatchObject({ kind: 'dime' });
    expect(isScoreWriteResult({ ...saved.jsonBody, round })).toBe(true);
    expect(await dedicated(f.request({ score }, 24502, {}, '?format=lean'), f.context)).toEqual(saved);
  });

  it.each(['owner', 'public'] as const)('returns lean %s game/score receipts and reads, retaining protected history, legacy replies and retries', async (role) => {
    const f = await fixture();
    const ownerApi = { verify: vi.fn().mockResolvedValue(creator), limiter: f.api.limiter, scores: f.scores };
    const setupRequest = f.request({ games: [f.game] }, 21700, {}, '?format=lean');
    const setup = role === 'owner'
      ? await createScoringHandler(() => ownerApi, 'round-games')(setupRequest, f.context)
      : await createPublicHandler(() => f.api, 'games')(setupRequest, f.context);
    expect(setup.status).toBe(200);
    if (!isRecord(setup.jsonBody)) throw new Error('Missing fictional setup response');
    const round = decodeRoundScores(setup.jsonBody.round);
    expect(round?.games?.configuration.games).toEqual([f.game]);
    const score = { kind: 'strokes', strokes: 4, dots: [{ number: 1, gameId: f.game.id,
      gameEtag: round?.games?.configuration.etag ?? '', players: [{
        playerId: f.playerId, counts: {}, calls: [{ id: identifier(21701), kind: 'murphy', result: 'success' }],
      }], contests: [] }] };
    const handler = role === 'owner' ? createScoringHandler(() => ownerApi, 'score-game-hole')
      : createPublicHandler(() => f.api, 'score-game-hole');
    const request = f.request({ score }, 21702, {}, '?format=lean');
    const saved = await handler(request, f.context);
    expect(saved).toMatchObject({ status: 200, headers: { 'Cache-Control': 'no-store' },
      jsonBody: { round: { kind: 'round-scores-lean', version: 1 }, change: { after: score } } });
    expect(JSON.stringify(saved.jsonBody)).not.toMatch(/"awards"|"dotAwardAudit"/);
    if (!isRecord(saved.jsonBody)) throw new Error('Missing fictional score response');
    const expanded = decodeRoundScores(saved.jsonBody.round);
    expect(expanded?.games?.results[0]?.dots?.awards).toHaveLength(1);
    expect(isScoreWriteResult({ ...saved.jsonBody, round: expanded })).toBe(true);
    expect(await handler(f.request({ score }, 21702, {}, '?format=lean'), f.context)).toEqual(saved);
    const legacy = await handler(f.request({ score }, 21702), f.context);
    expect(isScoreWriteResult(legacy.jsonBody)).toBe(true);
    expect(JSON.stringify(legacy.jsonBody)).toContain('"awards"');
    const history = await f.scores.history(creator, event.id, f.roundId, f.playerId);
    expect(history.changes[0]?.dotAwardAudit?.[0]?.after).toHaveLength(1);
    const readRequest = new HttpRequest({ method: 'GET', url: 'https://fictional.example.test/api/scores?format=lean',
      params: { id: event.id, roundId: f.roundId } });
    const read = role === 'owner'
      ? await createScoringHandler(() => ownerApi, 'scores')(readRequest, f.context)
      : await createPublicHandler(() => f.api, 'scores')(readRequest, f.context);
    expect(read.status).toBe(200);
    expect(decodeRoundScores(read.jsonBody)).toEqual(expanded);
    expect(JSON.stringify(read.jsonBody)).not.toMatch(/"awards"|"dotAwardAudit"/);
    expect(f.api.limiter.check).toHaveBeenLastCalledWith(role === 'owner' ? creator : f.actor, 'scores-read');
    f.seed({ ...f.row('event'), status: 'archived' });
    if (role === 'public') expect(await createPublicHandler(() => f.api, 'scores')(readRequest, f.context))
      .toMatchObject({ status: 404 });
  });

  it('accepts version-2 rotation with an order-only score and rejects forged receipts on the dedicated route', async () => {
    const f = await fixture();
    const game: DotsGameDefinition = { id: f.game.id, name: f.game.name, kind: 'dots', version: 2,
      groupNumber: 1, playerIds: f.game.playerIds, mode: 'rotating', rotationHoles: 6,
      stakeMinor: null, specials: f.game.specials };
    expect(await f.call('games', { games: [game] }, 21600)).toMatchObject({ status: 200 });
    const round = await f.scores.get(f.actor, event.id, f.roundId);
    const record = { number: 1, gameId: game.id, gameEtag: round.games?.configuration.etag ?? '',
      players: [], contests: [], rotation: { playerIds: game.playerIds } };
    expect(await f.call('score-game-hole', { score: { kind: 'unplayed', dots: [{
      ...record, rotation: { playerIds: [game.playerIds[0], game.playerIds[0], ...game.playerIds.slice(2)] },
    }] } }, 21601)).toMatchObject({ status: 400 });
    const score = { kind: 'unplayed', dots: [record] };
    const saved = await f.call('score-game-hole', { score }, 21602);
    expect(saved).toMatchObject({ status: 200, jsonBody: {
      round: { dotsRulesVersions: [1, 2], setupLocked: true }, change: { after: score },
    } });
    expect(isScoreWriteResult(saved.jsonBody)).toBe(true);
    expect(JSON.stringify(saved.jsonBody)).not.toContain('dotAwardAudit');
    expect(await f.call('score-game-hole', { score }, 21602)).toEqual(saved);
  });

  it('charges existing site/event budgets for ordinary internal setup and accepts Dots on the dedicated score route', async () => {
    const f = await fixture();
    const setup = await f.call('games', { games: [f.game] }, 21100);
    expect(setup.status).toBe(200);
    expect(f.api.limiter.check.mock.calls).toEqual([
      [{ kind: 'public-browse' }, 'setup-write'], [f.actor, 'scores-write'],
    ]);
    const round = await f.scores.get(f.actor, event.id, f.roundId);
    const score = { kind: 'strokes', strokes: 4, dots: [{ number: 1, gameId: f.game.id,
      gameEtag: round.games?.configuration.etag ?? '', players: [{
        playerId: f.playerId, counts: {}, calls: [{ id: identifier(21102), kind: 'murphy', result: 'success' }],
      }], contests: [] }] };
    const saved = await f.call('score-game-hole', { score }, 21101);
    expect(saved.status).toBe(200);
    expect(saved.headers).toMatchObject({ 'Cache-Control': 'no-store' });
    expect(isScoreWriteResult(saved.jsonBody)).toBe(true);
    expect(saved.jsonBody).toMatchObject({ change: { after: score, recordedBy: f.actor } });
    expect(JSON.stringify(saved.jsonBody)).not.toContain('dotAwardAudit');
    expect((await f.scores.history(creator, event.id, f.roundId, f.playerId)).changes[0]?.dotAwardAudit).toHaveLength(1);
    expect(await f.call('score-game-hole', { score }, 21101)).toEqual(saved);
  });

  it('retains the ordinary 4KiB ceiling, permits bounded dedicated Dots payloads, and rejects oversized and unknown fields', async () => {
    const f = await fixture();
    await f.scores.saveGames(creator, event.id, f.roundId, [f.game], null, identifier(21200));
    const round = await f.scores.get(f.actor, event.id, f.roundId);
    const body = { score: { kind: 'strokes', strokes: 4, dots: [{ number: 1, gameId: f.game.id,
      gameEtag: round.games?.configuration.etag ?? '', players: [{
        playerId: f.playerId, counts: {}, calls: Array.from({ length: 60 }, (_, index) => ({
          id: identifier(21210 + index), kind: 'murphy', result: 'pending',
        })),
      }], contests: [] }] } };
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(4096);
    expect(await f.call('score-hole', body, 21300)).toMatchObject({ status: 413 });
    expect(await f.call('score-game-hole', ' '.repeat(maximumGameConfigurationBytes) + '{}', 21302))
      .toMatchObject({ status: 413 });
    const malformed = { score: { kind: 'strokes', strokes: 4,
      dots: [{ number: 1, gameId: f.game.id, gameEtag: round.games?.configuration.etag ?? '', players: [],
        contests: [], awards: [{ dots: 999 }] }] } };
    expect(await f.call('score-game-hole', malformed, 21303)).toMatchObject({ status: 400 });
    expect(await f.call('score-game-hole', body, 21301)).toMatchObject({ status: 200 });
  });

  it('accepts the same dedicated Dots namespace for a verified owner and preserves private audit authority', async () => {
    const f = await fixture();
    const setup = await f.scores.saveGames(creator, event.id, f.roundId, [f.game], null, identifier(21400));
    const verify = vi.fn().mockResolvedValue(creator);
    const body = { score: { kind: 'strokes', strokes: 4, dots: [{ number: 1, gameId: f.game.id,
      gameEtag: setup.round.games?.configuration.etag ?? '', players: [{ playerId: f.playerId, counts: {},
        calls: [{ id: identifier(21401), kind: 'murphy', result: 'success' }] }], contests: [] }] } };
    const saved = await createScoringHandler(() => ({ verify, limiter: f.api.limiter, scores: f.scores }), 'score-game-hole')(
      f.request(body, 21402, { authorization: 'Bearer fictional-owner-token' }), f.context);
    expect(saved.status).toBe(200);
    expect(saved.jsonBody).toMatchObject({ change: { dotAwardAudit: [{ gameId: f.game.id }] } });
    expect(verify).toHaveBeenCalledWith('Bearer fictional-owner-token');
    expect(isScoreWriteResult(saved.jsonBody)).toBe(true);
  });

  it('stops internal setup before all writes when a durable site/event budget fails', async () => {
    const f = await fixture();
    const before = new Map(f.rows);
    f.api.limiter.check.mockRejectedValueOnce(new ApiError(429, 'REQUEST_LIMIT_EXCEEDED'));
    expect(await f.call('games', { games: [f.game] }, 21500)).toMatchObject({ status: 429 });
    expect(f.rows).toEqual(before);
    f.api.limiter.check.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError(429, 'REQUEST_LIMIT_EXCEEDED'));
    expect(await f.call('games', { games: [f.game] }, 21501)).toMatchObject({ status: 429 });
    expect(f.rows).toEqual(before);
  });
});
