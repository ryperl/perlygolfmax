import { HttpRequest, InvocationContext } from '@azure/functions';
import { coexistenceRoundScores } from '../../../src/contracts/dot-coexistence.js';
import { gameHandicapRoundScores } from '../../../src/contracts/game-handicaps.js';
import { describe, expect, it, vi } from 'vitest';
import type { DotsCall, DotsGameDefinition, DotsHoleRecord } from '../../../src/domain/dots.js';
import type { HoleScore, RoundScores } from '../../../src/domain/scoring.js';
import { DotsCallsClientUpdateRequired, murphyRoundScores } from '../../../src/domain/murphy-transport.js';
import * as compatibility from '../../../src/domain/murphy-transport.js';
import { decodeRoundScores, isScoreHistoryPage, isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { leanRoundScores, leanScoreWriteResult } from '../../../src/contracts/lean-round-scores.js';
import { isRecord } from '../../../src/contracts/events.js';
import { publicFixture } from '../public-access/test-support.js';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { createScoringHandler } from './handlers.js';
import { createPublicHandler } from '../public-access/handlers.js';
import { murphyTransport } from './murphy-transport.js';
import { TablePurseStore } from '../purse/store.js';
import { createHash } from 'node:crypto';
import { privateReadResponse } from '../private-transport.js';
import { privateReadPartCharacters } from '../../../src/contracts/private-values.js';

const etag = (round: RoundScores, playerId: string) => round.cards.find((card) => card.playerId === playerId)?.etag ?? null;
const context = () => new InvocationContext({ invocationId: 'fictional-dots-calls', logHandler: () => undefined });

async function fixture(string = false) {
  const f = await publicFixture();
  const game: DotsGameDefinition = { id: identifier(28000), name: 'Fictional Dots calls', kind: 'dots', version: 1,
    mode: 'fixed', partnerIds: f.input.playerIds.slice(0, 4), groupNumber: 1, playerIds: f.input.playerIds.slice(0, 4),
    stakeMinor: 50, specials: [{ kind: 'paree', units: 2 }, { kind: 'murphy', units: 3 }, { kind: 'sandy', units: 1 }, { kind: 'pully', units: 1 },
      ...(string ? [{ kind: 'string' as const, units: 1 }] : [])] };
  const round = (await f.scores.saveGames(f.actor, event.id, f.roundId, [game], null, identifier(28001))).round;
  const source = game.playerIds[1];
  if (!source) throw new Error('Missing fictional source');
  const paree: DotsCall = { id: identifier(28002), kind: 'paree', result: 'pending', pareeTarget: 'par' };
  const murphy: DotsCall = { id: identifier(28003), kind: 'murphy', result: 'pending', murphyTarget: 'birdie', murphyPresses: 2 };
  const record = (calls: readonly DotsCall[] = [paree]): DotsHoleRecord => ({
    number: 1, gameId: game.id, gameEtag: round.games?.configuration.etag ?? 'missing',
    players: [{ playerId: source, counts: {}, calls }], contests: [],
  });
  const api = { ...f, verify: vi.fn().mockResolvedValue(creator), limiter: { check: vi.fn().mockResolvedValue(undefined) } };
  const request = (search = '', method = 'GET', body?: unknown, expected: string | null = null, requestId = identifier(28010)) =>
    new HttpRequest({ url: `https://fictional.example.test/api/fixture?${search}`, method,
      params: { id: event.id, roundId: f.roundId, playerId: f.playerId, holeNumber: '1' },
      headers: { authorization: 'Bearer fictional', 'Content-Type': 'application/json', 'Idempotency-Key': requestId,
        ...(expected === null ? { 'If-None-Match': '*' } : { 'If-Match': expected }) },
      ...(body === undefined ? {} : { body: { string: JSON.stringify(body) } }) });
  return { ...f, game, round, source, paree, murphy, record, api, request };
}

describe('ordinary Dots authoritative calls and independent transport', () => {
  it('resolves peer raw corrections dynamically, preserving anchor/capture receipts, repeated calls, retry identity and private audits', async () => {
    const f = await fixture();
    const declaration = f.record([f.paree, { ...f.paree, id: identifier(28100) }, f.murphy]);
    let round = (await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, dots: [declaration] }, null, identifier(28101))).round;
    const anchor = { ...f.row(`score-card:${f.roundId}:${f.playerId}`) }, capture = { ...f.row(`index-capture:${f.roundId}`) };
    for (const [index, score] of ([{ kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 4 },
      { kind: 'strokes', strokes: 5 }, { kind: 'picked-up', reportedStrokes: 7 }, { kind: 'did-not-finish' },
      { kind: 'unplayed' }] satisfies readonly HoleScore[]).entries()) {
      const expected = etag(round, f.source), requestId = identifier(28110 + index);
      f.submit.mockClear();
      const saved = await f.scores.write(f.actor, event.id, f.roundId, f.source, 1, score, expected, requestId);
      expect(f.submit).toHaveBeenCalledOnce();
      const awards = saved.round.games?.results[0]?.dots?.awards;
      if (score.kind === 'unplayed') expect(awards).toEqual([]);
      else {
        expect(awards?.filter((award) => award.kind === 'paree')).toHaveLength(2);
        expect(awards?.find((award) => award.kind === 'murphy')).toMatchObject({ units: 3, count: 3, dots: 9, multiplier: 1,
          recipientIds: index === 0 ? f.game.playerIds.slice(0, 2) : f.game.playerIds.slice(2) });
      }
      expect(f.row(`score-card:${f.roundId}:${f.playerId}`)).toEqual(anchor);
      expect(f.row(`index-capture:${f.roundId}`)).toEqual(capture);
      expect(saved.round.cards[0]?.holes[0]?.score.dots).toEqual([declaration]);
      expect(isScoreWriteResult(saved)).toBe(true);
      expect(decodeRoundScores(leanRoundScores(saved.round, true, true, true, true))?.cards).toEqual(saved.round.cards);
      expect(await f.scores.write(f.actor, event.id, f.roundId, f.source, 1, score, expected, requestId)).toEqual(saved);
      round = saved.round;
    }
    const history = await f.scores.history(creator, event.id, f.roundId, f.source);
    expect(history.changes.flatMap((change) => change.dotAwardAudit ?? []).some((audit) =>
      audit.after.some((award) => award.kind === 'murphy' && award.count === 3))).toBe(true);
  });

  it('projects representable calls for old readers and preserves same-ID target/zero stage on old echoes, without inventing historical outcomes', async () => {
    const f = await fixture();
    const calls: readonly DotsCall[] = [f.paree, { ...f.murphy, murphyPresses: 0 }];
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, dots: [f.record(calls)] }, null, identifier(28200));
    const current = await f.scores.write(f.actor, event.id, f.roundId, f.source, 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(28201));
    const legacy = murphyRoundScores(current.round, true, true);
    const projected = legacy.cards[0]?.holes[0]?.score;
    expect(projected?.dots?.[0]?.players[0]?.calls).toEqual([
      { id: f.paree.id, kind: 'paree', result: 'success' }, { id: f.murphy.id, kind: 'murphy', result: 'failure' },
    ]);
    expect(decodeRoundScores(leanRoundScores(current.round, true, true, true))).toEqual(gameHandicapRoundScores(coexistenceRoundScores(legacy)));
    if (!projected?.dots) throw new Error('Missing fictional projection');
    const echoed = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, projected,
      etag(current.round, f.playerId), identifier(28202), undefined, true, false);
    expect(echoed.change.after.dots?.[0]?.players[0]?.calls).toEqual(calls);
    expect(await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, projected,
      etag(current.round, f.playerId), identifier(28202), undefined, true, true)).toEqual(echoed);
    const rows = new Map(f.rows);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, { ...projected,
      dots: [f.record([{ id: f.paree.id, kind: 'paree', result: 'failure' }])] },
    etag(echoed.round, f.playerId), identifier(28203), undefined, true, false)).rejects.toMatchObject({ code: 'DOTS_CALL_REFRESH_REQUIRED' });
    expect(f.rows).toEqual(rows);
    const historical = murphyTransport({ changes: [saved.change] }, true, true, true);
    expect(isScoreHistoryPage(historical)).toBe(true);
    expect(isRecord(historical) && JSON.stringify(historical)).toContain('"result":"pending"');
  });

  it('rejects newly resolved source conflicts atomically but permits a missed birdie Murphy on par with valid Sandy/Pully', async () => {
    const f = await fixture(), declaration = f.record([f.paree]);
    const withCounts = { ...declaration, players: declaration.players.map((player) => ({ ...player, counts: { sandy: 2, pully: 1 } })) };
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, dots: [withCounts] }, null, identifier(28210));
    const before = new Map(f.rows);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.source, 1,
      { kind: 'strokes', strokes: 5 }, null, identifier(28211))).rejects.toMatchObject({ code: 'DOTS_SETUP_CHANGED' });
    expect(f.rows).toEqual(before);
    const repaired = { ...withCounts, players: withCounts.players.map((player) => ({ ...player, calls: [f.murphy] })) };
    const edited = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, dots: [repaired] }, etag(saved.round, f.playerId), identifier(28212));
    const result = await f.scores.write(f.actor, event.id, f.roundId, f.source, 1,
      { kind: 'strokes', strokes: 4 }, etag(edited.round, f.source), identifier(28213));
    expect(result.round.games?.results[0]?.dots?.awards).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'murphy', dots: 9, recipientIds: f.game.playerIds.slice(2) }),
      expect.objectContaining({ kind: 'sandy', count: 2, recipientIds: f.game.playerIds.slice(0, 2) }),
      expect.objectContaining({ kind: 'pully', count: 1, recipientIds: f.game.playerIds.slice(0, 2) }),
    ]));
  });

  it('projects nested aggregate rounds once before digest paging without losing negotiated markers', async () => {
    const f = await fixture();
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, dots: [f.record([f.murphy])] }, null, identifier(28220));
    const value = { source: { roundScores: Array.from({ length: 40 }, () => saved.round) } };
    const project = vi.spyOn(compatibility, 'murphyRoundScores');
    const projected = murphyTransport(value, false, false, true, true);
    expect(project).toHaveBeenCalledTimes(40);
    expect(project).toHaveBeenNthCalledWith(1, saved.round, false, false, true);
    project.mockRestore();
    const first = privateReadResponse(f.request(), projected);
    if (!isRecord(first) || !isRecord(first.privateRead)) throw new Error('Missing fictional digest page');
    const page = first.privateRead;
    expect(typeof page.parts === 'number' && page.parts > 1).toBe(true);
    expect(page.content).toBe(JSON.stringify(projected).slice(0, privateReadPartCharacters));
    const second = privateReadResponse(f.request(`privatePart=1&privateHash=${String(page.sha256)}`), projected);
    if (!isRecord(second) || !isRecord(second.privateRead)) throw new Error('Missing fictional second page');
    expect(second.privateRead.sha256).toBe(page.sha256);
    expect(second.privateRead.content).toBe(JSON.stringify(projected).slice(privateReadPartCharacters, 2 * privateReadPartCharacters));
    expect(() => privateReadResponse(f.request(`privatePart=1&privateHash=${String(page.sha256)}`),
      murphyTransport({ source: { roundScores: [saved.round] } }, false, false, true, true))).toThrow('EVENT_CHANGED');
  });

  it('requires String and ordinary-call negotiation independently when both authoritative rules affect the same round', async () => {
    const f = await fixture(true);
    let round = (await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, dots: [f.record([f.murphy])] }, null, identifier(28230))).round;
    for (const hole of [1, 2, 3]) round = (await f.scores.write(f.actor, event.id, f.roundId, f.source, hole,
      { kind: 'strokes', strokes: hole === 1 ? 3 : 4 }, etag(round, f.source), identifier(28230 + hole))).round;
    const read = createPublicHandler(() => f.api, 'scores');
    expect(await read(f.request('dotsCalls=score-v1&format=lean'), context())).toMatchObject({ status: 426,
      jsonBody: { code: 'STRING_RULES_CLIENT_UPDATE_REQUIRED' } });
    expect(await read(f.request('stringRules=2&format=lean'), context())).toMatchObject({ status: 426,
      jsonBody: { code: 'DOTS_CALLS_CLIENT_UPDATE_REQUIRED' } });
    const current = await read(f.request('dotsCalls=score-v1&stringRules=2&format=lean'), context());
    expect(decodeRoundScores(current.jsonBody)).toMatchObject({ dotsCallTargets: true, stringRulesVersion: 2 });
    const rows = new Map(f.rows);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.source, 1, { kind: 'strokes', strokes: 4 },
      etag(round, f.source), identifier(28234), undefined, false, true)).rejects.toMatchObject({ code: 'STRING_RULES_CLIENT_UPDATE_REQUIRED' });
    expect(f.rows).toEqual(rows);
  });

  it('rejects a legacy raw-only correction before publication when a zero-stage linked call would acquire an unrepresentable hole multiplier', async () => {
    const f = await fixture();
    const wolf = { id: identifier(28240), name: 'Fictional linked Wolf', kind: 'wolf' as const, version: 2 as const,
      basis: 'gross' as const, groupNumber: 1, playerIds: f.game.playerIds, allowPig: true, stakeMinor: null };
    const game: DotsGameDefinition = { id: f.game.id, name: f.game.name, kind: 'dots', version: 1, mode: 'linked',
      linkedGameId: wolf.id, groupNumber: 1, playerIds: f.game.playerIds, specials: [{ kind: 'paree', units: 2 }] };
    const round = (await f.scores.saveGames(f.actor, event.id, f.roundId, [wolf, game],
      f.round.games?.configuration.etag ?? null, identifier(28241))).round;
    const gameEtag = round.games?.configuration.etag ?? 'missing';
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, { kind: 'strokes', strokes: 4,
      dots: [{ ...f.record([f.paree]), gameEtag }],
      wolf: [{ number: 1, choice: { gameId: wolf.id, gameEtag, mode: 'blind' } }],
    }, null, identifier(28242));
    expect(() => murphyRoundScores(saved.round, true, true, false)).not.toThrow();
    const rows = new Map(f.rows);
    f.submit.mockClear();
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.source, 1, { kind: 'strokes', strokes: 4 },
      null, identifier(28243), undefined, true, false)).rejects.toMatchObject({ status: 426 });
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.rows).toEqual(rows);
    const modern = await f.scores.write(f.actor, event.id, f.roundId, f.source, 1, { kind: 'strokes', strokes: 4 },
      null, identifier(28243), undefined, true, true);
    expect(modern.round.games?.results.find((result) => result.gameId === game.id)?.dots?.awards[0])
      .toMatchObject({ kind: 'paree', count: 1, units: 2, multiplier: 1, dots: 2, recipientIds: f.game.playerIds.slice(1) });
    expect(() => murphyRoundScores(modern.round, true, true, false)).toThrow(DotsCallsClientUpdateRequired);
  });

  it.each(['owner', 'public'] as const)('keeps full/lean %s negotiation separate from Churchie/String, and rejects legacy mutations before writes/staging', async (role) => {
    const f = await fixture();
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, dots: [f.record([f.murphy])] }, null, identifier(28300));
    const read = role === 'owner' ? createScoringHandler(() => f.api, 'scores') : createPublicHandler(() => f.api, 'scores');
    for (const format of ['', '&format=lean']) {
      expect(await read(f.request(`murphy=score-v1&paree=score-v1&stringRules=2${format}`), context())).toMatchObject({ status: 426 });
      const current = await read(f.request(`dotsCalls=score-v1&stringRules=2${format}`), context());
      expect(current.status).toBe(200);
      expect(decodeRoundScores(current.jsonBody)?.dotsCallTargets).toBe(true);
      expect(decodeRoundScores(current.jsonBody)?.churchyMurphyTargets).toBeUndefined();
      const decoded = decodeRoundScores(current.jsonBody);
      expect(decodeRoundScores({ ...decoded, dotsCallTargets: false })).toBeNull();
      expect(decodeRoundScores({ ...decoded, internalGamesSupported: false })).toBeNull();
    }
    expect(await read(f.request('dotsCalls=score-v1&dotsCalls=score-v1'), context())).toMatchObject({ status: 426 });
    const write = role === 'owner' ? createScoringHandler(() => f.api, 'score-hole') : createPublicHandler(() => f.api, 'score-hole');
    const before = new Map(f.rows);
    f.submit.mockClear();
    expect(await write(f.request('stringRules=2', 'PUT', { score: { kind: 'strokes', strokes: 5 } },
      etag(saved.round, f.playerId), identifier(28301)), context())).toMatchObject({ status: 426 });
    await expect(f.scores.receiveGameScore(f.actor, event.id, f.roundId, f.playerId, 1,
      { privateUpload: {} }, etag(saved.round, f.playerId), identifier(28302), true, false)).rejects.toMatchObject({ status: 426 });
    await expect(f.scores.receiveGames(f.actor, event.id, f.roundId, { privateUpload: {} },
      saved.round.games?.configuration.etag ?? null, identifier(28303), true, false)).rejects.toMatchObject({ status: 426 });
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.rows).toEqual(before);
    expect(() => leanScoreWriteResult(saved, true, true, true)).toThrow(DotsCallsClientUpdateRequired);
    expect(() => murphyTransport({ roundScores: [saved.round] }, true, true, true)).toThrow(DotsCallsClientUpdateRequired);
    const modern = murphyTransport({ roundScores: [saved.round] }, false, false, true, true);
    expect(isRecord(modern) && JSON.stringify(modern)).toContain('"murphyPresses":2');
    const tester = murphyRoundScores({ ...saved.round, permissions: { role: 'tester', writePlayerIds: [], canManageGames: false } }, true, true, true);
    expect(tester.dotsCallTargets).toBeUndefined();
  });

  it('refuses old-client purse staging/publication before changing any rows, while modern money saves remain valid', async () => {
    const f = await fixture();
    await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, dots: [f.record([f.murphy])] }, null, identifier(28400));
    const store = new TablePurseStore(f.table, f.workspace, f.scores), charge = vi.fn().mockResolvedValue(undefined);
    const plan = { eventId: event.id, currency: 'USD' as const, funding: { kind: 'fixed' as const, budgetMinor: 100 }, pools: [] };
    const before = new Map(f.rows), content = JSON.stringify({ plan, resolutions: [] });
    const body = { privateUpload: { id: identifier(28401), parts: 1, index: 0, bytes: Buffer.byteLength(content),
      sha256: createHash('sha256').update(content).digest('hex'), content: Buffer.from(content).toString('base64') } };
    await expect(store.receive(creator, event.id, null, identifier(28402), body, true, false, charge)).rejects.toMatchObject({ status: 426 });
    await expect(store.save(creator, event.id, plan, [], null, identifier(28403), charge, undefined, true, false)).rejects.toMatchObject({ status: 426 });
    expect(f.rows).toEqual(before);
    const current = await store.save(creator, event.id, plan, [], null, identifier(28403), charge, undefined, true, true);
    expect(current.change.after.plan).toEqual(plan);
  });
});
