import { HttpRequest, InvocationContext } from '@azure/functions';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { StrokePlayGameDefinition } from '../../../src/domain/games.js';
import { decodeRoundScores } from '../../../src/contracts/scoring.js';
import { publicFixture } from '../public-access/test-support.js';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { createScoringHandler } from './handlers.js';
import { createPublicHandler } from '../public-access/handlers.js';
import { createPurseHandler } from '../purse/handlers.js';
import { testerFixture } from '../test-access/test-support.js';
import { createTesterHandler } from '../test-access/handlers.js';

const negotiated = 'gameHandicaps=1&stringRules=2&churchyNames=1&sweepRules=2&dotCoexistence=2';

async function fixture() {
  const f = await publicFixture();
  for (const [index, playerId] of f.input.playerIds.entries()) {
    const player = await f.players.get(creator, playerId);
    await f.players.observe(creator, playerId, identifier(31000 + index), {
      value: ['10.4', '3.8', '7.5', '2.8'][index % 4] ?? '0', effectiveDate: '2026-01-01', source: 'Fictional game input',
    }, player.etag);
  }
  const game: StrokePlayGameDefinition = { id: identifier(31100), name: 'Fictional group-low Stroke',
    kind: 'stroke-play', version: 1, basis: 'net', handicapRule: 'group-low-v1' };
  const limiter = { check: vi.fn().mockResolvedValue(undefined) };
  const ownerApi = { verify: vi.fn().mockResolvedValue(creator), limiter, scores: f.scores };
  const publicApi = { publicEvents: f.publicEvents, workspace: f.workspace, scores: f.scores, purse: f.purse, limiter };
  const context = new InvocationContext({ invocationId: 'fictional-game-handicaps', logHandler: () => undefined });
  const request = (method: 'GET' | 'PUT', body?: unknown, query = '', etag: string | null = null, operation = 31101) => new HttpRequest({
    method, url: `https://fictional.example.test/api/fixture?${query}`,
    params: { id: event.id, roundId: f.roundId, playerId: f.playerId, holeNumber: '1' },
    ...(method === 'PUT' ? { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': identifier(operation),
      ...(etag === null ? { 'If-None-Match': '*' } : { 'If-Match': etag }) }, body: { string: JSON.stringify(body) } } : {}),
  });
  return { ...f, game, ownerApi, publicApi, context, request };
}

describe('explicit handicap protocol and conditional score transactions', () => {
  it('fences old full-plus Wolf readers and writers before mutation and publishes strict calculation-v2 full/lean results', async () => {
    const f = await fixture();
    const player = await f.players.get(creator, f.playerId);
    await f.players.observe(creator, player.id, identifier(31700), {
      value: '+1.0', effectiveDate: '2026-01-01', source: 'Fictional plus input',
    }, player.etag);
    const ids = f.input.rounds[0]?.groups[0]?.playerIds;
    if (!ids) throw new Error('Missing fictional playing group');
    const game = { id: identifier(31701), name: 'Fictional full-plus Wolf', kind: 'wolf' as const, version: 2 as const,
      basis: 'net' as const, handicapRule: 'full-course-v1' as const, groupNumber: 1, playerIds: ids, allowPig: true, stakeMinor: 100 };
    await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(31702));
    const get = createScoringHandler(() => f.ownerApi, 'scores'), write = createScoringHandler(() => f.ownerApi, 'score-hole');
    const old = negotiated, current = `${old}&gameCalculations=2`;
    for (const format of ['', '&format=lean']) {
      expect(await get(f.request('GET', undefined, `${old}${format}`), f.context)).toMatchObject({ status: 426 });
      const result = await get(f.request('GET', undefined, `${current}${format}`), f.context);
      expect(result.status).toBe(200);
      expect(decodeRoundScores(result.jsonBody)?.gameCalculationsVersion).toBe(2);
    }
    const rows = new Map(f.rows);
    f.submit.mockClear();
    expect(await write(f.request('PUT', { score: { kind: 'strokes', strokes: 4 } }, old, null, 31703), f.context))
      .toMatchObject({ status: 426, jsonBody: { code: 'GAME_CALCULATIONS_CLIENT_UPDATE_REQUIRED' } });
    expect(f.rows).toEqual(rows);
    expect(f.submit).not.toHaveBeenCalled();
    expect(await write(f.request('PUT', { score: { kind: 'strokes', strokes: 4 } }, current, null, 31703), f.context))
      .toMatchObject({ status: 200 });
  });

  it('saves a real wrapped Nassau press through dedicated HTTP ingress while keeping raw scores and press identity', async () => {
    const f = await fixture();
    await f.workspace.save(creator, event.id, { ...f.input, rounds: f.input.rounds.map((round) => ({
      ...round, groups: round.groups.map((group) => ({ ...group, startingHole: 5 })),
    })) }, (await f.workspace.get(creator, event.id)).etag);
    const ids = f.input.rounds[0]?.groups[0]?.playerIds;
    if (!ids?.[0] || !ids[1]) throw new Error('Missing fictional match participants');
    const game = { id: identifier(31800), name: 'Fictional wrapped Nassau', kind: 'nassau' as const, version: 1 as const,
      basis: 'gross' as const, playOrder: 'shared-group-v1' as const, groupNumber: 1, variant: 'singles' as const,
      sides: ids.slice(0, 2).map((playerId, index) => ({ id: identifier(31801 + index), name: `Fictional side ${String(index + 1)}`, playerIds: [playerId] })),
      automaticPresses: false, stakes: { currency: 'USD' as const, frontMinor: 100, backMinor: 0, overallMinor: 100 } };
    await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(31803));
    let sequence = 31810;
    for (const hole of [5, 6, 7, 8, 9]) for (const [index, playerId] of ids.entries()) {
      const before = await f.scores.get(creator, event.id, f.roundId);
      await f.scores.write(creator, event.id, f.roundId, playerId, hole, { kind: 'strokes', strokes: index === 0 ? 3 : 4 },
        before.cards.find((card) => card.playerId === playerId)?.etag ?? null, identifier(sequence++));
    }
    const round = await f.scores.get(creator, event.id, f.roundId);
    const option = round.games?.results[0]?.nassau?.pressOptions.find((option) => option.startHole === 1);
    if (!option || !round.games?.configuration.etag) throw new Error('Missing fictional wrapped Front press');
    const press = { ...option, id: identifier(31850) };
    const record = { number: 1, gameId: game.id, gameEtag: round.games.configuration.etag, outcomes: [], presses: [press] };
    const handler = createScoringHandler(() => f.ownerApi, 'score-game-hole');
    const etag = round.cards.find((card) => card.playerId === f.playerId)?.etag ?? null;
    const body = { score: { kind: 'strokes', strokes: 4, nassau: [record] } };
    const rows = new Map(f.rows);
    expect(await handler(f.request('PUT', body, negotiated, etag, 31851), f.context)).toMatchObject({ status: 426 });
    expect(f.rows).toEqual(rows);
    const saved = await handler(f.request('PUT', body, `${negotiated}&gameCalculations=2&format=lean`, etag, 31851), f.context);
    expect(saved.status).toBe(200);
    const envelope: unknown = saved.jsonBody;
    if (!envelope || typeof envelope !== 'object' || !('round' in envelope)) throw new Error('Missing fictional score acknowledgement');
    const published = decodeRoundScores(envelope.round);
    expect(published?.cards.find((card) => card.playerId === f.playerId)?.holes[0]?.score)
      .toMatchObject({ kind: 'strokes', strokes: 4, nassau: [{ presses: [{ id: press.id, declaredAfterHole: 9, startHole: 1 }] }] });
    expect(published?.games?.results[0]?.nassau?.stalePresses).toEqual([]);
  });

  it('retains score-derived Pully Murphy through raw-only saves and rejects old-client echoes before mutation', async () => {
    const f = await fixture();
    const ids = f.input.rounds[0]?.groups[0]?.playerIds;
    if (!ids) throw new Error('Missing fictional Dots group');
    const game = { id: identifier(31900), name: 'Fictional Pully Dots', kind: 'dots' as const, version: 1 as const,
      groupNumber: 1, playerIds: ids, mode: 'individual' as const, stakeMinor: 100,
      specials: [{ kind: 'pully-murphy' as const, units: 1 }] };
    const setup = await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(31901));
    const call = { id: identifier(31902), kind: 'pully-murphy' as const, result: 'pending' as const, pullyMurphyTarget: 'par' as const };
    const handler = createScoringHandler(() => f.ownerApi, 'score-hole');
    const query = `${negotiated}&dotsCalls=score-v1&gameCalculations=2`;
    const body = { score: { kind: 'strokes', strokes: 5, dots: [{ number: 1, gameId: game.id,
      gameEtag: setup.round.games?.configuration.etag, contests: [], players: [{ playerId: f.playerId, counts: {}, calls: [call] }] }] } };
    expect(await handler(f.request('PUT', body, query, null, 31903), f.context)).toMatchObject({ status: 200 });
    const before = await f.scores.get(creator, event.id, f.roundId);
    const etag = before.cards.find((card) => card.playerId === f.playerId)?.etag ?? null;
    const rows = new Map(f.rows);
    expect(await handler(f.request('PUT', { score: { kind: 'strokes', strokes: 6 } }, negotiated, etag, 31904), f.context))
      .toMatchObject({ status: 426 });
    expect(f.rows).toEqual(rows);
    expect(await handler(f.request('PUT', { score: { kind: 'strokes', strokes: 6 } }, query, etag, 31904), f.context))
      .toMatchObject({ status: 200 });
    const after = await f.scores.get(creator, event.id, f.roundId);
    expect(after.cards.find((card) => card.playerId === f.playerId)?.holes[0]?.score.dots?.[0]?.players[0]?.calls).toEqual([call]);
  });
  it('fences legacy tester writes before scoring, instead of rejecting only their post-mutation response', async () => {
    const f = await testerFixture();
    const game: StrokePlayGameDefinition = { id: identifier(31200), name: 'Fictional marked tester Stroke',
      kind: 'stroke-play', version: 1, basis: 'net', handicapRule: 'group-low-v1' };
    await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(31201));
    const api = { verify: vi.fn().mockResolvedValue(creator), limiter: { check: vi.fn().mockResolvedValue(undefined) },
      scores: f.scores, testers: f.testers, workspace: f.workspace };
    const context = new InvocationContext({ invocationId: 'fictional-tester-handicaps', logHandler: () => undefined });
    const request = (query = '') => new HttpRequest({
      method: 'PUT', url: `https://fictional.example.test/api/fixture?${query}`,
      params: { id: event.id, roundId: f.roundId, playerId: f.playerId, holeNumber: '1' },
      headers: { Authorization: f.header, 'Content-Type': 'application/json', 'Idempotency-Key': identifier(31202), 'If-None-Match': '*' },
      body: { string: JSON.stringify({ score: { kind: 'strokes', strokes: 4 } }) },
    });
    const rows = new Map(f.rows);
    f.submit.mockClear();
    const handler = createTesterHandler(() => api, 'score-hole');
    expect(await handler(request(), context)).toMatchObject({ status: 426, jsonBody: { code: 'GAME_HANDICAP_CLIENT_UPDATE_REQUIRED' } });
    expect(f.rows).toEqual(rows);
    expect(f.submit).not.toHaveBeenCalled();
    expect(await handler(request('gameHandicaps=1'), context)).toMatchObject({ status: 200 });
    expect((await f.scores.get(f.actor, event.id, f.roundId)).cards.find((card) => card.playerId === f.playerId)?.holes[0]?.score)
      .toEqual({ kind: 'strokes', strokes: 4 });
  });
  it('rejects unknown/duplicate negotiation and unnegotiated game publication before mutation, including staged commits', async () => {
    const f = await fixture(), handler = createScoringHandler(() => f.ownerApi, 'round-games');
    const rows = new Map(f.rows);
    f.submit.mockClear();
    for (const query of ['', 'gameHandicaps=2', 'gameHandicaps=1&gameHandicaps=1']) {
      expect(await handler(f.request('PUT', { games: [f.game] }, query), f.context))
        .toMatchObject({ status: 426, jsonBody: { code: 'GAME_HANDICAP_CLIENT_UPDATE_REQUIRED' } });
    }
    expect(f.rows).toEqual(rows);
    expect(f.submit).not.toHaveBeenCalled();
    const bytes = Buffer.from(JSON.stringify({ games: [f.game] }));
    const upload = { id: identifier(31110), bytes: bytes.length, parts: 1, sha256: createHash('sha256').update(bytes).digest('hex') };
    expect(await handler(f.request('PUT', { privateUpload: { ...upload, index: 0, content: bytes.toString('base64') } },
      '', null, 31110), f.context)).toMatchObject({ status: 200 });
    const staged = new Map(f.rows);
    expect(await handler(f.request('PUT', { privateCommit: upload }, '', null, 31110), f.context)).toMatchObject({ status: 426 });
    expect(f.rows).toEqual(staged);
    expect(await handler(f.request('PUT', { privateCommit: upload }, negotiated, null, 31110), f.context)).toMatchObject({ status: 200 });
    expect(await handler(f.request('PUT', { privateCommit: upload }, negotiated, null, 31110), f.context)).toMatchObject({ status: 200 });
    expect((await f.scores.get(creator, event.id, f.roundId)).games?.configuration.games).toEqual([f.game]);
  });

  it.each(['owner', 'public'] as const)('fences affected %s full/lean reads, writes, staging and old echoes before mutation', async (role) => {
    const f = await fixture();
    const configured = await f.scores.saveGames(creator, event.id, f.roundId, [f.game], null, identifier(31120));
    expect(configured.round.courseHandicaps?.slice(0, 4).map((entry) => entry.courseHandicap)).toEqual([11, 4, 8, 3]);
    expect(configured.round.games?.results[0]?.players.slice(0, 4).map((player) => player.playingHandicap)).toEqual([8, 1, 5, 0]);
    const reader = role === 'owner' ? createScoringHandler(() => f.ownerApi, 'scores') : createPublicHandler(() => f.publicApi, 'scores');
    const writer = role === 'owner' ? createScoringHandler(() => f.ownerApi, 'score-hole') : createPublicHandler(() => f.publicApi, 'score-hole');
    const stage = role === 'owner' ? createScoringHandler(() => f.ownerApi, 'score-game-hole') : createPublicHandler(() => f.publicApi, 'score-game-hole');
    const games = role === 'owner' ? createScoringHandler(() => f.ownerApi, 'round-games') : createPublicHandler(() => f.publicApi, 'games');
    const rows = new Map(f.rows);
    f.submit.mockClear();
    for (const query of ['', 'format=lean', 'privatePart=0&privateHash=fixture']) {
      expect(await reader(f.request('GET', undefined, query), f.context)).toMatchObject({ status: 426 });
    }
    expect(await writer(f.request('PUT', { score: { kind: 'strokes', strokes: 5 } }), f.context)).toMatchObject({ status: 426 });
    expect(await stage(f.request('PUT', { privateUpload: {} }), f.context)).toMatchObject({ status: 426 });
    expect(await games(f.request('PUT', { games: [f.game] }, '', configured.round.games?.configuration.etag ?? null), f.context))
      .toMatchObject({ status: 426 });
    if (role === 'owner') {
      const kp = createScoringHandler(() => f.ownerApi, 'round-kp');
      expect(await kp(f.request('PUT', { privateUpload: {} }), f.context)).toMatchObject({ status: 426 });
      const purse = createPurseHandler(() => ({ verify: f.ownerApi.verify, limiter: f.ownerApi.limiter, purse: f.purse }));
      expect(await purse(f.request('PUT', { privateUpload: {} }), f.context)).toMatchObject({ status: 426 });
    }
    expect(f.rows).toEqual(rows);
    expect(f.submit).not.toHaveBeenCalled();
    for (const query of [negotiated, `${negotiated}&format=lean`]) {
      const response = await reader(f.request('GET', undefined, query), f.context);
      expect(response.status).toBe(200);
      expect(decodeRoundScores(response.jsonBody)?.games?.results[0]?.players.slice(0, 4).map((player) => player.playingHandicap))
        .toEqual([8, 1, 5, 0]);
    }
    const request = f.request('PUT', { score: { kind: 'strokes', strokes: 5 } }, `${negotiated}&format=lean`, null, 31121);
    const saved = await writer(request, f.context);
    expect(saved.status).toBe(200);
    const after = new Map(f.rows);
    expect(await writer(f.request('PUT', { score: { kind: 'strokes', strokes: 5 } },
      `${negotiated}&format=lean`, null, 31121), f.context)).toEqual(saved);
    expect(f.rows).toEqual(after);
  });

  it('locks start and handicap mode after the first score and retains original captures, cards and receipts through an HI correction', async () => {
    const f = await fixture();
    const configured = await f.scores.saveGames(creator, event.id, f.roundId, [f.game], null, identifier(31130));
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, { kind: 'strokes', strokes: 5 }, null, identifier(31131));
    const frozen = new Map([...f.rows].filter(([key]) => key.includes('|score-') || key.includes('|index-capture:')));
    const workspace = await f.workspace.get(creator, event.id);
    await expect(f.scores.saveGames(creator, event.id, f.roundId, [{ ...f.game, handicapRule: 'full-course-v1' }],
      configured.round.games?.configuration.etag ?? null, identifier(31132))).rejects.toMatchObject({ code: 'GAME_HANDICAP_SETUP_LOCKED' });
    await expect(f.workspace.save(creator, event.id, { ...f.input,
      rounds: f.input.rounds.map((round) => ({ ...round, groups: round.groups.map((group) => ({ ...group, startingHole: 10 })) })) },
    workspace.etag)).rejects.toMatchObject({ code: 'ROUND_SCORING_STARTED' });
    const model = await f.workspace.correctionModel(creator, event.id, f.roundId);
    const body = { expected: { eventEtag: model.eventEtag, roundEtag: model.roundEtag, gamesEtag: model.gamesEtag ?? null,
      inputRevision: model.inputRevision ?? null }, reason: 'Fictional acknowledged event-local HI correction.',
    correction: { teeProfileId: model.teeProfileId, groups: model.groups,
      players: model.players.map((player) => ({ playerId: player.playerId,
        handicapIndexValue: player.playerId === f.input.playerIds[3] ? '0' : player.handicapIndex?.value ?? null })) } };
    await expect(f.workspace.correctRound(creator, event.id, f.roundId, identifier(31133), { ...body,
      correction: { ...body.correction, groups: body.correction.groups.map((group) => ({ ...group, startingHole: 10 })) } }))
      .rejects.toMatchObject({ code: 'GAME_START_SETUP_LOCKED' });
    const corrected = await f.workspace.correctRound(creator, event.id, f.roundId, identifier(31134), body);
    expect(corrected.applied).toBe(true);
    expect((await f.workspace.correctRound(creator, event.id, f.roundId, identifier(31134), body)).applied).toBe(false);
    const after = await f.scores.get(creator, event.id, f.roundId);
    expect(after.games?.results[0]?.players.slice(0, 4).map((player) => player.playingHandicap)).toEqual([11, 4, 8, 0]);
    expect(after.cards).toEqual(saved.round.cards);
    expect(after.inputRevision).toBe(identifier(31134));
    for (const [key, row] of frozen) expect(f.rows.get(key)).toEqual(row);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 2, { kind: 'strokes', strokes: 4 }, null, identifier(31135)))
      .rejects.toMatchObject({ code: 'SCORE_INPUTS_CHANGED' });
  });

  it('rejects ambiguous new Skins carries in games and conditional round setup, leaving legacy printed-order carry unchanged', async () => {
    const f = await fixture();
    const input = { ...f.input, rounds: f.input.rounds.map((round) => ({ ...round,
      groups: round.groups.map((group) => ({ ...group, startingHole: group.number === 1 ? 10 : 1 })) })) };
    const setup = await f.workspace.save(creator, event.id, input, (await f.workspace.get(creator, event.id)).etag);
    const game = { id: identifier(31140), name: 'Fictional Skins', kind: 'skins' as const, version: 1 as const,
      basis: 'gross' as const, carryovers: true, carryOrder: 'shared-group-v1' as const };
    const rows = new Map(f.rows);
    await expect(f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(31141)))
      .rejects.toMatchObject({ code: 'SKINS_FOURSOME_REQUIRED' });
    expect(f.rows).toEqual(rows);
    const shared = { ...input, playerIds: input.playerIds.slice(0, 4), rounds: input.rounds.map((round) => ({ ...round,
      groups: [{ number: 1, playerIds: input.playerIds.slice(0, 4), startingHole: 10 }] })) };
    const accepted = await f.workspace.save(creator, event.id, shared, setup.etag);
    await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(31142));
    const current = await f.workspace.get(creator, event.id);
    await expect(f.workspace.save(creator, event.id, { ...input, rounds: input.rounds.map((round) => ({ ...round,
      groups: round.groups.map((group) => ({ ...group, startingHole: 10 })) })) }, current.etag))
      .rejects.toMatchObject({ code: 'SKINS_FOURSOME_REQUIRED' });
    expect((await f.workspace.get(creator, event.id)).rounds[0]?.groups).toEqual(accepted.rounds[0]?.groups);
  });

  it('keeps persisted unmarked multi-group Skins readable and unchanged, but requires explicit one-foursome adoption for edits', async () => {
    const f = await fixture();
    const game = { id: identifier(31150), name: 'Fictional legacy multi-group Skins', kind: 'skins' as const,
      version: 1 as const, basis: 'gross' as const, carryovers: false };
    await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(31151));
    const key = `${event.id}|round-games:${f.roundId}`, saved = f.rows.get(key);
    if (!saved) throw new Error('Missing fictional pre-upgrade configuration');
    const legacy = { ...game, carryovers: true };
    f.seed({ ...saved, content: JSON.stringify({ eventId: event.id, roundId: f.roundId, games: [legacy] }) });
    const before = await f.scores.get(creator, event.id, f.roundId);
    expect(before.games?.configuration.games).toEqual([legacy]);
    expect(decodeRoundScores(before)).toEqual(before);
    const result = await f.scores.saveGames(creator, event.id, f.roundId, [legacy], before.games?.configuration.etag ?? null, identifier(31152));
    expect(result.round.games?.configuration.games).toEqual([legacy]);
    const renamed = await f.scores.saveGames(creator, event.id, f.roundId, [{ ...legacy, name: 'Fictional renamed legacy Skins' }],
      result.round.games?.configuration.etag ?? null, identifier(31153));
    expect(renamed.round.games?.configuration.games[0]).not.toHaveProperty('carryOrder');
    const rows = new Map(f.rows);
    await expect(f.scores.saveGames(creator, event.id, f.roundId, [{ ...legacy, basis: 'net' }],
      renamed.round.games?.configuration.etag ?? null, identifier(31155))).rejects.toMatchObject({ status: 426 });
    expect(f.rows).toEqual(rows);
    await expect(f.scores.saveGames(creator, event.id, f.roundId, [{ ...legacy, carryOrder: 'shared-group-v1' as const }],
      renamed.round.games?.configuration.etag ?? null, identifier(31154))).rejects.toMatchObject({ code: 'SKINS_FOURSOME_REQUIRED' });
    expect(f.rows).toEqual(rows);
  });
});
