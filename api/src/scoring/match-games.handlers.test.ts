import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import { createPublicHandler } from '../public-access/handlers.js';
import { publicFixture } from '../public-access/test-support.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event } from '../../test/fixtures.js';
import { isScoreWriteResult } from '../../../src/contracts/scoring.js';
import type { WolfGameDefinition } from '../../../src/domain/wolf.js';

describe('game declaration score HTTP boundary', () => {
  it('keeps ordinary writes at 4 KiB, declaration parts at 12 KiB, and uses the same quota-charged public transaction', async () => {
    const f = await publicFixture();
    const game: WolfGameDefinition = { id: identifier(8200), name: 'Fictional HTTP Wolf', kind: 'wolf', version: 1,
      basis: 'gross', groupNumber: 1, playerIds: f.input.playerIds.slice(0, 4), allowPig: true };
    const configured = await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(8201));
    const check = vi.fn().mockResolvedValue(undefined);
    const api = { ...f, limiter: { check } };
    const context = new InvocationContext({ functionName: 'fictional-game-score' });
    const body = { score: { kind: 'strokes', strokes: 4, wolf: [{ number: 1,
      choice: { gameId: game.id, gameEtag: configured.round.games?.configuration.etag, mode: 'pig' } }] } };
    const request = (content: unknown, operation: number) => new HttpRequest({
      url: 'https://fictional.example.test/api/public/fixture', method: 'PUT',
      params: { id: event.id, roundId: f.roundId, playerId: f.playerId, holeNumber: '1' },
      headers: { 'Content-Type': 'application/json', 'If-None-Match': '*', 'Idempotency-Key': identifier(operation) },
      body: { string: typeof content === 'string' ? content : JSON.stringify(content) },
    });
    const ordinary = createPublicHandler(() => api, 'score-hole');
    const declarations = createPublicHandler(() => api, 'score-game-hole');
    expect((await ordinary(request(`${' '.repeat(4096)}${JSON.stringify(body)}`, 8202), context)).status).toBe(413);
    expect((await declarations(request(`${' '.repeat(12288)}${JSON.stringify(body)}`, 8203), context)).status).toBe(413);
    expect((await declarations(request({ score: { kind: 'strokes', strokes: 4 } }, 8204), context)).status).toBe(400);
    const response = await declarations(request(body, 8205), context);
    expect(response.status).toBe(200);
    expect(isScoreWriteResult(response.jsonBody)).toBe(true);
    if (!isScoreWriteResult(response.jsonBody)) throw new Error('Missing fictional HTTP acknowledgement');
    expect(response.jsonBody.change.recordedBy).toEqual(f.actor);
    expect(check).toHaveBeenCalledTimes(4);
    expect(check.mock.calls.every((call) => call[1] === 'scores-write')).toBe(true);
    expect(f.rows.has(`${event.id}|member:public-score`)).toBe(false);
  });
});
