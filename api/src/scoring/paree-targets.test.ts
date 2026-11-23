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
import type { DotsCall, DotsPlayerDeclaration } from '../../../src/domain/dots.js';
import type { HoleScore, RoundScores } from '../../../src/domain/scoring.js';
import { murphyRoundScores } from '../../../src/domain/murphy-transport.js';
import * as compatibility from '../../../src/domain/murphy-transport.js';
import * as scoringContract from '../../../src/contracts/scoring.js';
import { decodeRoundScores, isScoreHistoryPage, isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { isRecord } from '../../../src/contracts/events.js';
import { leanRoundScores } from '../../../src/contracts/lean-round-scores.js';
import { privateReadPartCharacters } from '../../../src/contracts/private-values.js';
import { publicFixture } from '../public-access/test-support.js';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { createScoringHandler } from './handlers.js';
import { createPublicHandler } from '../public-access/handlers.js';
import { murphyTransport } from './murphy-transport.js';
import { TableScoreStore } from './store.js';

const etag = (round: RoundScores, playerId: string) => round.cards.find((card) => card.playerId === playerId)?.etag ?? null;
const context = () => new InvocationContext({ invocationId: 'fictional-paree', logHandler: () => undefined });
const query = (murphy: boolean, paree: boolean, lean = false) =>
  `${lean ? 'format=lean&' : ''}${murphy ? 'murphy=score-v1&' : ''}${paree ? 'paree=score-v1&' : ''}`;

async function fixture() {
  const f = await publicFixture();
  const game: ChurchyGameDefinitionV3 = { id: identifier(27000), name: 'Churchie', kind: 'churchy', version: 3,
    basis: 'net', groupNumber: 1, playerIds: f.input.playerIds.slice(0, 4), orderMode: 'approach',
    amountPerDotMinor: 50, currency: 'USD', specials: [{ kind: 'paree', units: 2 }, { kind: 'murphy', units: 1 }, { kind: 'sandy', units: 1 }] };
  const round = (await f.scores.saveGames(f.actor, event.id, f.roundId, [game], null, identifier(27001))).round;
  const source = game.playerIds[1];
  if (!source) throw new Error('Missing fictional source');
  const paree: DotsCall = { id: identifier(27002), kind: 'paree', result: 'pending', pareeTarget: 'par' };
  const extras = (playerId = source, calls: readonly DotsCall[] = [paree],
    counts: DotsPlayerDeclaration['counts'] = {}): ChurchySpecialsV3 => ({
    version: 3, gameId: game.id, gameEtag: round.games?.configuration.etag ?? 'missing', number: 1,
    rotation: { playerIds: game.playerIds }, contests: [], players: [{ playerId, counts, calls }],
  });
  const api = { ...f, verify: vi.fn().mockResolvedValue(creator), limiter: { check: vi.fn().mockResolvedValue(undefined) } };
  const request = (search: string, method = 'GET', body?: unknown, expected: string | null = null, requestId = identifier(27010)) =>
    new HttpRequest({ url: `https://fictional.example.test/api/fixture?stringRules=2&${search}`, method,
      params: { id: event.id, roundId: f.roundId, playerId: f.playerId, holeNumber: '1' },
      headers: { authorization: 'Bearer fictional', 'Content-Type': 'application/json', 'Idempotency-Key': requestId,
        ...(expected === null ? { 'If-None-Match': '*' } : { 'If-Match': expected }) },
      ...(body === undefined ? {} : { body: { string: JSON.stringify(body) } }) });
  return { ...f, game, round, source, extras, paree, api, request };
}

describe('authoritative Churchie Paree targets', () => {
  it('resolves first scores and raw corrections on another card in one transaction, retaining declarations/captures and private award audits', async () => {
    const f = await fixture(), declaration = f.extras();
    const initial = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy: declaration }, null, identifier(27100));
    const anchor = { ...f.row(`score-card:${f.roundId}:${f.playerId}`) }, capture = { ...f.row(`index-capture:${f.roundId}`) };
    expect(initial.round.games?.results[0]?.churchy?.awards?.filter((award) => award.kind === 'paree')).toEqual([]);
    let round = initial.round;
    for (const [index, score] of ([{ kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 4 },
      { kind: 'strokes', strokes: 5 }, { kind: 'picked-up', reportedStrokes: 7 }, { kind: 'did-not-finish' },
      { kind: 'unplayed' }] satisfies readonly HoleScore[]).entries()) {
      f.submit.mockClear();
      const saved = await f.scores.write(f.actor, event.id, f.roundId, f.source, 1, score, etag(round, f.source), identifier(27101 + index));
      const awards = saved.round.games?.results[0]?.churchy?.awards?.filter((award) => award.kind === 'paree');
      if (score.kind === 'unplayed') expect(awards).toEqual([]);
      else expect(awards).toEqual([expect.objectContaining({ kind: 'paree', earnedBy: f.source, count: 1, dots: 2,
        recipientIds: index < 2 ? [f.game.playerIds[1], f.game.playerIds[2]] : [f.game.playerIds[0], f.game.playerIds[3]],
        reason: `Paree call: ${index < 2 ? 'success' : 'failure'}.` })]);
      expect(f.submit).toHaveBeenCalledOnce();
      expect(f.row(`score-card:${f.roundId}:${f.playerId}`)).toEqual(anchor);
      expect(f.row(`index-capture:${f.roundId}`)).toEqual(capture);
      expect(saved.round.cards.find((card) => card.playerId === f.playerId)?.holes[0]?.score.churchy).toEqual(declaration);
      expect(isScoreWriteResult(saved)).toBe(true);
      round = saved.round;
    }
    const history = await f.scores.history(creator, event.id, f.roundId, f.source);
    expect(history.changes.some((change) => change.dotAwardAudit?.some((audit) =>
      audit.after.some((award) => award.kind === 'paree' && award.earnedBy === f.source)))).toBe(true);
  });

  it('rejects a first score resolving a pending Paree against same-source claims, but preserves an independent teammate source', async () => {
    const f = await fixture();
    const initial = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy: f.extras(f.source, [f.paree], { sandy: 1 }) }, null, identifier(27200));
    const rows = new Map(f.rows);
    f.submit.mockClear();
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.source, 1, { kind: 'strokes', strokes: 5 },
      null, identifier(27201))).rejects.toMatchObject({ code: 'CHURCHY_SETUP_CHANGED' });
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.rows).toEqual(rows);
    const repaired = f.extras();
    await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, { kind: 'strokes', strokes: 4,
      churchy: { ...repaired, players: [...repaired.players, { playerId: f.playerId, counts: { sandy: 1 }, calls: [] }] } },
    etag(initial.round, f.playerId), identifier(27202));
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.source, 1,
      { kind: 'strokes', strokes: 5 }, null, identifier(27203));
    expect(saved.round.games?.results[0]?.churchy?.awards).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'paree', earnedBy: f.source, reason: 'Paree call: failure.' }),
      expect.objectContaining({ kind: 'sandy', earnedBy: f.playerId }),
    ]));
  });

  it('keeps manual calls unchanged until opt-in, preserves old echoes, and rejects overrides while replaying original request intent', async () => {
    const f = await fixture(), manual: DotsCall = { id: f.paree.id, kind: 'paree', result: 'failure' };
    const first = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy: f.extras(f.playerId, [manual]) }, null, identifier(27300));
    const raw = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4 }, etag(first.round, f.playerId), identifier(27301));
    expect(raw.change.after.churchy).toEqual(f.extras(f.playerId, [manual]));
    const modern = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy: f.extras(f.playerId) }, etag(raw.round, f.playerId), identifier(27302));
    const echo = murphyRoundScores(modern.round, true).cards.find((card) => card.playerId === f.playerId)?.holes[0]?.score;
    if (echo?.kind !== 'strokes' || echo.churchy?.version !== 3) throw new Error('Missing fictional echo');
    const expected = etag(modern.round, f.playerId), requestId = identifier(27303);
    f.submit.mockImplementationOnce((actions) => { f.apply(actions); return Promise.reject(new Error('Fictional lost acknowledgement')); });
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, echo, expected, requestId);
    expect(saved.change.after.churchy).toEqual(f.extras(f.playerId));
    const corrected = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 5 }, etag(saved.round, f.playerId), identifier(27304));
    expect((await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, echo, expected, requestId)).change).toEqual(saved.change);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, echo,
      etag(corrected.round, f.playerId), identifier(27305))).rejects.toMatchObject({ code: 'CHURCHY_PAREE_REFRESH_REQUIRED' });
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, { ...echo, strokes: 3 }, expected, requestId))
      .rejects.toMatchObject({ code: 'SCORE_REQUEST_CONFLICT' });
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4 }, expected, identifier(27306))).rejects.toMatchObject({ code: 'SCORECARD_CHANGED' });
    const disabled = new TableScoreStore(f.table, f.workspace, () => false);
    await expect(disabled.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 5, churchy: f.extras(f.playerId, []) },
      etag(corrected.round, f.playerId), identifier(27307))).rejects.toMatchObject({ code: 'CHURCHY_DISABLED' });
    expect(murphyRoundScores(await disabled.get(f.actor, event.id, f.roundId), true, true)).not.toHaveProperty('churchyPareeTargets');
  });

  it('negotiates all four full/lean public/owner score reads and writes exactly once and binds private pages to the projected value', async () => {
    const f = await fixture();
    const calls: readonly DotsCall[] = [f.paree, { id: identifier(27400), kind: 'murphy', result: 'pending', murphyTarget: 'birdie' }];
    await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy: f.extras(f.playerId, calls) }, null, identifier(27401));
    const project = vi.spyOn(compatibility, 'murphyRoundScores'), validate = vi.spyOn(scoringContract, 'isRoundScores');
    try {
      for (const owner of [false, true]) {
        const expected = etag(await f.scores.get(owner ? creator : f.actor, event.id, f.roundId), f.playerId);
        for (const lean of [false, true]) for (const murphy of [false, true]) for (const paree of [false, true]) {
          const search = query(murphy, paree, lean);
          for (const write of [false, true]) {
            project.mockClear(); validate.mockClear();
            const handler = owner ? createScoringHandler(() => f.api, write ? 'score-hole' : 'scores')
              : createPublicHandler(() => f.api, write ? 'score-hole' : 'scores');
            const response = await handler(f.request(search, write ? 'PUT' : 'GET',
              write ? { score: { kind: 'strokes', strokes: 4 } } : undefined,
              expected, identifier(owner ? 27403 : 27402)), context());
            expect(response.status).toBe(200);
            expect(project).toHaveBeenCalledTimes(1);
            expect(validate.mock.calls.filter(([value]) => isRecord(value) && value.roundId === f.roundId)).toHaveLength(lean ? 0 : 1);
            const round = decodeRoundScores(write && isRecord(response.jsonBody) ? response.jsonBody.round : response.jsonBody);
            expect(round).not.toBeNull();
            expect(round?.churchyMurphyTargets).toBe(murphy ? true : undefined);
            expect(round?.churchyPareeTargets).toBe(paree ? true : undefined);
            expect(JSON.stringify(response.jsonBody).includes('"murphyTarget"')).toBe(murphy);
            expect(JSON.stringify(response.jsonBody).includes('"pareeTarget"')).toBe(paree);
          }
          const current = await f.scores.get(owner ? creator : f.actor, event.id, f.roundId);
          const text = JSON.stringify(lean ? leanRoundScores(current, murphy, paree, true)
            : dotsHighLowRoundScores(wolfOrderRoundScores(gameCalculationRoundScores(gameHandicapRoundScores(coexistenceRoundScores(murphyRoundScores(dotsRulesV3RoundScores(current), murphy, paree)))))));
          const hash = createHash('sha256').update(text).digest('hex'), parts = Math.ceil(text.length / privateReadPartCharacters);
          const handler = owner ? createScoringHandler(() => f.api, 'scores') : createPublicHandler(() => f.api, 'scores');
          for (let index = 0; index < parts; index++) {
            const response = await handler(f.request(`${search}privatePart=${String(index)}&privateHash=${hash}`), context());
            expect(response).toMatchObject({ status: 200, jsonBody: { privateRead: { sha256: hash, index, parts,
              content: text.slice(index * privateReadPartCharacters, (index + 1) * privateReadPartCharacters) } } });
          }
          expect(await handler(f.request(`${search}privatePart=0&privateHash=${'0'.repeat(64)}`), context()))
            .toMatchObject({ status: 409, jsonBody: { code: 'EVENT_CHANGED' } });
      }
      }
    } finally { project.mockRestore(); validate.mockRestore(); }
  });

  it('preserves independent negotiation through game/KP wrappers and historical/aggregate reads without inventing past outcomes', async () => {
    const f = await fixture(), calls: readonly DotsCall[] = [f.paree,
      { id: identifier(27500), kind: 'murphy', result: 'pending', murphyTarget: 'birdie' }];
    const initial = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy: f.extras(f.playerId, calls) }, null, identifier(27501));
    const selection = { version: 1 as const, context: 'fictional-kp-context', status: 'open' as const, decisions: [] };
    vi.spyOn(f.scores, 'saveKp').mockResolvedValue({ round: initial.round, requestId: identifier(27502), expectedEtag: null, selection });
    let publicRevision: string | undefined;
    for (const murphy of [false, true]) for (const paree of [false, true]) {
      for (const lean of [false, true]) for (const action of ['round-games', 'round-kp', 'public-games'] as const) {
        if (action === 'public-games' && publicRevision === undefined) {
          publicRevision = (await f.scores.get(f.actor, event.id, f.roundId)).games?.configuration.etag ?? '';
        }
        const handler = action === 'public-games' ? createPublicHandler(() => f.api, 'games') : createScoringHandler(() => f.api, action);
        const response = await handler(f.request(query(murphy, paree, lean), 'PUT',
          action === 'round-kp' ? selection : { games: [f.game] },
          action === 'round-kp' ? null : action === 'public-games' ? publicRevision ?? '' : initial.round.games?.configuration.etag ?? '',
          identifier(action === 'public-games' ? 27503 : 27502)), context());
        expect(response.status, `${action}: ${JSON.stringify(response.jsonBody)}`).toBe(200);
        const round = isRecord(response.jsonBody) ? decodeRoundScores(response.jsonBody.round) : null;
        expect(round?.churchyMurphyTargets).toBe(murphy ? true : undefined);
        expect(round?.churchyPareeTargets).toBe(paree ? true : undefined);
        expect(JSON.stringify(response.jsonBody).includes('"pareeTarget"')).toBe(paree);
        expect(JSON.stringify(response.jsonBody).includes('"murphyTarget"')).toBe(murphy);
      }
      const history = await createScoringHandler(() => f.api, 'score-history')(f.request(query(murphy, paree)), context());
      expect(history.status).toBe(200);
      expect(isScoreHistoryPage(history.jsonBody)).toBe(true);
      expect(JSON.stringify(history.jsonBody).includes('"pareeTarget"')).toBe(paree);
      expect(JSON.stringify(history.jsonBody).includes('"murphyTarget"')).toBe(murphy);
      if (!isScoreHistoryPage(history.jsonBody)) throw new Error('Invalid fictional history');
      expect(history.jsonBody.changes.flatMap((change) => change.after.churchy?.version === 3
        ? change.after.churchy.players.flatMap((player) => player.calls) : []).every((call) => call.result === 'pending')).toBe(true);
      const aggregate = murphyTransport({ current: { roundScores: [initial.round] } }, murphy, paree);
      expect(JSON.stringify(aggregate).includes('"pareeTarget"')).toBe(paree);
      expect(JSON.stringify(aggregate).includes('"murphyTarget"')).toBe(murphy);
    }
  });
});
