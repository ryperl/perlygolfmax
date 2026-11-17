// @vitest-environment node
import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import { createScoringHandler } from '../../api/src/scoring/handlers.js';
import type { ScoringAction } from '../../api/src/scoring/handlers.js';
import { scoringFixture } from '../../api/test/scoring-fixtures.js';
import { identifier } from '../../api/test/catalog-fixtures.js';
import { creator, event, member } from '../../api/test/fixtures.js';
import { createScoresClient } from '../client/scoring';
import { EventChangedError } from '../client/events';
import { summarizeGross } from '../domain/scoring';
import { stablefordPoints } from '../domain/stableford';
import type { RoundGameDefinition } from '../domain/games';
import type { ChurchyGameDefinitionV2 } from '../domain/churchy';
import { emptyChurchySpecials } from '../domain/churchy';

describe('owner scoring client/handler/storage workflow', () => {
  it('acknowledges raw-only v2 Churchy saves and their immutable retries when a peer save conflicts', async () => {
    const stored = await scoringFixture();
    const game: ChurchyGameDefinitionV2 = { id: identifier(710), name: 'Churchy Game', kind: 'churchy',
      version: 2, basis: 'net', groupNumber: 1, playerIds: stored.input.playerIds, currency: 'USD',
      amountPerDotMinor: 50, enabledSpecials: ['sticky'] };
    const configured = await stored.scores.saveGames(creator, event.id, stored.roundId, [game], null, identifier(810));
    const empty = emptyChurchySpecials(game, configured.round.games?.configuration.etag ?? '');
    if (empty.version !== 2) throw new Error('Expected fictional v2 specials');
    const churchy = { ...empty, sticky: true, otherDots: 2 };
    const saved = await stored.scores.write(creator, event.id, stored.roundId, stored.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy }, null, identifier(811));
    const api = { scores: stored.scores, verify: vi.fn().mockResolvedValue(creator),
      limiter: { check: vi.fn().mockResolvedValue(undefined) } };
    const context = new InvocationContext({ invocationId: 'fictional-churchy-v2-workflow', logHandler: () => undefined });
    const send = vi.fn<typeof fetch>().mockImplementation(async (target, options) => {
      const url = typeof target === 'string' ? target : target instanceof URL ? target.href : target.url;
      const parts = new URL(url).pathname.replace(/^\/api\//, '').split('/').map(decodeURIComponent);
      const request = new HttpRequest({ url, method: options?.method ?? 'GET',
        params: { id: parts[1] ?? '', roundId: parts[3] ?? '', playerId: parts[5] ?? '', holeNumber: parts[7] ?? '' },
        headers: Object.fromEntries(new Headers(options?.headers).entries()),
        ...(typeof options?.body === 'string' ? { body: { string: options.body } } : {}) });
      const result = await createScoringHandler(() => api, 'score-hole')(request, context);
      return new Response(JSON.stringify(result.jsonBody), { status: result.status ?? 200 });
    });
    const client = createScoresClient('https://fictional.example.test/api', () => Promise.resolve('fictional-owner'), send);
    const signal = new AbortController().signal;
    const etag = saved.round.cards.find((card) => card.playerId === stored.playerId)?.etag ?? null;
    const first = await client.save(event.id, stored.roundId, stored.playerId, 1,
      { kind: 'strokes', strokes: 5 }, etag, identifier(812), signal);
    expect(first.change.after).toEqual({ kind: 'strokes', strokes: 5, churchy });
    const peerId = stored.input.playerIds[1];
    if (!peerId) throw new Error('Expected fictional peer');
    await expect(client.save(event.id, stored.roundId, peerId, 1,
      { kind: 'strokes', strokes: 4 }, 'fictional-stale-peer', identifier(813), signal)).rejects.toBeInstanceOf(EventChangedError);
    const replay = await client.save(event.id, stored.roundId, stored.playerId, 1,
      { kind: 'strokes', strokes: 5 }, etag, identifier(812), signal);
    expect(replay.change).toEqual(first.change);
    expect(replay.round.cards.find((card) => card.playerId === peerId)?.etag).toBeNull();
    const peer = await client.save(event.id, stored.roundId, peerId, 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(814), signal);
    expect(peer.round.cards.find((card) => card.playerId === stored.playerId)?.holes[0]?.score.churchy).toEqual(churchy);
    expect((await stored.scores.history(creator, event.id, stored.roundId, stored.playerId)).changes).toHaveLength(2);
  });
  it.each([1, 2, 3, 4] as const)('persists audited dispositions and game results for %i golfers without granting nonowner access', async (count) => {
    const stored = await scoringFixture(count);
    const api = {
      scores: stored.scores,
      verify: vi.fn((authorization: string | null) => Promise.resolve(authorization === 'Bearer fictional-member' ? member : creator)),
      limiter: { check: vi.fn().mockResolvedValue(undefined) },
    };
    const context = new InvocationContext({ invocationId: 'fictional-owner-scoring', logHandler: () => undefined });
    const send = vi.fn<typeof fetch>().mockImplementation(async (target, options) => {
      const url = typeof target === 'string' ? target : target instanceof URL ? target.href : target.url;
      const parts = new URL(url).pathname.replace(/^\/api\//, '').split('/').map(decodeURIComponent);
      const action: ScoringAction = parts[4] === 'scores' ? 'scores' : parts[4] === 'games' ? 'round-games'
        : parts[6] === 'score-history' ? 'score-history' : 'score-hole';
      const request = new HttpRequest({
        url, method: options?.method ?? 'GET',
        params: { id: parts[1] ?? '', roundId: parts[3] ?? '', playerId: parts[5] ?? '', holeNumber: parts[7] ?? '' },
        headers: Object.fromEntries(new Headers(options?.headers).entries()),
        ...(typeof options?.body === 'string' ? { body: { string: options.body } } : {}),
      });
      const result = await createScoringHandler(() => api, action)(request, context);
      return new Response(JSON.stringify(result.jsonBody), { status: result.status ?? 200 });
    });
    const client = createScoresClient('https://fictional.example.test/api', () => Promise.resolve('fictional-owner'), send);
    const signal = new AbortController().signal;
    const initial = await client.load(event.id, stored.roundId, signal);
    expect(initial.setupLocked).toBe(false);
    expect(initial.cards.every((card) => card.etag === null)).toBe(true);
    const saved = await client.save(event.id, stored.roundId, stored.playerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(600), signal);
    expect(saved.change.before).toEqual({ kind: 'unplayed' });
    expect(saved.round.setupLocked).toBe(true);
    let card = saved.round.cards.find((entry) => entry.playerId === stored.playerId);
    if (!card || card.etag === null) throw new Error('Saved fictional card has no revision.');
    const corrected = await client.save(event.id, stored.roundId, stored.playerId, 1, { kind: 'strokes', strokes: 5 }, card.etag, identifier(601), signal);
    const replay = await client.save(event.id, stored.roundId, stored.playerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(600), signal);
    expect(replay.change.id).toBe(saved.change.id);
    expect(replay.change.after).toEqual({ kind: 'strokes', strokes: 4 });
    expect(replay.round.cards.find((entry) => entry.playerId === stored.playerId)?.holes[0]?.score).toEqual({ kind: 'strokes', strokes: 5 });
    card = corrected.round.cards.find((entry) => entry.playerId === stored.playerId);
    if (!card || card.etag === null) throw new Error('Corrected fictional card has no revision.');
    for (const [number, kind, operation] of [[2, 'picked-up', 602], [3, 'did-not-finish', 603], [1, 'unplayed', 604]] as const) {
      const response = await client.save(event.id, stored.roundId, stored.playerId, number, { kind }, card.etag, identifier(operation), signal);
      const current = response.round.cards.find((entry) => entry.playerId === stored.playerId);
      if (!current || current.etag === null) throw new Error('Fictional correction lost card revision.');
      card = current;
    }
    expect(summarizeGross(card.holes)).toMatchObject({
      recordedStrokes: 0, numericHoles: 0, pickedUpHoles: 1, didNotFinishHoles: 1, completeGross: null,
    });
    const competing = await Promise.allSettled([
      client.save(event.id, stored.roundId, stored.playerId, 4, { kind: 'strokes', strokes: 4 }, card.etag, identifier(605), signal),
      client.save(event.id, stored.roundId, stored.playerId, 4, { kind: 'strokes', strokes: 6 }, card.etag, identifier(606), signal),
    ]);
    expect(competing.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const conflict = competing.find((result) => result.status === 'rejected');
    expect(conflict?.status === 'rejected' && conflict.reason instanceof EventChangedError).toBe(true);
    expect((await client.history(event.id, stored.roundId, stored.playerId, signal)).changes).toHaveLength(6);
    const workspace = await stored.workspace.get(creator, event.id);
    expect(workspace.rounds[0]?.scoringStarted).toBe(true);
    await expect(stored.workspace.save(creator, event.id, {
      ...stored.input,
      rounds: stored.input.rounds.map((round) => ({ ...round, name: 'Fictional changed locked round' })),
    }, workspace.etag)).rejects.toMatchObject({ code: 'ROUND_SCORING_STARTED' });
    const rawCards = (await client.load(event.id, stored.roundId, signal)).cards;
    const games: readonly RoundGameDefinition[] = [
      { id: identifier(700), name: 'Fictional standard gross', preset: 'standard', basis: 'gross', handicapAllowancePercent: 95, points: stablefordPoints('standard') },
      { id: identifier(701), name: 'Fictional modified net', preset: 'modified', basis: 'net', handicapAllowancePercent: 95, points: stablefordPoints('modified') },
    ];
    const configured = await client.saveGames(event.id, stored.roundId, games, null, identifier(800), signal);
    expect(configured.round.games?.configuration.games).toEqual(games);
    expect(configured.round.games?.results[1]?.players[0]?.unavailableReason).toBe('missing-handicap-index');
    expect(configured.round.cards).toEqual(rawCards);
    const revision = configured.round.games?.configuration.etag;
    if (!revision) throw new Error('Configured games lack a revision.');
    const edited = games.map((game) => game.id === identifier(700) ? { ...game, name: 'Fictional revised gross' } : game);
    const revised = await client.saveGames(event.id, stored.roundId, edited, revision, identifier(801), signal);
    expect(revised.round.games?.configuration.games).toEqual(edited);
    const confirmed = await client.saveGames(event.id, stored.roundId, games, null, identifier(800), signal);
    expect(confirmed.change).toEqual(configured.change);
    expect(confirmed.round.games?.configuration.games).toEqual(edited);
    expect(confirmed.round.cards).toEqual(rawCards);
    stored.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'member' });
    const participant = createScoresClient('https://fictional.example.test/api', () => Promise.resolve('fictional-member'), send);
    await expect(participant.load(event.id, stored.roundId, signal)).rejects.toThrow('permission');
    await expect(participant.history(event.id, stored.roundId, stored.playerId, signal)).rejects.toThrow('permission');
    await expect(participant.saveGames(event.id, stored.roundId, edited, revision, identifier(802), signal)).rejects.toThrow('permission');
    expect(api.verify).toHaveBeenCalledWith('Bearer fictional-owner');
    expect(api.verify).toHaveBeenCalledWith('Bearer fictional-member');
  });
});
