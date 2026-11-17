import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import type { DotsGameDefinition } from '../../../src/domain/dots.js';
import { isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { maximumGameConfigurationBytes } from '../../../src/domain/games.js';
import { publicFixture } from '../public-access/test-support.js';
import { createPublicHandler } from '../public-access/handlers.js';
import type { PublicAction } from '../public-access/handlers.js';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { createScoringHandler } from './handlers.js';
import { ApiError } from '../errors.js';

async function fixture() {
  const f = await publicFixture();
  const game: DotsGameDefinition = { id: identifier(21000), name: 'Fictional Dots', kind: 'dots', version: 1,
    groupNumber: 1, playerIds: f.input.playerIds.slice(0, 4), mode: 'individual', stakeMinor: null,
    specials: [{ kind: 'murphy', units: 1 }] };
  const limiter = { check: vi.fn().mockResolvedValue(undefined) };
  const api = { publicEvents: f.publicEvents, scores: f.scores, workspace: f.workspace, purse: f.purse, limiter };
  const context = new InvocationContext({ invocationId: 'fictional-dots-http', logHandler: () => undefined });
  const request = (body: unknown, operation: number, headers: Readonly<Record<string, string>> = {}) => new HttpRequest({
    method: 'PUT', url: 'https://fictional.example.test/api/fixture',
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
