import { HttpRequest, InvocationContext } from '@azure/functions';
import { coexistenceRoundScores } from '../../../src/contracts/dot-coexistence.js';
import { gameHandicapRoundScores } from '../../../src/contracts/game-handicaps.js';
import { gameCalculationRoundScores } from '../../../src/contracts/game-calculations.js';
import { wolfOrderRoundScores } from '../../../src/contracts/wolf-orders.js';
import { dotsHighLowRoundScores } from '../../../src/contracts/dots-high-low-rules.js';
import { dotsRulesV3RoundScores } from '../../../src/contracts/dots-rules-v3.js';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ChurchyGameDefinitionV3, ChurchySpecialsV3 } from '../../../src/domain/churchy.js';
import type { DotsPlayerDeclaration } from '../../../src/domain/dots.js';
import type { HoleScore, RoundScores } from '../../../src/domain/scoring.js';
import { murphyRoundScores } from '../../../src/domain/murphy-transport.js';
import { decodeRoundScores, isRoundScores, isScoreHistoryPage, isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { isRecord } from '../../../src/contracts/events.js';
import { publicFixture } from '../public-access/test-support.js';
import { testerFixture } from '../test-access/test-support.js';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { createScoringHandler } from './handlers.js';
import type { ScoringAction } from './handlers.js';
import { createPublicHandler } from '../public-access/handlers.js';
import { createTesterHandler } from '../test-access/handlers.js';
import { murphyTransport } from './murphy-transport.js';
import * as murphyCompatibility from '../../../src/domain/murphy-transport.js';
import * as scoringContract from '../../../src/contracts/scoring.js';
import { leanRoundScores } from '../../../src/contracts/lean-round-scores.js';
import { privateReadPartCharacters } from '../../../src/contracts/private-values.js';

const etag = (round: RoundScores, playerId: string) => round.cards.find((card) => card.playerId === playerId)?.etag ?? null;

async function fixture() {
  const f = await publicFixture();
  for (const [index, playerId] of f.input.playerIds.slice(0, 4).entries()) {
    const profile = await f.players.get(creator, playerId);
    await f.players.observe(creator, playerId, identifier(26010 + index), {
      value: '0.0', effectiveDate: '2026-01-01', source: 'Fictional Murphy test',
    }, profile.etag);
  }
  const workspace = await f.workspace.get(creator, event.id);
  await f.workspace.refreshIndices(creator, event.id, f.roundId, identifier(26014), workspace.etag);
  const game: ChurchyGameDefinitionV3 = { id: identifier(26000), name: 'Churchie', kind: 'churchy', version: 3,
    basis: 'net', groupNumber: 1, playerIds: f.input.playerIds.slice(0, 4), orderMode: 'approach',
    amountPerDotMinor: 50, currency: 'USD', specials: [{ kind: 'murphy', units: 1 }, { kind: 'sandy', units: 1 },
      { kind: 'pully', units: 1 }, { kind: 'birdie', units: 2 }, { kind: 'eagle', units: 4 }, { kind: 'string', units: 1 }] };
  const round = (await f.scores.saveGames(f.actor, event.id, f.roundId, [game], null, identifier(26001))).round;
  const source = game.playerIds[1];
  if (!source) throw new Error('Missing fictional source');
  const extras = (playerId = source, murphyTarget: 'par' | 'birdie' = 'par',
    counts: DotsPlayerDeclaration['counts'] = {}): ChurchySpecialsV3 => ({
    version: 3, gameId: game.id, gameEtag: round.games?.configuration.etag ?? 'missing', number: 1,
    rotation: { playerIds: game.playerIds }, contests: [], players: [{ playerId, counts, calls: [{
      id: identifier(26002), kind: 'murphy', result: 'pending', murphyTarget, murphyPresses: 2,
    }] }],
  });
  return { ...f, game, round, source, extras };
}

describe('score-derived Murphy authoritative persistence and negotiation', () => {
  it.each([false, true])('projects public full/lean reads and save acknowledgements once with negotiated=%s', async (negotiated) => {
    const f = await fixture();
    const initial = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy: f.extras(f.playerId, 'birdie', { sandy: 1, pully: 1 }) },
      null, identifier(26800));
    const api = { ...f, limiter: { check: vi.fn().mockResolvedValue(undefined) } };
    const context = new InvocationContext({ invocationId: 'fictional-single-projection', logHandler: () => undefined });
    const project = vi.spyOn(murphyCompatibility, 'murphyRoundScores');
    const validate = vi.spyOn(scoringContract, 'isRoundScores');
    try {
      for (const lean of [false, true]) for (const write of [false, true]) {
        project.mockClear();
        validate.mockClear();
        const request = new HttpRequest({
          url: `https://fictional.example.test/api/fixture?stringRules=2&${lean ? 'format=lean&' : ''}${negotiated ? 'murphy=score-v1' : ''}`,
          method: write ? 'PUT' : 'GET',
          params: { id: event.id, roundId: f.roundId, playerId: f.playerId, holeNumber: '1' },
          headers: { 'Content-Type': 'application/json', 'If-Match': etag(initial.round, f.playerId) ?? '',
            'Idempotency-Key': identifier(26801) },
          ...(write ? { body: { string: JSON.stringify({ score: { kind: 'strokes', strokes: 4 } }) } } : {}),
        });
        const result = await createPublicHandler(() => api, write ? 'score-hole' : 'scores')(request, context);
        expect(result.status).toBe(200);
        expect.soft(project, `${lean ? 'lean' : 'full'} ${write ? 'save' : 'GET'}`).toHaveBeenCalledTimes(1);
        expect.soft(validate.mock.calls.filter(([value]) => isRecord(value) && value.roundId === f.roundId).length,
          `${lean ? 'lean' : 'full'} ${write ? 'save' : 'GET'} redundant round detection`).toBe(lean ? 0 : 1);
        const decoded = decodeRoundScores(write && isRecord(result.jsonBody) ? result.jsonBody.round : result.jsonBody);
        expect(decoded).not.toBeNull();
        expect(decoded?.churchyMurphyTargets).toBe(negotiated ? true : undefined);
        expect(JSON.stringify(result.jsonBody).includes('"murphyTarget"')).toBe(negotiated);
        expect(decoded?.games?.results).toEqual(murphyCompatibility.murphyRoundScores(initial.round, negotiated).games?.results);
      }
    } finally { project.mockRestore(); validate.mockRestore(); }
  });

  it.each([false, true])('retains negotiated public digest paging and stale-page rejection with lean=%s', async (lean) => {
    const f = await fixture();
    const initial = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy: f.extras(f.playerId, 'birdie') }, null, identifier(26810));
    const api = { ...f, limiter: { check: vi.fn().mockResolvedValue(undefined) } };
    const context = new InvocationContext({ invocationId: 'fictional-negotiated-pages', logHandler: () => undefined });
    for (const negotiated of [false, true]) {
      const expected = lean ? leanRoundScores(initial.round, negotiated, false, true)
        : dotsHighLowRoundScores(wolfOrderRoundScores(gameCalculationRoundScores(gameHandicapRoundScores(coexistenceRoundScores(murphyRoundScores(dotsRulesV3RoundScores(initial.round), negotiated))))));
      const text = JSON.stringify(expected);
      const sha256 = createHash('sha256').update(text).digest('hex');
      const request = (hash: string, index = 0) => new HttpRequest({
        url: `https://fictional.example.test/api/fixture?stringRules=2&${lean ? 'format=lean&' : ''}${negotiated ? 'murphy=score-v1&' : ''}privatePart=${String(index)}&privateHash=${hash}`,
        method: 'GET', params: { id: event.id, roundId: f.roundId },
      });
      const parts = Math.ceil(text.length / privateReadPartCharacters);
      for (let index = 0; index < parts; index++) {
        const result = await createPublicHandler(() => api, 'scores')(request(sha256, index), context);
        expect(result).toMatchObject({ status: 200, jsonBody: {
          privateRead: { sha256, index, parts, bytes: Buffer.byteLength(text),
            content: text.slice(index * privateReadPartCharacters, (index + 1) * privateReadPartCharacters) },
        } });
      }
      expect(await createPublicHandler(() => api, 'scores')(request('0'.repeat(64)), context))
        .toMatchObject({ status: 409, jsonBody: { code: 'EVENT_CHANGED' } });
    }
  });

  it.each(['par', 'birdie'] as const)('recalculates %s calls on another card in one transaction without rewriting the canonical declaration', async (target) => {
    const f = await fixture(), declaration = f.extras(f.source, target);
    const initial = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy: declaration }, null, identifier(26100));
    const anchor = { ...f.row(`score-card:${f.roundId}:${f.playerId}`) };
    const capture = { ...f.row(`index-capture:${f.roundId}`) };
    let round = initial.round;
    for (const [index, value] of [3, 5, 4].entries()) {
      f.submit.mockClear();
      const saved = await f.scores.write(f.actor, event.id, f.roundId, f.source, 1,
        { kind: 'strokes', strokes: value }, etag(round, f.source), identifier(26101 + index));
      const result = value <= (target === 'par' ? 4 : 3) ? 'success' : 'failure';
      expect(saved.round.games?.results[0]?.churchy?.awards).toContainEqual(expect.objectContaining({
        kind: 'murphy', earnedBy: f.source, dots: 3, count: 3, reason: `Murphy call: ${result}.`,
        recipientIds: result === 'success' ? [f.game.playerIds[1], f.game.playerIds[2]] : [f.game.playerIds[0], f.game.playerIds[3]],
      }));
      expect(f.submit).toHaveBeenCalledOnce();
      expect(f.row(`score-card:${f.roundId}:${f.playerId}`)).toEqual(anchor);
      expect(f.row(`index-capture:${f.roundId}`)).toEqual(capture);
      expect(saved.round.cards.find((card) => card.playerId === f.playerId)?.holes[0]?.score.churchy).toEqual(declaration);
      expect(isScoreWriteResult(saved)).toBe(true);
      round = saved.round;
    }
    const history = await f.scores.history(creator, event.id, f.roundId, f.source);
    expect(history.changes.some((change) => change.dotAwardAudit?.some((audit) =>
      audit.after.some((award) => award.kind === 'murphy' && award.earnedBy === f.source)))).toBe(true);
  });

  it('accepts a missed birdie at gross par with BOTH Sandy and Pully, but denies newly unqualified bogey/X7/DNF without writes', async () => {
    const f = await fixture(), declaration = f.extras(f.source, 'birdie', { sandy: 1, pully: 1 });
    const initial = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy: declaration }, null, identifier(26200));
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.source, 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(26201));
    expect(saved.round.games?.results[0]?.churchy?.awards).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'murphy', earnedBy: f.source, reason: 'Murphy call: failure.', dots: 3 }),
      expect.objectContaining({ kind: 'sandy', earnedBy: f.source, dots: 1 }),
      expect.objectContaining({ kind: 'pully', earnedBy: f.source, dots: 1 }),
    ]));
    expect(isRoundScores(murphyRoundScores(saved.round))).toBe(true);
    const rows = new Map(f.rows);
    for (const [index, score] of ([{ kind: 'strokes', strokes: 5 }, { kind: 'picked-up', reportedStrokes: 7 },
      { kind: 'did-not-finish' }] satisfies readonly HoleScore[]).entries()) {
      f.submit.mockClear();
      await expect(f.scores.write(f.actor, event.id, f.roundId, f.source, 1, score,
        etag(saved.round, f.source), identifier(26202 + index))).rejects.toMatchObject({ code: 'CHURCHY_SETUP_CHANGED' });
      expect(f.submit).not.toHaveBeenCalled();
      expect(f.rows).toEqual(rows);
    }
    expect(etag(saved.round, f.playerId)).toBe(etag(initial.round, f.playerId));
  });

  it('denies a first score resolving a pending par call against unchanged same-source manual claims, not a teammate claim', async () => {
    const f = await fixture();
    const initial = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy: f.extras(f.source, 'par', { sandy: 1 }) }, null, identifier(26300));
    const rows = new Map(f.rows);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.source, 1,
      { kind: 'strokes', strokes: 5 }, null, identifier(26301))).rejects.toMatchObject({ code: 'CHURCHY_SETUP_CHANGED' });
    expect(f.rows).toEqual(rows);
    const repaired = f.extras(f.source, 'par');
    const withPeer = { ...repaired, players: [...repaired.players, { playerId: f.playerId, counts: { sandy: 1 }, calls: [] }] };
    const edit = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy: withPeer }, etag(initial.round, f.playerId), identifier(26302));
    const scored = await f.scores.write(f.actor, event.id, f.roundId, f.source, 1,
      { kind: 'strokes', strokes: 5 }, null, identifier(26303));
    expect(scored.change.after).toEqual({ kind: 'strokes', strokes: 5 });
    expect(etag(scored.round, f.playerId)).toBe(etag(edit.round, f.playerId));
  });

  it('retains a same-ID target from legacy echoes, rejects manual overrides, and replays original intent after lost acknowledgements and later scores', async () => {
    const f = await fixture();
    const initial = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy: f.extras(f.playerId, 'birdie') }, null, identifier(26400));
    const legacy = murphyRoundScores(initial.round);
    const raw = legacy.cards.find((card) => card.playerId === f.playerId)?.holes[0]?.score;
    if (raw?.kind !== 'strokes' || raw.churchy?.version !== 3) throw new Error('Missing fictional projected declaration');
    const score = { ...raw, churchy: { ...raw.churchy, players: raw.churchy.players.map((player) => ({ ...player,
      counts: { sandy: 1, pully: 1 }, calls: player.calls.map((call) => ({ ...call, murphyPresses: 1 as const })) })) } };
    const expected = etag(initial.round, f.playerId), requestId = identifier(26401);
    f.submit.mockImplementationOnce((actions) => { f.apply(actions); return Promise.reject(new Error('Fictional lost acknowledgement')); });
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, score, expected, requestId);
    expect(JSON.stringify(saved)).not.toContain('requestHash');
    expect(saved.change.after.churchy).toMatchObject({ players: [{ calls: [{ id: identifier(26002), murphyTarget: 'birdie', result: 'pending', murphyPresses: 1 }] }] });
    expect((await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, score, expected, requestId)).change).toEqual(saved.change);
    const corrected = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3 }, etag(saved.round, f.playerId), identifier(26402));
    expect((await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, score, expected, requestId)).change).toEqual(saved.change);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, score,
      etag(corrected.round, f.playerId), identifier(26403))).rejects.toMatchObject({ code: 'CHURCHY_MURPHY_REFRESH_REQUIRED' });
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, { ...score, strokes: 3 }, expected, requestId))
      .rejects.toMatchObject({ code: 'SCORE_REQUEST_CONFLICT' });
  });

  it('refuses stale legacy outcome echoes after a peer correction and retains the event/card atomic guards for modern edits', async () => {
    const f = await fixture();
    const initial = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy: f.extras() }, null, identifier(26410));
    const success = await f.scores.write(f.actor, event.id, f.roundId, f.source, 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(26411));
    const echo = murphyRoundScores(success.round).cards.find((card) => card.playerId === f.playerId)?.holes[0]?.score;
    if (echo?.churchy?.version !== 3) throw new Error('Missing fictional echo');
    await f.scores.write(f.actor, event.id, f.roundId, f.source, 1,
      { kind: 'strokes', strokes: 5 }, etag(success.round, f.source), identifier(26412));
    f.submit.mockClear();
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, echo,
      etag(initial.round, f.playerId), identifier(26413))).rejects.toMatchObject({ code: 'CHURCHY_MURPHY_REFRESH_REQUIRED' });
    expect(f.submit).not.toHaveBeenCalled();
    const anchor = { ...f.row(`score-card:${f.roundId}:${f.playerId}`) };
    const modern = f.extras();
    f.submit.mockImplementationOnce((actions) => {
      f.seed({ ...f.row('event'), name: 'Fictional concurrent event edit' });
      f.apply(actions);
      return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
    });
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy: { ...modern, players: modern.players.map((player) => ({ ...player,
        calls: player.calls.map((call) => ({ ...call, murphyPresses: 1 as const })) })) } },
      etag(initial.round, f.playerId), identifier(26414))).rejects.toMatchObject({ code: 'SCORECARD_CHANGED' });
    expect(f.row(`score-card:${f.roundId}:${f.playerId}`)).toEqual(anchor);
    expect(f.rows.has(`${event.id}|score-change:${identifier(26414)}`)).toBe(false);
  });

  it.each(['round-games', 'round-kp', 'public-games'] as const)('negotiates markers/capability for full and lean %s mutation wrappers', async (action) => {
    const f = await fixture();
    const initial = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy: f.extras(f.playerId, 'birdie') }, null, identifier(26700));
    const selection = { version: 1 as const, context: 'fictional-kp-context', status: 'open' as const, decisions: [] };
    if (action === 'round-kp') vi.spyOn(f.scores, 'saveKp').mockResolvedValue({
      round: initial.round, requestId: identifier(26701), expectedEtag: null, selection,
    });
    const api = { ...f, verify: vi.fn().mockResolvedValue(creator), limiter: { check: vi.fn().mockResolvedValue(undefined) } };
    for (const lean of [false, true]) for (const negotiated of [false, true]) {
      const request = new HttpRequest({
        url: `https://fictional.example.test/api/fixture?stringRules=2&${lean ? 'format=lean&' : ''}${negotiated ? 'murphy=score-v1' : ''}`,
        method: 'PUT', params: { id: event.id, roundId: f.roundId },
        headers: { authorization: 'Bearer fictional', 'Content-Type': 'application/json', 'Idempotency-Key': identifier(26701),
          ...(action !== 'round-kp' ? { 'If-Match': initial.round.games?.configuration.etag ?? '' } : { 'If-None-Match': '*' }) },
        body: { string: JSON.stringify(action !== 'round-kp' ? { games: [f.game] } : selection) },
      });
      const handler = action === 'public-games' ? createPublicHandler(() => api, 'games') : createScoringHandler(() => api, action);
      const result = await handler(request, new InvocationContext({ invocationId: 'fictional-mutation-negotiation', logHandler: () => undefined }));
      expect(result.status).toBe(200);
      if (!isRecord(result.jsonBody)) throw new Error('Missing fictional mutation response');
      expect(decodeRoundScores(result.jsonBody.round)?.churchyMurphyTargets).toBe(negotiated ? true : undefined);
      expect(JSON.stringify(result.jsonBody).includes('"murphyTarget"')).toBe(negotiated);
    }
  });

  it.each(['owner', 'public'] as const)('negotiates full/lean %s reads and writes independently of request identity, including nested wrappers/history', async (mode) => {
    const f = await fixture();
    const workspace = await f.workspace.get(creator, event.id);
    await f.workspace.save(creator, event.id, { ...f.input,
      overallCompetition: { kind: 'stroke-play', basis: 'gross' } }, workspace.etag);
    const initial = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy: f.extras(f.playerId, 'birdie', { sandy: 1, pully: 1 }) }, null, identifier(26500));
    const api = { ...f, verify: vi.fn().mockResolvedValue(creator), limiter: { check: vi.fn().mockResolvedValue(undefined) } };
    const context = new InvocationContext({ invocationId: 'fictional-murphy', logHandler: () => undefined });
    const request = (query: string, method = 'GET', body?: unknown, params: Readonly<Record<string, string>> = {}) => new HttpRequest({
      url: `https://fictional.example.test/api/fixture?stringRules=2&${query}`, method,
      params: { id: event.id, roundId: f.roundId, playerId: f.playerId, holeNumber: '1', ...params },
      headers: { authorization: 'Bearer fictional', 'Content-Type': 'application/json',
        'If-Match': etag(initial.round, f.playerId) ?? '', 'Idempotency-Key': identifier(26501) },
      ...(body === undefined ? {} : { body: { string: JSON.stringify(body) } }),
    });
    for (const format of ['', 'format=lean&']) for (const negotiated of [false, true]) {
      const query = `${format}${negotiated ? 'murphy=score-v1' : 'murphy=unknown'}`;
      const response = mode === 'owner'
        ? await createScoringHandler(() => api, 'scores')(request(query), context)
        : await createPublicHandler(() => api, 'scores')(request(query), context);
      expect(response.status).toBe(200);
      const decoded = decodeRoundScores(response.jsonBody);
      expect(decoded).not.toBeNull();
      expect(decoded?.churchyMurphyTargets).toBe(negotiated ? true : undefined);
      expect(JSON.stringify(response.jsonBody).includes('"murphyTarget"')).toBe(negotiated);
    }
    const score = { kind: 'strokes', strokes: 4 };
    for (const negotiated of [false, true]) {
      const query = negotiated ? 'murphy=score-v1' : '';
      const response = mode === 'owner'
        ? await createScoringHandler(() => api, 'score-hole')(request(query, 'PUT', { score }), context)
        : await createPublicHandler(() => api, 'score-hole')(request(query, 'PUT', { score }), context);
      expect(response.status).toBe(200);
      expect(isScoreWriteResult(response.jsonBody)).toBe(true);
      expect(JSON.stringify(response.jsonBody).includes('"murphyTarget"')).toBe(negotiated);
    }
    for (const action of ['score-history', 'event-leaderboard'] satisfies readonly ScoringAction[]) {
      const legacy = await createScoringHandler(() => api, action)(request(''), context);
      const modern = await createScoringHandler(() => api, action)(request('murphy=score-v1'), context);
      expect(legacy.status).toBe(200);
      expect(modern.status).toBe(200);
      expect(JSON.stringify(legacy.jsonBody)).not.toContain('murphyTarget');
      expect(JSON.stringify(modern.jsonBody)).toContain('murphyTarget');
      if (action === 'score-history') {
        expect(isScoreHistoryPage(legacy.jsonBody)).toBe(true);
        if (!isScoreHistoryPage(legacy.jsonBody)) throw new Error('Invalid fictional history');
        const calls = legacy.jsonBody.changes.flatMap((change) => change.after.churchy?.version === 3
          ? change.after.churchy.players.flatMap((player) => player.calls) : []);
        expect(calls.length).toBeGreaterThan(0);
        expect(calls.every((call) => call.result === 'pending' && call.murphyTarget === undefined)).toBe(true);
      }
    }
    const nested = murphyTransport({ current: { roundScores: [initial.round] } }, false);
    expect(JSON.stringify(nested)).not.toContain('murphyTarget');
    expect(JSON.stringify(nested)).not.toContain('churchyMurphyTargets');
  });

  it('never exposes new call markers or capability through negotiated legacy tester paths', async () => {
    const f = await testerFixture();
    const game: ChurchyGameDefinitionV3 = { id: identifier(26600), name: 'Churchie', kind: 'churchy', version: 3,
      basis: 'net', groupNumber: 1, playerIds: f.input.playerIds.slice(0, 4), orderMode: 'tee',
      amountPerDotMinor: 0, currency: 'USD', specials: [{ kind: 'murphy', units: 1 }, { kind: 'paree', units: 1 }] };
    const configured = await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(26601));
    await f.scores.write(creator, event.id, f.roundId, f.playerId, 1, { kind: 'strokes', strokes: 4,
      churchy: { version: 3, gameId: game.id, gameEtag: configured.round.games?.configuration.etag ?? '', number: 1, contests: [],
        players: [{ playerId: f.playerId, counts: {}, calls: [
          { id: identifier(26602), kind: 'murphy', result: 'pending', murphyTarget: 'par' },
          { id: identifier(26604), kind: 'paree', result: 'pending', pareeTarget: 'par' },
        ] }] } },
    null, identifier(26603));
    const api = { ...f, verify: vi.fn().mockResolvedValue(creator), limiter: { check: vi.fn().mockResolvedValue(undefined) } };
    const response = await createTesterHandler(() => api, 'scores')(new HttpRequest({
      url: 'https://fictional.example.test/api/fixture?murphy=score-v1&paree=score-v1', method: 'GET',
      params: { id: event.id, roundId: f.roundId }, headers: { authorization: f.header },
    }), new InvocationContext({ invocationId: 'fictional-tester-murphy', logHandler: () => undefined }));
    expect(response.status).toBe(200);
    expect(isRoundScores(response.jsonBody)).toBe(true);
    expect(JSON.stringify(response.jsonBody)).not.toContain('murphyTarget');
    expect(JSON.stringify(response.jsonBody)).not.toContain('churchyMurphyTargets');
    expect(JSON.stringify(response.jsonBody)).not.toContain('pareeTarget');
    expect(JSON.stringify(response.jsonBody)).not.toContain('churchyPareeTargets');
  });
});
