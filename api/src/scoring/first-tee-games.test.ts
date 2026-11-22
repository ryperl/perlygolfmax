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
