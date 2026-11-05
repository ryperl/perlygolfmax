// @vitest-environment node
import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import type { EventSetupInput } from '../domain/setup';
import type { TeamGameDefinition } from '../domain/games';
import { stablefordPoints } from '../domain/stableford';
import { catalogFixture, identifier, tee } from '../../api/test/catalog-fixtures';
import { creator, event } from '../../api/test/fixtures';
import { TableScoreStore } from '../../api/src/scoring/store';
import { createCatalogHandler } from '../../api/src/catalog/handlers';
import { createScoringHandler } from '../../api/src/scoring/handlers';
import { createSetupClient } from '../client/setup';
import { createScoresClient } from '../client/scoring';

describe('large-value browser/API workflow', () => {
  it('uses unchanged typed clients through bounded HTTP handlers for staged setup/games and complete paged reads', async () => {
    const f = catalogFixture();
    f.seedEvent();
    const version = await f.publish();
    const players = await Promise.all(Array.from({ length: 120 }, (_, index) =>
      f.players.create(creator, identifier(1000 + index), `Fictional golfer ${String(index)} ${'F'.repeat(60)}`,
        { value: '12.3', effectiveDate: '2026-01-01', source: `Fictional source ${'S'.repeat(150)}` })));
    const playerIds = players.map((player) => player.id);
    const input: EventSetupInput = {
      name: 'Fictional Large Event', location: 'Fictional location', playerIds,
      rounds: Array.from({ length: 2 }, (_, index) => ({
        id: identifier(500 + index), name: `Fictional Round ${String(index)}`,
        courseId: version.courseId, courseVersionId: version.id, teeProfileId: tee.id,
        groups: Array.from({ length: 30 }, (_, group) => ({ number: group + 10, playerIds: playerIds.slice(group * 4, (group + 1) * 4) })),
      })),
    };
    const empty = await f.workspace.get(creator, event.id);
    const limiter = { check: vi.fn().mockResolvedValue(undefined) };
    const api = { verify: () => Promise.resolve(creator), canManageCatalog: () => true,
      limiter, courses: f.courses, players: f.players, workspace: f.workspace, scores: new TableScoreStore(f.table, f.workspace) };
    const context = new InvocationContext({ invocationId: 'fictional-capacity-http', logHandler: () => undefined });
    const send = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const requestUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      const parsed = new URL(requestUrl);
      const roundId = identifier(500);
      if (init?.body !== undefined && typeof init.body !== 'string') throw new Error('Invalid fictional transport body');
      const request = new HttpRequest({
        method: init?.method ?? 'GET', url: requestUrl, params: { id: event.id, roundId }, headers: Object.fromEntries(new Headers(init?.headers)),
        ...(typeof init?.body === 'string' ? { body: { string: init.body } } : {}),
      });
      const result = parsed.pathname.endsWith('/workspace')
        ? await createCatalogHandler(() => api, 'workspace')(request, context)
        : await createScoringHandler(() => api, parsed.pathname.endsWith('/games') ? 'round-games' : 'scores')(request, context);
      return new Response(JSON.stringify(result.jsonBody), { status: result.status ?? 200 });
    });
    const signal = new AbortController().signal;
    const setup = createSetupClient('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    const scores = createScoresClient('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    const saved = await setup.save(event.id, empty.etag, input, signal);
    expect(await setup.load(event.id, signal)).toEqual(saved);
    expect(await setup.save(event.id, empty.etag, input, signal)).toEqual(saved);
    const game: TeamGameDefinition = {
      id: identifier(600), name: 'Fictional Pairs', preset: 'standard', basis: 'net',
      handicapAllowancePercent: 100, points: stablefordPoints('standard'), format: 'two-net-better-ball',
      teams: Array.from({ length: 60 }, (_, index) => ({ id: identifier(2000 + index),
        name: `Fictional Team ${String(index)} ${'T'.repeat(60)}`, playerIds: input.playerIds.slice(index * 2, (index + 1) * 2) })),
    };
    const games = Array.from({ length: 2 }, (_, index) => ({ ...game, id: identifier(600 + index) }));
    expect(Buffer.byteLength(JSON.stringify({ games }))).toBeGreaterThan(12288);
    const configured = await scores.saveGames(event.id, identifier(500), games, null, identifier(800), signal);
    expect(await scores.load(event.id, identifier(500), signal)).toEqual(configured.round);
    expect((await scores.saveGames(event.id, identifier(500), games, null, identifier(800), signal)).change).toEqual(configured.change);
    expect(send.mock.calls.every((call) => typeof call[1]?.body !== 'string' || Buffer.byteLength(call[1].body) <= 12288)).toBe(true);
    expect(send.mock.calls.some((call) => typeof call[0] === 'string' && call[0].includes('privatePart=1'))).toBe(true);
    for (const action of ['setup-write', 'scores-write', 'setup-read', 'scores-read']) expect(limiter.check).toHaveBeenCalledWith(creator, action);
  });
});
