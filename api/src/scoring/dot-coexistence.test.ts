import { HttpRequest, InvocationContext } from '@azure/functions';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { DotsGameDefinition, DotsHoleRecord } from '../../../src/domain/dots.js';
import type { ChurchyGameDefinitionV3 } from '../../../src/domain/churchy.js';
import { decodeRoundScores } from '../../../src/contracts/scoring.js';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { publicFixture } from '../public-access/test-support.js';
import { testerFixture } from '../test-access/test-support.js';
import { createPublicHandler } from '../public-access/handlers.js';
import { createScoringHandler } from './handlers.js';

async function fixture(churchie = false) {
  const f = await publicFixture();
  const common = { id: identifier(31000), name: 'Fictional coexistence', groupNumber: 1,
    playerIds: f.input.playerIds.slice(0, 4), specials: [
      { kind: 'chippy' as const, units: 1 }, { kind: 'pully' as const, units: 1 },
      { kind: 'hogan' as const, units: 1 }, { kind: 'sandy' as const, units: 1 },
      { kind: 'seve' as const, units: 1 }, { kind: 'kp' as const, units: 1 },
      { kind: 'long-drive' as const, units: 1 },
    ] };
  const game: DotsGameDefinition | ChurchyGameDefinitionV3 = churchie
    ? { ...common, kind: 'churchy', version: 3, basis: 'net', orderMode: 'tee', amountPerDotMinor: 0, currency: 'USD' }
    : { ...common, kind: 'dots', version: 1, mode: 'individual', stakeMinor: null };
  const setup = await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(31001));
  const ownerApi = { verify: vi.fn().mockResolvedValue(creator), limiter: { check: vi.fn().mockResolvedValue(undefined) }, scores: f.scores };
  const publicApi = { publicEvents: f.publicEvents, workspace: f.workspace, scores: f.scores, purse: f.purse, limiter: ownerApi.limiter };
  const context = new InvocationContext({ invocationId: 'fictional-coexistence', logHandler: () => undefined });
  const request = (method: 'GET' | 'PUT', body?: unknown, query = '', etag: string | null = null, operation = 31002) =>
    new HttpRequest({ method, url: `https://fictional.example.test/api/fixture?${churchie ? 'churchyNames=1&' : ''}${query}`,
      params: { id: event.id, roundId: f.roundId, playerId: f.playerId, holeNumber: '1' },
      ...(method === 'PUT' ? { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': identifier(operation),
        ...(etag === null ? { 'If-None-Match': '*' } : { 'If-Match': etag }) },
        body: { string: JSON.stringify(body) } } : {}) });
  const declaration = (counts: DotsHoleRecord['players'][number]['counts']): DotsHoleRecord =>
    ({ number: 1, gameId: game.id, gameEtag: setup.round.games?.configuration.etag ?? '', contests: [],
      players: [{ playerId: f.playerId, counts, calls: [] }] });
  const score = (record: DotsHoleRecord, strokes = 4) => ({ kind: 'strokes' as const, strokes,
    ...(churchie ? { churchy: { ...record, version: 3 as const } } : { dots: [record] }) });
  return { ...f, game, setup, ownerApi, publicApi, context, request, declaration, score };
}

describe('source-hole coexistence HTTP compatibility', () => {
  it.each(['owner', 'public'] as const)('rejects affected old %s writes before score/audit mutation and lets unaffected old clients continue', async (role) => {
    const f = await fixture();
    const writer = role === 'owner' ? createScoringHandler(() => f.ownerApi, 'score-hole')
      : createPublicHandler(() => f.publicApi, 'score-hole');
    const staged = role === 'owner' ? createScoringHandler(() => f.ownerApi, 'score-game-hole')
      : createPublicHandler(() => f.publicApi, 'score-game-hole');
    const reader = role === 'owner' ? createScoringHandler(() => f.ownerApi, 'scores')
      : createPublicHandler(() => f.publicApi, 'scores');
    const invalid = { score: f.score(f.declaration({ chippy: 1, pully: 1 })) };
    const rows = new Map(f.rows);
    f.submit.mockClear();
    for (const query of ['', 'dotCoexistence=1', 'dotCoexistence=2&dotCoexistence=2']) {
      expect(await writer(f.request('PUT', invalid, query), f.context))
        .toMatchObject({ status: 426, jsonBody: { code: 'DOTS_COEXISTENCE_CLIENT_UPDATE_REQUIRED' } });
    }
    expect(await writer(f.request('PUT', invalid, 'dotCoexistence=2'), f.context))
      .toMatchObject({ status: 409, jsonBody: { code: 'DOTS_SETUP_CHANGED' } });
    expect(await staged(f.request('PUT', invalid), f.context)).toMatchObject({ status: 426 });
    expect(f.rows).toEqual(rows);
    expect(f.submit).not.toHaveBeenCalled();
    const valid = { score: f.score(f.declaration({ chippy: 1 })) };
    const saved = await writer(f.request('PUT', valid, '', null, 31003), f.context);
    expect(saved.status).toBe(200);
    expect(await writer(f.request('PUT', valid, '', null, 31003), f.context)).toEqual(saved);
    const receipt = { ...f.row(`score-change:${identifier(31003)}`) };
    const capture = { ...f.row(`index-capture:${f.roundId}`) };
    for (const query of ['', 'format=lean', 'dotCoexistence=2', 'dotCoexistence=2&format=lean']) {
      const response = await reader(f.request('GET', undefined, query), f.context);
      expect(response.status).toBe(200);
      const round = decodeRoundScores(response.jsonBody);
      expect(round).not.toBeNull();
      expect(round?.dotsCoexistenceRulesVersion).toBe(query.includes('dotCoexistence=2') ? 2 : undefined);
    }
    expect(f.row(`score-change:${identifier(31003)}`)).toEqual(receipt);
    expect(f.row(`index-capture:${f.roundId}`)).toEqual(capture);
  });

  it.each([false, true])('requires explicit score-qualification repair for Dots/Churchie v3 (%s)', async (churchie) => {
    const f = await fixture(churchie);
    const saved = await f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
      f.score(f.declaration({ hogan: 1 })), null, identifier(31010));
    const etag = saved.round.cards.find((card) => card.playerId === f.playerId)?.etag ?? null;
    const writer = createScoringHandler(() => f.ownerApi, 'score-hole');
    const rows = new Map(f.rows);
    for (const [query, status] of [['', 426], ['dotCoexistence=2', 409]] as const) {
      expect(await writer(f.request('PUT', { score: { kind: 'strokes', strokes: 5 } }, query, etag, 31011), f.context))
        .toMatchObject({ status });
    }
    expect(f.rows).toEqual(rows);
    const repair = f.score(f.declaration({}), 5);
    expect(await writer(f.request('PUT', { score: repair }, 'dotCoexistence=2', etag, 31011), f.context))
      .toMatchObject({ status: 200 });
    const acknowledged = { ...f.row(`score-change:${identifier(31011)}`) };
    expect(await writer(f.request('PUT', { score: repair }, 'dotCoexistence=2', etag, 31011), f.context))
      .toMatchObject({ status: 200 });
    expect(f.row(`score-change:${identifier(31011)}`)).toEqual(acknowledged);
  });

  it('checks category-only edits with unchanged Seve against winners and second qualifiers', async () => {
    const f = await fixture(), workspace = await f.workspace.get(creator, event.id);
    const snapshot = workspace.rounds.find((round) => round.id === f.roundId);
    if (!snapshot) throw new Error('Missing fictional round');
    f.seed({ ...f.row(`round:${f.roundId}`), content: JSON.stringify({ ...snapshot,
      teeProfile: { ...snapshot.teeProfile, totalPar: snapshot.teeProfile.totalPar + 1,
        holes: snapshot.teeProfile.holes.map((hole) => hole.number === 1 ? { ...hole, par: 5 } : hole) } }) });
    const record = f.declaration({ seve: 1 });
    const saved = await f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
      f.score(record), null, identifier(31020));
    const etag = saved.round.cards.find((card) => card.playerId === f.playerId)?.etag ?? null;
    const peer = f.game.playerIds[1];
    if (!peer) throw new Error('Missing fictional second source');
    for (const contest of [
      { kind: 'long-drive' as const, status: 'awarded' as const, winnerId: f.playerId },
      { kind: 'long-drive' as const, status: 'awarded' as const, winnerId: peer, secondId: f.playerId },
    ]) {
      const rows = new Map(f.rows);
      await expect(f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
        f.score({ ...record, contests: [contest] }), etag, identifier(31021))).rejects.toMatchObject({ status: 409, code: 'DOTS_SETUP_CHANGED' });
      expect(f.rows).toEqual(rows);
    }
  });

  it('validates assembled legacy staging before commit and keeps inactive fragments available for explicit repair', async () => {
    const f = await fixture(), staged = createScoringHandler(() => f.ownerApi, 'score-game-hole');
    const bytes = Buffer.from(JSON.stringify({ score: f.score(f.declaration({ chippy: 1, pully: 1 })) }));
    const upload = { id: identifier(31030), bytes: bytes.length, parts: 1, sha256: createHash('sha256').update(bytes).digest('hex') };
    expect(await staged(f.request('PUT', { privateUpload: { ...upload, index: 0, content: bytes.toString('base64') } },
      'dotsCalls=score-v1', null, 31030), f.context)).toMatchObject({ status: 200 });
    const rows = new Map(f.rows);
    expect(await staged(f.request('PUT', { privateCommit: upload }, 'dotsCalls=score-v1', null, 31030), f.context))
      .toMatchObject({ status: 426, jsonBody: { code: 'DOTS_COEXISTENCE_CLIENT_UPDATE_REQUIRED' } });
    expect(f.rows).toEqual(rows);
    expect(await staged(f.request('PUT', { privateCommit: upload }, 'dotsCalls=score-v1&dotCoexistence=2', null, 31030), f.context))
      .toMatchObject({ status: 409 });
    expect(f.rows).toEqual(rows);
  });

  it.each([false, true])('guards Sandy/KP source selections in both directions without changing historical reads (%s)', async (churchie) => {
    const f = await fixture(churchie), workspace = await f.workspace.get(creator, event.id);
    const snapshot = workspace.rounds.find((round) => round.id === f.roundId);
    if (!snapshot) throw new Error('Missing fictional KP round');
    f.seed({ ...f.row(`round:${f.roundId}`), content: JSON.stringify({ ...snapshot,
      teeProfile: { ...snapshot.teeProfile, totalPar: snapshot.teeProfile.totalPar - 1,
        holes: snapshot.teeProfile.holes.map((hole) => hole.number === 1 ? { ...hole, par: 3 } : hole) } }) });
    const peer = f.game.playerIds[1];
    if (!peer) throw new Error('Missing fictional KP peer');
    const separate = { ...f.declaration({ sandy: 1 }),
      contests: [{ kind: 'kp' as const, status: 'awarded' as const, winnerId: peer }] };
    const saved = await f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
      f.score(separate, 3), null, identifier(31050));
    const etag = saved.round.cards.find((card) => card.playerId === f.playerId)?.etag ?? null;
    const writer = createScoringHandler(() => f.ownerApi, 'score-hole');
    for (const selection of [{ winnerId: f.playerId }, { winnerId: peer, secondId: f.playerId }]) {
      const record = { ...separate, contests: [{ kind: 'kp' as const, status: 'awarded' as const, ...selection }] };
      const rows = new Map(f.rows);
      expect(await writer(f.request('PUT', { score: f.score(record, 3) }, '', etag, 31051), f.context))
        .toMatchObject({ status: 426, jsonBody: { code: 'DOTS_COEXISTENCE_CLIENT_UPDATE_REQUIRED' } });
      expect(await writer(f.request('PUT', { score: f.score(record, 3) }, 'dotCoexistence=2', etag, 31051), f.context))
        .toMatchObject({ status: 409 });
      expect(f.rows).toEqual(rows);
    }
    const kp = { ...f.declaration({}), contests: [{ kind: 'kp' as const, status: 'awarded' as const, winnerId: f.playerId }] };
    const repaired = await f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
      f.score(kp, 3), etag, identifier(31052));
    const nextEtag = repaired.round.cards.find((card) => card.playerId === f.playerId)?.etag ?? null;
    await expect(f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
      f.score({ ...kp, players: separate.players }, 3), nextEtag, identifier(31053)))
      .rejects.toMatchObject({ status: 409 });
    const card = repaired.round.cards.find((entry) => entry.playerId === f.playerId);
    if (!card) throw new Error('Missing fictional historical card');
    const historical = f.score({ ...kp, players: separate.players }, 3);
    f.seed({ ...f.row(`score-card:${f.roundId}:${f.playerId}`), content: JSON.stringify({
      playerId: card.playerId, displayName: card.displayName, updatedAt: card.updatedAt,
      holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score: historical } : hole),
    }) });
    const current = await f.scores.get(creator, event.id, f.roundId);
    expect(decodeRoundScores(current)).not.toBeNull();
    expect(churchie ? current.games?.results[0]?.churchy?.holes[0]?.specialStatus
      : current.games?.results[0]?.dots?.status).not.toBe('unavailable');
    const originalCard = { ...f.row(`score-card:${f.roundId}:${f.playerId}`) };
    await f.scores.write(creator, event.id, f.roundId, peer, 1, { kind: 'strokes', strokes: 3 }, null, identifier(31054));
    expect(f.row(`score-card:${f.roundId}:${f.playerId}`)).toEqual(originalCard);
  });

  it('permits unrelated raw tester peer writes but prevents a hidden valid claim becoming invalid', async () => {
    const f = await testerFixture();
    const game: DotsGameDefinition = { id: identifier(31040), name: 'Fictional hidden Dots', kind: 'dots', version: 1,
      groupNumber: 1, playerIds: f.input.playerIds.slice(0, 4), mode: 'individual', stakeMinor: null,
      specials: [{ kind: 'hogan', units: 1 }] };
    const setup = await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(31041));
    const record = { number: 1, gameId: game.id, gameEtag: setup.round.games?.configuration.etag ?? '', contests: [],
      players: [{ playerId: f.playerId, counts: { hogan: 1 }, calls: [] }] };
    const saved = await f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, dots: [record] }, null, identifier(31042));
    const peer = game.playerIds[1];
    if (!peer) throw new Error('Missing fictional peer');
    expect((await f.scores.write(f.actor, event.id, f.roundId, peer, 1,
      { kind: 'strokes', strokes: 5 }, null, identifier(31043))).change.after).not.toHaveProperty('dots');
    const etag = saved.round.cards.find((card) => card.playerId === f.playerId)?.etag ?? null;
    const rows = new Map(f.rows);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 5 }, etag, identifier(31044))).rejects.toMatchObject({ status: 426 });
    expect(f.rows).toEqual(rows);
  });

  it('replays a committed staged request after explicit repair and later peer scores without reintroducing old claims', async () => {
    const f = await fixture(), stage = createScoringHandler(() => f.ownerApi, 'score-game-hole');
    const peer = f.game.playerIds[1];
    if (!peer) throw new Error('Missing fictional replay peer');
    const original = f.score({ ...f.declaration({}),
      players: [{ playerId: peer, counts: { hogan: 1 }, calls: [] }] });
    const saved = await stage(f.request('PUT', { score: original }, 'dotCoexistence=2', null, 31060), f.context);
    expect(saved.status).toBe(200);
    const round = await f.scores.get(creator, event.id, f.roundId);
    const etag = round.cards.find((card) => card.playerId === f.playerId)?.etag ?? null;
    await f.scores.write(creator, event.id, f.roundId, f.playerId, 1, f.score(f.declaration({})), etag, identifier(31061));
    await f.scores.write(creator, event.id, f.roundId, peer, 1, { kind: 'strokes', strokes: 5 }, null, identifier(31062));
    const rows = new Map(f.rows);
    expect(await stage(f.request('PUT', { score: original }, 'dotCoexistence=2', null, 31060), f.context))
      .toMatchObject({ status: 200 });
    expect(f.rows).toEqual(rows);
  });
});
