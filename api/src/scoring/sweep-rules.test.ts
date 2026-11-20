import { HttpRequest, InvocationContext } from '@azure/functions';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { DotsGameDefinition } from '../../../src/domain/dots.js';
import type { WolfGameDefinition } from '../../../src/domain/wolf.js';
import { decodeRoundScores, isScoreHistoryPage } from '../../../src/contracts/scoring.js';
import { isRecord } from '../../../src/contracts/events.js';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { publicFixture } from '../public-access/test-support.js';
import { testerFixture } from '../test-access/test-support.js';
import { createPublicHandler } from '../public-access/handlers.js';
import { createPurseHandler } from '../purse/handlers.js';
import { createScoringHandler } from './handlers.js';

async function fixture() {
  const f = await publicFixture();
  const game: DotsGameDefinition = { id: identifier(29000), name: 'Fictional Sweep', kind: 'dots', version: 1,
    groupNumber: 1, playerIds: f.input.playerIds.slice(0, 4), mode: 'individual', stakeMinor: 50,
    specials: [{ kind: 'other', units: 1 }] };
  const initial = await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(29001));
  const manual: DotsGameDefinition = { ...game, sweepRule: 'manual-v1', specials: [{ kind: 'sweep', units: 2 }] };
  const limiter = { check: vi.fn().mockResolvedValue(undefined) };
  const ownerApi = { verify: vi.fn().mockResolvedValue(creator), limiter, scores: f.scores };
  const publicApi = { publicEvents: f.publicEvents, workspace: f.workspace, scores: f.scores, purse: f.purse, limiter };
  const context = new InvocationContext({ invocationId: 'fictional-sweep-rules', logHandler: () => undefined });
  const request = (method: 'GET' | 'PUT', body?: unknown, query = '', etag: string | null = null, operation = 29002) => new HttpRequest({
    method, url: `https://fictional.example.test/api/fixture?${query}`,
    params: { id: event.id, roundId: f.roundId, playerId: f.playerId, holeNumber: '1' },
    ...(method === 'PUT' ? { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': identifier(operation),
      ...(etag === null ? { 'If-None-Match': '*' } : { 'If-Match': etag }) }, body: { string: JSON.stringify(body) } } : {}),
  });
  return { ...f, game, manual, initial, ownerApi, publicApi, context, request };
}

describe('independent Sweep HTTP guards and immutable retries', () => {
  it('keeps tester projections and legacy raw-only saves independent of private manual Sweep declarations', async () => {
    const f = await testerFixture();
    const game: DotsGameDefinition = { id: identifier(29080), name: 'Fictional private Sweep', kind: 'dots', version: 1,
      groupNumber: 1, playerIds: f.input.playerIds.slice(0, 4), mode: 'individual', stakeMinor: 50,
      sweepRule: 'manual-v1', specials: [{ kind: 'sweep', units: 1 }] };
    const configured = await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(29081));
    const declaration = { number: 1, gameId: game.id, gameEtag: configured.round.games?.configuration.etag ?? '',
      contests: [], players: [{ playerId: f.playerId, counts: { sweep: 1 }, calls: [] }] };
    const saved = await f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, dots: [declaration] }, null, identifier(29082));
    const tester = await f.scores.get(f.actor, event.id, f.roundId);
    expect(tester.dotsManualSweep).toBeUndefined();
    expect(tester.wolfHighLowSweep).toBeUndefined();
    expect(tester.sweepRulesVersion).toBeUndefined();
    expect(tester.games?.configuration.games).toEqual([]);
    expect(tester.cards.find((card) => card.playerId === f.playerId)?.holes[0]?.score.dots).toBeUndefined();
    const etag = saved.round.cards.find((card) => card.playerId === f.playerId)?.etag ?? null;
    const raw = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 5 }, etag, identifier(29083), undefined, true, true, true, true, false);
    expect(raw.change.after.dots).toBeUndefined();
    expect(raw.change.dotAwardAudit).toBeUndefined();
    const owner = await f.scores.get(creator, event.id, f.roundId);
    expect(owner.cards.find((card) => card.playerId === f.playerId)?.holes[0]?.score.dots).toEqual([declaration]);
  });

  it('rejects duplicate automatic configuration before writes, permits linked manual Sweep and audits exact Wolf bonus money', async () => {
    const f = await fixture();
    const wolf: WolfGameDefinition = { id: identifier(29050), name: 'Fictional High/Low', kind: 'wolf', version: 2,
      basis: 'gross', groupNumber: 1, playerIds: f.game.playerIds, allowPig: true, stakeMinor: 50, highLowSweep: true };
    const legacy: DotsGameDefinition = { id: f.game.id, name: f.game.name, kind: 'dots', version: 1,
      groupNumber: 1, playerIds: f.game.playerIds, mode: 'linked', linkedGameId: wolf.id,
      specials: [{ kind: 'sweep', units: 2 }] };
    const rows = new Map(f.rows);
    await expect(f.scores.saveGames(creator, event.id, f.roundId, [wolf, legacy],
      f.initial.round.games?.configuration.etag ?? null, identifier(29051))).rejects.toMatchObject({ code: 'INCOMPATIBLE_SWEEP_RULES' });
    expect(f.rows).toEqual(rows);
    const manual = { ...legacy, sweepRule: 'manual-v1' as const };
    const configured = await f.scores.saveGames(creator, event.id, f.roundId, [wolf, manual],
      f.initial.round.games?.configuration.etag ?? null, identifier(29052));
    let latest = configured.round;
    for (const [index, playerId] of wolf.playerIds.entries()) {
      const score = { kind: 'strokes' as const, strokes: index + 3, ...(index === 0 ? {
        wolf: [{ number: 1, choice: { gameId: wolf.id, gameEtag: configured.round.games?.configuration.etag ?? '',
          mode: 'partner' as const, partnerId: wolf.playerIds[1] ?? '' } }],
      } : {}) };
      latest = (await f.scores.write(f.actor, event.id, f.roundId, playerId, 1, score, null, identifier(29060 + index))).round;
    }
    expect(latest.games?.results.find((result) => result.gameId === wolf.id)?.players.map((player) => player.totalPoints))
      .toEqual([3, 3, 0, 0]);
    expect(latest.internalSettlements?.[0]?.players.map((player) => player.netMinor)).toEqual([300, 300, -300, -300]);
    expect(decodeRoundScores(latest)).toEqual(latest);
    const last = wolf.playerIds[3];
    if (!last) throw new Error('Missing fictional audit golfer');
    const audits = (await f.scores.history(creator, event.id, f.roundId, last)).changes.flatMap((change) => change.dotAwardAudit ?? []);
    const audit = audits.find((entry) => entry.gameId === wolf.id);
    expect(audit).toMatchObject({ configuration: wolf, sweepRulesVersion: 2 });
    expect(audit?.after).toContainEqual(expect.objectContaining({ kind: 'wolf-sweep', dots: 1, multiplier: 1 }));
  });

  it('fences new game publication and invalid/duplicate negotiation, retaining staged parts for an explicit retry', async () => {
    const f = await fixture(), writer = createScoringHandler(() => f.ownerApi, 'round-games');
    const etag = f.initial.round.games?.configuration.etag ?? null, rows = new Map(f.rows);
    f.submit.mockClear();
    for (const query of ['', 'sweepRules=1', 'sweepRules=2&sweepRules=2']) {
      expect(await writer(f.request('PUT', { games: [f.manual] }, query, etag), f.context))
        .toMatchObject({ status: 426, jsonBody: { code: 'SWEEP_RULES_CLIENT_UPDATE_REQUIRED' } });
    }
    expect(f.rows).toEqual(rows);
    expect(f.submit).not.toHaveBeenCalled();
    const bytes = Buffer.from(JSON.stringify({ games: [f.manual] }));
    const upload = { id: identifier(29020), bytes: bytes.length, parts: 1,
      sha256: createHash('sha256').update(bytes).digest('hex') };
    expect(await writer(f.request('PUT', { privateUpload: { ...upload, index: 0, content: bytes.toString('base64') } },
      '', etag, 29020), f.context)).toMatchObject({ status: 200 });
    const staged = new Map(f.rows);
    expect(await writer(f.request('PUT', { privateCommit: upload }, '', etag, 29020), f.context)).toMatchObject({ status: 426 });
    expect(f.rows).toEqual(staged);
    expect(await writer(f.request('PUT', { privateCommit: upload }, 'sweepRules=2', etag, 29020), f.context))
      .toMatchObject({ status: 200 });
    expect((await f.scores.get(creator, event.id, f.roundId)).games?.configuration.games).toEqual([f.manual]);
  });

  it.each(['owner', 'public'] as const)('guards affected %s reads/writes/staging, preserving exact score/audit retries', async (role) => {
    const f = await fixture();
    const setup = await f.scores.saveGames(creator, event.id, f.roundId, [f.manual],
      f.initial.round.games?.configuration.etag ?? null, identifier(29030));
    const read = role === 'owner' ? createScoringHandler(() => f.ownerApi, 'scores') : createPublicHandler(() => f.publicApi, 'scores');
    const write = role === 'owner' ? createScoringHandler(() => f.ownerApi, 'score-hole') : createPublicHandler(() => f.publicApi, 'score-hole');
    const stage = role === 'owner' ? createScoringHandler(() => f.ownerApi, 'score-game-hole') : createPublicHandler(() => f.publicApi, 'score-game-hole');
    const games = role === 'owner' ? createScoringHandler(() => f.ownerApi, 'round-games') : createPublicHandler(() => f.publicApi, 'games');
    const rows = new Map(f.rows);
    f.submit.mockClear();
    for (const query of ['', 'format=lean', 'privatePart=0&privateHash=fixture']) {
      expect(await read(f.request('GET', undefined, query), f.context)).toMatchObject({ status: 426 });
    }
    for (const query of ['sweepRules=2', 'sweepRules=2&format=lean']) {
      const response = await read(f.request('GET', undefined, query), f.context);
      expect(response.status).toBe(200);
      expect(decodeRoundScores(response.jsonBody)?.games?.configuration.games).toEqual([f.manual]);
    }
    expect(await write(f.request('PUT', { score: { kind: 'strokes', strokes: 4 } }), f.context)).toMatchObject({ status: 426 });
    expect(await stage(f.request('PUT', { privateUpload: {} }), f.context)).toMatchObject({ status: 426 });
    expect(await games(f.request('PUT', { privateUpload: {} }, '', setup.round.games?.configuration.etag ?? null), f.context))
      .toMatchObject({ status: 426 });
    if (role === 'owner') {
      const kp = createScoringHandler(() => f.ownerApi, 'round-kp');
      expect(await kp(f.request('PUT', { privateUpload: {} }), f.context)).toMatchObject({ status: 426 });
      expect(await kp(f.request('PUT', { version: 1, context: 'fixture', status: 'open', decisions: [] }), f.context))
        .toMatchObject({ status: 426 });
      const purse = createPurseHandler(() => ({ verify: f.ownerApi.verify, limiter: f.ownerApi.limiter, purse: f.purse }));
      expect(await purse(f.request('PUT', { privateUpload: {} }), f.context)).toMatchObject({ status: 426 });
      const plan = { eventId: event.id, currency: 'USD', funding: { kind: 'fixed', budgetMinor: 100 },
        pools: [{ id: identifier(29040), name: 'Fictional manual pot', source: { kind: 'manual' },
          awardUnit: 'pot', amountMinor: 100, recipientIds: [f.playerId] }] };
      expect(await purse(f.request('PUT', { plan, resolutions: [] }), f.context)).toMatchObject({ status: 426 });
    }
    expect(f.rows).toEqual(rows);
    expect(f.submit).not.toHaveBeenCalled();
    const score = { kind: 'strokes', strokes: 5, dots: [{ number: 1, gameId: f.manual.id,
      gameEtag: setup.round.games?.configuration.etag, contests: [],
      players: [{ playerId: f.playerId, counts: { sweep: 2 }, calls: [] }] }] };
    const saved = await write(f.request('PUT', { score }, 'sweepRules=2&format=lean', null, 29032), f.context);
    expect(saved.status).toBe(200);
    expect(await write(f.request('PUT', { score }, 'sweepRules=2&format=lean', null, 29032), f.context)).toEqual(saved);
    const history = createScoringHandler(() => f.ownerApi, 'score-history');
    expect(await history(f.request('GET'), f.context)).toMatchObject({ status: 426 });
    const modern = await history(f.request('GET', undefined, 'sweepRules=2'), f.context);
    expect(modern.status).toBe(200);
    if (!isScoreHistoryPage(modern.jsonBody)) throw new Error('Missing fictional Sweep history');
    expect(modern.jsonBody.changes.flatMap((change) => change.dotAwardAudit ?? []))
      .toContainEqual(expect.objectContaining({ configuration: f.manual, sweepRulesVersion: 2,
        after: [expect.objectContaining({ kind: 'sweep', count: 2, dots: 4, source: 'manual' })] }));
    const immutable = { ...f.row(`score-change:${identifier(29032)}`) };
    expect(await write(f.request('PUT', { score }), f.context)).toMatchObject({ status: 426 });
    expect(f.row(`score-change:${identifier(29032)}`)).toEqual(immutable);
    expect(await games(f.request('PUT', { games: [f.game] }, 'sweepRules=2',
      setup.round.games?.configuration.etag ?? null, 29033), f.context)).toMatchObject({ status: 409 });
    if (!isRecord(saved.jsonBody)) throw new Error('Missing fictional score acknowledgement');
    expect(decodeRoundScores(saved.jsonBody.round)?.sweepRulesVersion).toBe(2);
  });
});
