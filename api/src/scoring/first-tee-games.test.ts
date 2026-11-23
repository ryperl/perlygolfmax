import { HttpRequest, InvocationContext } from '@azure/functions';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { decodeRoundScores, isRoundScores } from '../../../src/contracts/scoring.js';
import type { WolfGameDefinition, WolfHoleRecord } from '../../../src/domain/wolf.js';
import type { DotsGameDefinition } from '../../../src/domain/dots.js';
import { publicFixture } from '../public-access/test-support.js';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { createScoringHandler } from './handlers.js';
import { createPublicHandler } from '../public-access/handlers.js';
import { createPurseHandler } from '../purse/handlers.js';
import { privateWritePartBytes } from '../../../src/contracts/private-values.js';
import { createCorrectionsHandler } from '../corrections/handlers.js';
import { isRecord } from '../../../src/contracts/events.js';
import type { RoundScores } from '../../../src/domain/scoring.js';
import { murphyTransport, supportsDotsHighLow, supportsDotsRulesV3 } from './murphy-transport.js';

const base = 'murphy=score-v1&paree=score-v1&stringRules=2&dotsCalls=score-v1&categorySweeps=1&churchyNames=1&sweepRules=2&dotCoexistence=2&gameHandicaps=1&gameCalculations=2';
const current = `${base}&wolfOrders=1&dotsHighLow=1`;

async function fixture() {
  const f = await publicFixture();
  await f.workspace.save(creator, event.id, { ...f.input, rounds: f.input.rounds.map((round) => ({
    ...round, groups: round.groups.map((group) => ({ ...group, startingHole: 5 })),
  })) }, (await f.workspace.get(creator, event.id)).etag);
  const ids = f.input.rounds[0]?.groups[0]?.playerIds ?? [];
  for (const [index, id] of ids.entries()) {
    const player = await f.players.get(creator, id);
    await f.players.observe(creator, id, identifier(33000 + index), {
      value: '0', effectiveDate: '2026-01-01', source: 'Fictional first-tee input',
    }, player.etag);
  }
  const limiter = { check: vi.fn().mockResolvedValue(undefined) };
  const api = { verify: vi.fn().mockResolvedValue(creator), scores: f.scores, limiter };
  const publicApi = { ...api, publicEvents: f.publicEvents, workspace: f.workspace, purse: f.purse };
  const context = new InvocationContext({ invocationId: 'fictional-first-tee', logHandler: () => undefined });
  let sequence = 33100;
  const request = (method: 'GET' | 'PUT', body?: unknown, query = current, etag: string | null = null,
    playerId = ids[0] ?? '', hole = 5, operation = identifier(sequence++)) => new HttpRequest({
    method, url: `https://fictional.example.test/api/fixture?${query}`,
    params: { id: event.id, roundId: f.roundId, playerId, holeNumber: String(hole) },
    ...(method === 'PUT' ? { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operation,
      ...(etag === null ? { 'If-None-Match': '*' } : { 'If-Match': etag }) }, body: { string: JSON.stringify(body) } } : {}),
  });

  const wolf: WolfGameDefinition = { id: identifier(33200), name: 'Fictional first-tee Wolf', kind: 'wolf', version: 2,
    basis: 'gross', stakeMinor: null, groupNumber: 1, playerIds: ids, allowPig: true, orderMode: 'first-tee-v1' };
  const dots: DotsGameDefinition = { id: identifier(33201), name: 'Fictional Net Modified Sixes', kind: 'dots', version: 2,
    groupNumber: 1, playerIds: ids, mode: 'rotating', rotationHoles: 3, stakeMinor: 100,
    highLow: { version: 1, handicapRule: 'full-course-v1' }, specials: [] };
  return { ...f, ids, api, publicApi, context, request, wolf, dots };
}

const v3Query = `${base}&wolfOrders=1&dotsHighLow=2&dotsRules=3`;

  async function v3Fixture(orderMode: 'tee-flip' | 'approach' = 'tee-flip', rotationHoles: 3 | 6 = 3) {
    const f = await fixture();
    const dots: DotsGameDefinition = { ...f.dots, version: 3, orderMode, rotationHoles,
      highLow: { version: 2, handicapRule: 'full-course-v1' } };
    const configured = await f.scores.saveGames(creator, event.id, f.roundId, [dots], null, identifier(34000));
    const gameEtag = configured.round.games?.configuration.etag ?? '';
    const declaration = (number = 5, playerIds = f.ids) => ({
      number, gameId: dots.id, gameEtag, rotation: { playerIds }, players: [], contests: [],
    });
    const etag = (round: RoundScores, playerId = f.ids[0]) =>
      round.cards.find((card) => card.playerId === playerId)?.etag ?? null;
    return { ...f, dots, configured, declaration, etag };
  }

  function acknowledgedRound(value: unknown): RoundScores {
    if (!isRecord(value)) throw new Error('Missing fictional acknowledgement');
    const round = decodeRoundScores(value.round);
    if (!round) throw new Error('Invalid fictional round acknowledgement');
    return round;
  }

  describe('rotating Dots v3 negotiated transactions', () => {
    it('requires the complete composite marker and rejects malformed or duplicate versions', () => {
      const request = (query: string) => new HttpRequest({ method: 'GET', url: `https://fictional.example.test/?${query}` });
      for (const query of ['', 'dotsRules=3', 'dotsHighLow=2', 'dotsRules=3&dotsHighLow=1']) {
        expect(supportsDotsRulesV3(request(query))).toBe(false);
      }
      expect(supportsDotsRulesV3(request('dotsRules=3&dotsHighLow=2'))).toBe(true);
      for (const version of ['1', '2']) expect(supportsDotsHighLow(request(`dotsHighLow=${version}`))).toBe(true);
      for (const query of ['dotsRules=2', 'dotsRules=', 'dotsRules=3&dotsRules=3',
        'dotsRules=3&dotsRules=4', 'dotsHighLow=3', 'dotsHighLow=2&dotsHighLow=2']) {
        expect(() => supportsDotsRulesV3(request(query))).toThrowError();
      }
    });

    it('fences partial/old full and lean reads and all affected public/private writes without rows, receipts or grants changing', async () => {
      const f = await v3Fixture();
      const get = createScoringHandler(() => f.api, 'scores');
      const publicGet = createPublicHandler(() => f.publicApi, 'scores');
      const write = createScoringHandler(() => f.api, 'score-hole');
      const publicWrite = createPublicHandler(() => f.publicApi, 'score-hole');
      const games = createScoringHandler(() => f.api, 'round-games');
      const kp = createScoringHandler(() => f.api, 'round-kp');
      const staged = createPublicHandler(() => f.publicApi, 'score-game-hole');
      const purse = createPurseHandler(() => ({ ...f.api, purse: f.purse }));
      const rows = new Map(f.rows);
      f.submit.mockClear();
      for (const query of [current, `${base}&wolfOrders=1&dotsRules=3`, `${base}&wolfOrders=1&dotsHighLow=2`]) {
        for (const format of ['', '&format=lean']) {
          for (const handler of [get, publicGet]) expect(await handler(f.request('GET', undefined, query + format), f.context))
            .toMatchObject({ status: 426, jsonBody: { code: 'DOTS_RULES_V3_CLIENT_UPDATE_REQUIRED' } });
        }
        for (const handler of [write, publicWrite]) expect(await handler(f.request('PUT', { score: { kind: 'strokes', strokes: 4 } }, query), f.context))
          .toMatchObject({ status: 426 });
        expect(await games(f.request('PUT', { games: [f.dots] }, query, f.configured.round.games?.configuration.etag ?? null), f.context))
          .toMatchObject({ status: 426 });
        expect(await kp(f.request('PUT', { privateCommit: {} }, query), f.context)).toMatchObject({ status: 426 });
        expect(await staged(f.request('PUT', { privateUpload: {} }, query), f.context)).toMatchObject({ status: 426 });
        expect(await purse(f.request('PUT', { plan: {}, resolutions: [] }, query), f.context)).toMatchObject({ status: 426 });
      }
      expect(f.rows).toEqual(rows);
      expect(f.submit).not.toHaveBeenCalled();
      for (const query of [`${v3Query}&dotsRules=3`, `${v3Query}&dotsHighLow=2`,
        `${base}&wolfOrders=1&dotsHighLow=2&dotsRules=4`]) {
        expect(await write(f.request('PUT', { score: { kind: 'strokes', strokes: 4 } }, query), f.context))
          .toMatchObject({ status: 426 });
      }
      expect(f.rows).toEqual(rows);
      expect(f.submit).not.toHaveBeenCalled();
      for (const handler of [get, publicGet]) for (const format of ['', '&format=lean']) {
        const result = await handler(f.request('GET', undefined, v3Query + format), f.context);
        expect(result.status).toBe(200);
        expect(decodeRoundScores(result.jsonBody)).toMatchObject({ dotsRulesVersions: [1, 2, 3], dotsHighLowVersion: 2 });
      }
    });

    it('projects legacy metadata before older helpers and preserves unchanged legacy definitions', async () => {
      const f = await fixture();
      const configured = await f.scores.saveGames(creator, event.id, f.roundId, [f.dots], null, identifier(34001));
      const get = createScoringHandler(() => f.api, 'scores');
      for (const query of [current, v3Query]) for (const format of ['', '&format=lean']) {
        const result = await get(f.request('GET', undefined, query + format), f.context);
        expect(result.status).toBe(200);
        const round = decodeRoundScores(result.jsonBody);
        expect(round?.dotsRulesVersions).toEqual(query === current ? [1, 2] : [1, 2, 3]);
        expect(round?.dotsHighLowVersion).toBe(query === current ? 1 : 2);
        expect(round?.games?.configuration.games).toEqual([f.dots]);
      }
      const wrapper = murphyTransport({ nested: [configured.round] }, true, true, true, true, true, true, true, true, true, true, true, true);
      expect(wrapper).toMatchObject({ nested: [{ dotsRulesVersions: [1, 2], dotsHighLowVersion: 1 }] });
    });

    it.each([
      ['tee-flip', 3], ['tee-flip', 6], ['approach', 3], ['approach', 6],
    ] as const)('saves %s order in %i-hole blocks, immutable staged retries and once-only High/Low/Sweep settlement', async (mode, length) => {
      const f = await v3Fixture(mode, length);
      const anchor = f.ids[0] ?? '';
      const order = { ...f.declaration(), rotation: { playerIds: f.ids, recordedLate: true } };
      const body = { score: { kind: 'unplayed', dots: [order] } };
      const bytes = Buffer.from(JSON.stringify(body));
      const upload = { id: identifier(34100), bytes: bytes.length, parts: Math.ceil(bytes.length / privateWritePartBytes),
        sha256: createHash('sha256').update(bytes).digest('hex') };
      const save = createPublicHandler(() => f.publicApi, 'score-game-hole');
      const requestId = identifier(34101);
      for (let index = 0; index < upload.parts; index++) {
        expect(await save(f.request('PUT', { privateUpload: { ...upload, index,
          content: bytes.subarray(index * privateWritePartBytes, (index + 1) * privateWritePartBytes).toString('base64') } },
        v3Query, null, anchor, 5, requestId), f.context)).toMatchObject({ status: 200 });
      }
      const rows = new Map(f.rows);
      f.submit.mockClear();
      const commit = { privateCommit: upload };
      expect(await save(f.request('PUT', commit, current, null, anchor, 5, requestId), f.context)).toMatchObject({ status: 426 });
      expect(f.rows).toEqual(rows);
      expect(f.submit).not.toHaveBeenCalled();
      const result = await save(f.request('PUT', commit, v3Query, null, anchor, 5, requestId), f.context);
      expect(result.status).toBe(200);
      let round = acknowledgedRound(result.jsonBody);
      expect(round.cards.find((card) => card.playerId === anchor)?.holes.find((hole) => hole.number === 5)?.score.dots?.[0]?.rotation)
        .toEqual({ playerIds: f.ids });
      const persisted = new Map(f.rows);
      expect(await save(f.request('PUT', commit, v3Query, null, anchor, 5, requestId), f.context)).toMatchObject({ status: 200 });
      expect(f.rows).toEqual(persisted);
      const winners = mode === 'tee-flip' ? f.ids.slice(0, 2) : [f.ids[0], f.ids[3]];
      for (const [index, playerId] of f.ids.entries()) {
        round = (await f.scores.write(creator, event.id, f.roundId, playerId, 5,
          { kind: 'strokes', strokes: winners.includes(playerId) ? 3 : 5 }, f.etag(round, playerId), identifier(34110 + index))).round;
      }
      const highLow = round.games?.results[0]?.dotsHighLow;
      expect(highLow?.awards.map((award) => award.kind)).toEqual(['high', 'low', 'high-low-sweep']);
      for (const award of highLow?.awards ?? []) expect(award.recipientIds).toEqual(winners);
      expect(round.internalSettlements).toHaveLength(1);
      expect(round.internalSettlements?.[0]?.players.map((player) => player.netMinor)).toEqual(
        f.ids.map((id) => winners.includes(id) ? 600 : -600));
      const history = await f.scores.history(creator, event.id, f.roundId, f.ids[3] ?? '');
      expect(history.changes[0]?.dotAwardAudit?.[0]).toMatchObject({ version: 3, configuration: f.dots, after: highLow?.awards });
      const nextHole = 5 + length;
      const nextWinners = [f.ids[0], f.ids[2]];
      for (const [index, playerId] of f.ids.entries()) {
        round = (await f.scores.write(creator, event.id, f.roundId, playerId, nextHole,
          { kind: 'strokes', strokes: nextWinners.includes(playerId) ? 3 : 5 }, f.etag(round, playerId), identifier(34130 + index))).round;
      }
      const nextAwards = round.games?.results[0]?.dotsHighLow?.awards.filter((award) => award.number === nextHole) ?? [];
      expect(nextAwards).toHaveLength(3);
      for (const award of nextAwards) expect(award.recipientIds).toEqual(nextWinners);
      const audits = [...f.rows.values()].filter((row) => row.rowKey?.includes('score-change')).map((row) => row.content);
      const capture = f.rows.get(`${event.id}|index-capture:${f.roundId}`);
      const raw = await f.scores.write(creator, event.id, f.roundId, anchor, 5, { kind: 'strokes', strokes: 4 },
        f.etag(round), identifier(34120));
      const cleared = await f.scores.write(creator, event.id, f.roundId, anchor, 5, { kind: 'unplayed' },
        f.etag(raw.round), identifier(34121));
      expect(cleared.change.after.dots?.[0]?.rotation).toEqual({ playerIds: f.ids });
      expect(f.rows.get(`${event.id}|index-capture:${f.roundId}`)).toEqual(capture);
      expect([...f.rows.values()].filter((row) => row.rowKey?.includes('score-change')).slice(0, audits.length).map((row) => row.content)).toEqual(audits);
      await expect(f.scores.saveGames(creator, event.id, f.roundId, [{ ...f.dots, orderMode: mode === 'tee-flip' ? 'approach' as const : 'tee-flip' as const }],
        f.configured.round.games?.configuration.etag ?? null, identifier(34122))).rejects.toMatchObject({ code: 'MATCH_SETUP_LOCKED' });
      await expect(f.scores.write(creator, event.id, f.roundId, anchor, 5, {
        kind: 'unplayed', dots: [f.declaration(5, [...f.ids].reverse())],
      }, f.etag(cleared.round), identifier(34123))).rejects.toMatchObject({ code: 'DOTS_ROTATION_CONFLICT' });
    });

    it('permits explicit unstarted v2 rotating upgrades only, never v1 or receipt-captured upgrades', async () => {
      const f = await fixture();
      const configured = await f.scores.saveGames(creator, event.id, f.roundId, [f.dots], null, identifier(34200));
      const next: DotsGameDefinition = { ...f.dots, version: 3, orderMode: 'tee-flip', highLow: { version: 2, handicapRule: 'full-course-v1' } };
      const handler = createPublicHandler(() => f.publicApi, 'games');
      expect(await handler(f.request('PUT', { games: [next] }, v3Query, configured.round.games?.configuration.etag ?? null,
        f.ids[0], 5, identifier(34201)), f.context)).toMatchObject({ status: 200 });
      const g = await fixture();
      const legacy: DotsGameDefinition = { id: g.dots.id, name: 'Fictional legacy Dots', kind: 'dots', version: 1,
        mode: 'individual', groupNumber: 1, playerIds: g.ids, stakeMinor: 100, specials: [] };
      const before = await g.scores.saveGames(creator, event.id, g.roundId, [legacy], null, identifier(34210));
      await expect(g.scores.saveGames(creator, event.id, g.roundId, [next],
        before.round.games?.configuration.etag ?? null, identifier(34211))).rejects.toMatchObject({ code: 'DOTS_REQUIRES_NEW_GAME' });
      const h = await fixture();
      const saved = await h.scores.saveGames(creator, event.id, h.roundId, [h.dots], null, identifier(34220));
      await h.scores.write(creator, event.id, h.roundId, h.ids[0] ?? '', 5, { kind: 'unplayed', dots: [{
        number: 5, gameId: h.dots.id, gameEtag: saved.round.games?.configuration.etag ?? '',
        players: [], contests: [], rotation: { playerIds: h.ids },
      }] }, null, identifier(34221));
      await expect(h.scores.saveGames(creator, event.id, h.roundId, [next],
        saved.round.games?.configuration.etag ?? null, identifier(34222))).rejects.toMatchObject({ code: 'MATCH_SETUP_LOCKED' });
    });
  });

describe('first-tee Wolf and optional Modified Sixes protocols', () => {
  it.each(['wolf', 'dots'] as const)('fences old %s correction and HI-refresh publications before any staged/audit changes', async (kind) => {
    const f = await fixture();
    await f.scores.saveGames(creator, event.id, f.roundId, [kind === 'wolf' ? f.wolf : f.dots], null, identifier(33600));
    await f.scores.write(creator, event.id, f.roundId, f.ids[0] ?? '', 5, { kind: 'strokes', strokes: 4 }, null, identifier(33601));
    const model = await f.workspace.correctionModel(creator, event.id, f.roundId);
    const body = { expected: { eventEtag: model.eventEtag, roundEtag: model.roundEtag, gamesEtag: model.gamesEtag ?? null,
      inputRevision: model.inputRevision ?? null }, reason: 'Fictional first-tee correction.',
    correction: { teeProfileId: model.teeProfileId, groups: model.groups,
      players: model.players.map((player) => ({ playerId: player.playerId,
        handicapIndexValue: player.playerId === f.ids[0] ? '1' : player.handicapIndex?.value ?? null })) } };
    const old = kind === 'wolf' ? `${base}&dotsHighLow=1` : `${base}&wolfOrders=1`;
    const rows = new Map(f.rows);
    const capture = f.rows.get(`${event.id}|index-capture:${f.roundId}`);
    f.submit.mockClear();
    const handler = createCorrectionsHandler(() => ({ ...f.api, workspace: f.workspace }), 'write');
    expect(await handler(f.request('PUT', body, old, null, f.ids[0], 5, identifier(33602)), f.context)).toMatchObject({ status: 426 });
    const player = await f.players.get(creator, f.ids[0] ?? '');
    await expect(f.workspace.refreshPlayerIndex(creator, event.id, player.id, player.currentIndex?.id ?? '',
      model.eventEtag, identifier(33603), undefined, kind !== 'wolf', kind !== 'dots')).rejects.toMatchObject({ status: 426 });
    expect(f.rows).toEqual(rows);
    expect(f.submit).not.toHaveBeenCalled();
    expect(await handler(f.request('PUT', body, current, null, f.ids[0], 5, identifier(33602)), f.context)).toMatchObject({ status: 200 });
    expect(f.rows.get(`${event.id}|index-capture:${f.roundId}`)).toEqual(capture);
  });
  it.each(['wolf', 'dots'] as const)('fences old %s staged commits and publishes immutable order with the same retry identity', async (kind) => {
    const f = await fixture();
    const game = kind === 'wolf' ? f.wolf : f.dots;
    const configured = await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(33500));
    const gameEtag = configured.round.games?.configuration.etag ?? '';
    const score = kind === 'wolf'
      ? { kind: 'unplayed', wolf: [{ number: 5, choice: { gameId: game.id, gameEtag, mode: 'order' }, order: { playerIds: f.ids } }] }
      : { kind: 'unplayed', dots: [{ number: 5, gameId: game.id, gameEtag, rotation: { playerIds: f.ids }, players: [], contests: [] }] };
    const bytes = Buffer.from(JSON.stringify({ score }));
    const upload = { id: identifier(33501), bytes: bytes.length, parts: Math.ceil(bytes.length / privateWritePartBytes),
      sha256: createHash('sha256').update(bytes).digest('hex') };
    const requestId = identifier(33502), anchor = f.ids[0] ?? '';
    const handler = createPublicHandler(() => f.publicApi, 'score-game-hole');
    for (let index = 0; index < upload.parts; index++) {
      const part = { privateUpload: { ...upload, index,
        content: bytes.subarray(index * privateWritePartBytes, (index + 1) * privateWritePartBytes).toString('base64') } };
      expect(await handler(f.request('PUT', part, current, null, anchor, 5, requestId), f.context)).toMatchObject({ status: 200 });
    }
    const rows = new Map(f.rows);
    f.submit.mockClear();
    const old = kind === 'wolf' ? `${base}&dotsHighLow=1` : `${base}&wolfOrders=1`;
    const commit = { privateCommit: upload };
    expect(await handler(f.request('PUT', commit, old, null, anchor, 5, requestId), f.context)).toMatchObject({ status: 426 });
    expect(f.rows).toEqual(rows);
    expect(f.submit).not.toHaveBeenCalled();
    const saved = await handler(f.request('PUT', commit, current, null, anchor, 5, requestId), f.context);
    expect(saved.status).toBe(200);
    const persisted = new Map(f.rows);
    expect(await handler(f.request('PUT', commit, current, null, anchor, 5, requestId), f.context)).toMatchObject({ status: 200 });
    expect(f.rows).toEqual(persisted);
    if (kind === 'wolf') {
      const { orderMode, ...legacy } = f.wolf;
      expect(orderMode).toBe('first-tee-v1');
      await expect(f.scores.saveGames(creator, event.id, f.roundId, [legacy], gameEtag, identifier(33503)))
        .rejects.toMatchObject({ code: 'MATCH_SETUP_LOCKED' });
    }
  });
  it('fences old full/lean Wolf reads, raw/game/staged writes and purse publications before mutation', async () => {
    const f = await fixture();
    const configured = await f.scores.saveGames(creator, event.id, f.roundId, [f.wolf], null, identifier(33210));
    const get = createScoringHandler(() => f.api, 'scores');
    const write = createScoringHandler(() => f.api, 'score-hole');
    const old = `${base}&dotsHighLow=1`;
    for (const format of ['', '&format=lean']) {
      expect(await get(f.request('GET', undefined, old + format), f.context)).toMatchObject({
        status: 426, jsonBody: { code: 'WOLF_ORDERS_CLIENT_UPDATE_REQUIRED' },
      });
      const read = await get(f.request('GET', undefined, current + format), f.context);
      expect(read.status).toBe(200);
      const round = decodeRoundScores(read.jsonBody);
      expect(round?.wolfOrderVersion).toBe(1);
      expect(round?.games?.results[0]?.wolf?.holes.every((hole) => hole.status === 'pending' && hole.wolfId === null)).toBe(true);
    }
    const rows = new Map(f.rows);
    f.submit.mockClear();
    expect(await write(f.request('PUT', { score: { kind: 'strokes', strokes: 4 } }, old), f.context)).toMatchObject({ status: 426 });
    const games = createScoringHandler(() => f.api, 'round-games');
    expect(await games(f.request('PUT', { games: [f.wolf] }, old, configured.round.games?.configuration.etag ?? null), f.context))
      .toMatchObject({ status: 426 });
    const staged = createScoringHandler(() => f.api, 'score-game-hole');
    expect(await staged(f.request('PUT', { privateUpload: { id: identifier(33211), index: 0, count: 1, chunk: 'opaque' } }, old), f.context))
      .toMatchObject({ status: 426 });
    const purse = createPurseHandler(() => ({ ...f.api, purse: f.purse }));
    expect(await purse(f.request('PUT', { plan: {}, resolutions: [] }, old), f.context)).toMatchObject({ status: 426 });
    expect(f.rows).toEqual(rows);
    expect(f.submit).not.toHaveBeenCalled();
    expect(await write(f.request('PUT', { score: { kind: 'strokes', strokes: 4 } }), f.context)).toMatchObject({ status: 200 });
  });

  it('saves an immutable canonical first-tee order independently of another group, retains raw edits and recovers late honestly', async () => {
    const f = await fixture();
    const configured = await f.scores.saveGames(creator, event.id, f.roundId, [f.wolf], null, identifier(33300));
    const gameEtag = configured.round.games?.configuration.etag ?? '';
    const other = f.input.rounds[0]?.groups[1]?.playerIds[0];
    if (!other) throw new Error('Missing fictional second group');
    await f.scores.write(creator, event.id, f.roundId, other, 5, { kind: 'strokes', strokes: 4 }, null, identifier(33301));
    const anchor = f.ids[0] ?? '';
    const order: WolfHoleRecord = { number: 5, choice: { gameId: f.wolf.id, gameEtag, mode: 'order' },
      order: { playerIds: [...f.ids].reverse(), recordedLate: true } };
    const body = { score: { kind: 'unplayed', wolf: [order] } };
    const save = createPublicHandler(() => f.publicApi, 'score-game-hole');
    const first = await save(f.request('PUT', body, current, null, anchor, 5, identifier(33302)), f.context);
    expect(first.status).toBe(200);
    const value: unknown = first.jsonBody;
    if (!value || typeof value !== 'object' || !('round' in value)) throw new Error('Missing fictional acknowledgement');
    const round = decodeRoundScores(value.round);
    if (!round) throw new Error('Invalid fictional order acknowledgement');
    expect(isRoundScores({ ...round, wolfOrderVersion: undefined })).toBe(false);
    expect(isRoundScores({ ...round, cards: round.cards.map((card) => ({ ...card,
      holes: card.holes.map((hole) => hole.score.wolf?.length ? { ...hole,
        score: { ...hole.score, wolf: hole.score.wolf.map((record) => ({ ...record, number: 1 })) } } : hole),
    })) })).toBe(false);
    const card = round.cards.find((entry) => entry.playerId === anchor);
    const saved = card?.holes.find((hole) => hole.number === 5)?.score.wolf?.[0];
    expect(saved?.choice.mode).toBe('order');
    expect(saved?.order).toEqual({ playerIds: [...f.ids].reverse() });
    expect(round.games?.results[0]?.wolf?.holes.find((hole) => hole.number === 5)?.wolfId).toBe(f.ids[3]);
    const receiptRows = new Map(f.rows);
    const replay = await save(f.request('PUT', body, current, null, anchor, 5, identifier(33302)), f.context);
    expect(replay.status).toBe(200);
    expect(f.rows).toEqual(receiptRows);
    await expect(f.scores.write(creator, event.id, f.roundId, anchor, 5, {
      kind: 'strokes', strokes: 4, wolf: [{ ...order, order: { playerIds: f.ids } }],
    }, card?.etag ?? null, identifier(33303))).rejects.toMatchObject({ code: 'WOLF_ORDER_CONFLICT' });
    const pig = await f.scores.write(creator, event.id, f.roundId, anchor, 5, {
      kind: 'strokes', strokes: 4, wolf: [{ number: 5, choice: { gameId: f.wolf.id, gameEtag, mode: 'pig' } }],
    }, card?.etag ?? null, identifier(33304));
    const after = pig.round.cards.find((entry) => entry.playerId === anchor);
    expect(after?.holes.find((hole) => hole.number === 5)?.score.wolf?.[0]?.order).toEqual(saved?.order);
    const raw = await f.scores.write(creator, event.id, f.roundId, anchor, 5,
      { kind: 'strokes', strokes: 3 }, after?.etag ?? null, identifier(33305));
    expect(raw.round.cards.find((entry) => entry.playerId === anchor)?.holes.find((hole) => hole.number === 5)?.score.wolf?.[0]?.order)
      .toEqual(saved?.order);
    await expect(f.scores.write(creator, event.id, f.roundId, anchor, 1, { kind: 'unplayed', wolf: [{ ...order, number: 1 }] },
      raw.round.cards.find((entry) => entry.playerId === anchor)?.etag ?? null, identifier(33306))).rejects.toMatchObject({ code: 'MATCH_SETUP_CHANGED' });
    const late = await fixture();
    await late.scores.saveGames(creator, event.id, late.roundId, [late.wolf], null, identifier(33310));
    const prior = await late.scores.write(creator, event.id, late.roundId, late.ids[1] ?? '', 6,
      { kind: 'strokes', strokes: 4 }, null, identifier(33311));
    const recovered = await late.scores.write(creator, event.id, late.roundId, late.ids[0] ?? '', 5, {
      kind: 'unplayed', wolf: [{ number: 5, choice: { gameId: late.wolf.id, gameEtag: prior.round.games?.configuration.etag ?? '', mode: 'order' },
        order: { playerIds: late.ids } }],
    }, null, identifier(33312));
    expect(recovered.round.cards.find((entry) => entry.playerId === late.ids[0])?.holes.find((hole) => hole.number === 5)?.score.wolf?.[0]?.order)
      .toEqual({ playerIds: late.ids, recordedLate: true });
  });

  it('negotiates Net Modified Sixes separately, saves raw scores and immutable base awards, and locks the selected handicap rule', async () => {
    const f = await fixture();
    const configured = await f.scores.saveGames(creator, event.id, f.roundId, [f.dots], null, identifier(33400));
    const old = `${base}&wolfOrders=1`;
    const get = createScoringHandler(() => f.api, 'scores');
    for (const format of ['', '&format=lean']) {
      expect(await get(f.request('GET', undefined, old + format), f.context)).toMatchObject({
        status: 426, jsonBody: { code: 'DOTS_HIGH_LOW_CLIENT_UPDATE_REQUIRED' },
      });
      const response = await get(f.request('GET', undefined, current + format), f.context);
      expect(response.status).toBe(200);
      expect(decodeRoundScores(response.jsonBody)?.dotsHighLowVersion).toBe(1);
    }
    const write = createScoringHandler(() => f.api, 'score-hole');
    const rows = new Map(f.rows);
    f.submit.mockClear();
    expect(await write(f.request('PUT', { score: { kind: 'strokes', strokes: 3 } }, old), f.context)).toMatchObject({ status: 426 });
    const games = createScoringHandler(() => f.api, 'round-games');
    expect(await games(f.request('PUT', { games: [f.dots] }, old, configured.round.games?.configuration.etag ?? null), f.context))
      .toMatchObject({ status: 426 });
    const staged = createScoringHandler(() => f.api, 'score-game-hole');
    expect(await staged(f.request('PUT', { privateUpload: { id: identifier(33401), index: 0, count: 1, chunk: 'opaque' } }, old), f.context))
      .toMatchObject({ status: 426 });
    const purse = createPurseHandler(() => ({ ...f.api, purse: f.purse }));
    expect(await purse(f.request('PUT', { plan: {}, resolutions: [] }, old), f.context)).toMatchObject({ status: 426 });
    expect(f.rows).toEqual(rows);
    expect(f.submit).not.toHaveBeenCalled();
    let last;
    for (const [index, playerId] of f.ids.entries()) {
      last = await f.scores.write(creator, event.id, f.roundId, playerId, 5, { kind: 'strokes', strokes: index < 2 ? 3 : 5,
        ...(index === 0 ? { dots: [{ number: 5, gameId: f.dots.id, gameEtag: configured.round.games?.configuration.etag ?? '',
          rotation: { playerIds: f.ids }, players: [], contests: [] }] } : {}) },
      null, identifier(33410 + index));
    }
    expect(last?.round.games?.results[0]?.dotsHighLow?.awards).toHaveLength(2);
    expect(last?.change.dotAwardAudit?.[0]?.after).toHaveLength(2);
    const immutable = [...f.rows.values()].filter((row) => row.rowKey?.includes('score-change')).map((row) => row.content);
    expect(immutable).toHaveLength(4);
    await expect(f.scores.saveGames(creator, event.id, f.roundId, [{ ...f.dots,
      highLow: { version: 1 as const, handicapRule: 'group-low-v1' as const } }], configured.round.games?.configuration.etag ?? null, identifier(33420)))
      .rejects.toMatchObject({ code: 'MATCH_SETUP_LOCKED' });
    expect([...f.rows.values()].filter((row) => row.rowKey?.includes('score-change')).map((row) => row.content)).toEqual(immutable);
    const raw = await write(f.request('PUT', { score: { kind: 'strokes', strokes: 4 } }, current,
      last?.round.cards[0]?.etag ?? null), f.context);
    expect(raw.status).toBe(200);
  });
});

describe('rotating Dots v3 recovery and correction boundaries', () => {
  it('keeps missing order pending, permits raw scores, and recovers on the canonical earliest played hole with server-only late timing', async () => {
    const f = await v3Fixture('approach', 6);
    const anchor = f.ids[0] ?? '';
    await f.scores.write(creator, event.id, f.roundId, f.ids[1] ?? '', 6, { kind: 'strokes', strokes: 4 }, null, identifier(34300));
    const raw = await f.scores.write(creator, event.id, f.roundId, anchor, 5, { kind: 'strokes', strokes: 4 }, null, identifier(34301));
    expect(raw.round.games?.results[0]?.dotsHighLow?.holes.find((hole) => hole.number === 5)?.status).toBe('pending');
    expect(raw.round.games?.results[0]?.dots?.awards).toEqual([]);
    await expect(f.scores.write(creator, event.id, f.roundId, anchor, 6,
      { kind: 'unplayed', dots: [f.declaration(6)] }, f.etag(raw.round), identifier(34302)))
      .rejects.toMatchObject({ code: 'DOTS_SETUP_CHANGED' });
    const recovered = await f.scores.write(creator, event.id, f.roundId, anchor, 5,
      { kind: 'strokes', strokes: 4, dots: [f.declaration()] }, f.etag(raw.round), identifier(34303));
    expect(recovered.change.after.dots?.[0]?.rotation).toEqual({ playerIds: f.ids, recordedLate: true });
    const capture = f.rows.get(`${event.id}|index-capture:${f.roundId}`);
    const cleared = await f.scores.write(creator, event.id, f.roundId, anchor, 5,
      { kind: 'unplayed', dots: [f.declaration()] },
      f.etag(recovered.round), identifier(34304));
    expect(cleared.change.after.dots?.[0]?.rotation).toEqual({ playerIds: f.ids, recordedLate: true });
    expect(f.rows.get(`${event.id}|index-capture:${f.roundId}`)).toEqual(capture);
    const g = await v3Fixture();
    const other = g.input.rounds[0]?.groups[1]?.playerIds[0] ?? '';
    await g.scores.write(creator, event.id, g.roundId, other, 5, { kind: 'strokes', strokes: 4 }, null, identifier(34310));
    const independent = await g.scores.write(creator, event.id, g.roundId, g.ids[0] ?? '', 5,
      { kind: 'unplayed', dots: [{ ...g.declaration(), rotation: { playerIds: g.ids, recordedLate: true } }] }, null, identifier(34311));
    expect(independent.change.after.dots?.[0]?.rotation).toEqual({ playerIds: g.ids });
  });

  it('fences old correction/HI shortcuts before captures or audits, then publishes an idempotent corrected revision without rewriting raw receipts', async () => {
    const f = await v3Fixture();
    let round = f.configured.round;
    for (const [index, playerId] of f.ids.entries()) {
      round = (await f.scores.write(creator, event.id, f.roundId, playerId, 5, { kind: 'strokes', strokes: 4,
        ...(index === 0 ? { dots: [f.declaration()] } : {}) }, f.etag(round, playerId), identifier(34400 + index))).round;
    }
    const model = await f.workspace.correctionModel(creator, event.id, f.roundId);
    const body = { expected: { eventEtag: model.eventEtag, roundEtag: model.roundEtag, gamesEtag: model.gamesEtag ?? null,
      inputRevision: model.inputRevision ?? null }, reason: 'Fictional v3 correction.',
    correction: { teeProfileId: model.teeProfileId, groups: model.groups,
      players: model.players.map((player) => ({ playerId: player.playerId,
        handicapIndexValue: player.playerId === f.ids[0] ? '18' : player.handicapIndex?.value ?? null })) } };
    const rows = new Map(f.rows);
    const capture = f.rows.get(`${event.id}|index-capture:${f.roundId}`);
    const cards = [...f.rows.values()].filter((row) => row.rowKey?.startsWith(`score-card:${f.roundId}`));
    const receipts = [...f.rows.values()].filter((row) => row.rowKey?.includes('score-change'));
    const handler = createCorrectionsHandler(() => ({ ...f.api, workspace: f.workspace }), 'write');
    f.submit.mockClear();
    const requestId = identifier(34410);
    expect(await handler(f.request('PUT', body, current, null, f.ids[0], 5, requestId), f.context))
      .toMatchObject({ status: 426, jsonBody: { code: 'DOTS_RULES_V3_CLIENT_UPDATE_REQUIRED' } });
    const player = await f.players.get(creator, f.ids[0] ?? '');
    await expect(f.workspace.refreshPlayerIndex(creator, event.id, player.id, player.currentIndex?.id ?? '',
      model.eventEtag, identifier(34411), undefined, true, true, false)).rejects.toMatchObject({ status: 426 });
    await expect(f.workspace.refreshIndices(creator, event.id, f.roundId, identifier(34412),
      model.eventEtag, true, true, false)).rejects.toMatchObject({ status: 426 });
    expect(f.rows).toEqual(rows);
    expect(f.submit).not.toHaveBeenCalled();
    const changed = await handler(f.request('PUT', body, v3Query, null, f.ids[0], 5, requestId), f.context);
    expect(changed.status).toBe(200);
    const correctedRows = new Map(f.rows);
    expect(await handler(f.request('PUT', body, v3Query, null, f.ids[0], 5, requestId), f.context)).toMatchObject({ status: 200 });
    expect(f.rows).toEqual(correctedRows);
    expect(f.rows.get(`${event.id}|index-capture:${f.roundId}`)).toEqual(capture);
    expect([...f.rows.values()].filter((row) => row.rowKey?.startsWith(`score-card:${f.roundId}`))).toEqual(cards);
    expect([...f.rows.values()].filter((row) => row.rowKey?.includes('score-change'))).toEqual(receipts);
    const next = await f.scores.get(creator, event.id, f.roundId);
    expect(next.inputRevision).not.toBe(round.inputRevision);
    expect(next.cards.find((card) => card.playerId === f.ids[0])?.holes.find((hole) => hole.number === 5)?.score.dots?.[0]?.rotation)
      .toEqual({ playerIds: f.ids });
    expect(next.games?.results[0]?.dotsHighLow?.awards.map((award) => award.kind)).toEqual(['low']);
  });
});
