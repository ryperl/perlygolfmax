// @vitest-environment node
import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import { createCatalogHandler } from '../../api/src/catalog/handlers.js';
import type { CatalogAction } from '../../api/src/catalog/handlers.js';
import { catalogFixture, identifier, manifest, tee } from '../../api/test/catalog-fixtures.js';
import { creator, event, member } from '../../api/test/fixtures.js';
import { createCatalogClient } from '../client/catalog';
import { EventChangedError } from '../client/events';
import { createSetupClient } from '../client/setup';

describe('saved setup client/handler contract', () => {
  it.each([1, 2, 3, 4])('imports, snapshots, refreshes and reloads a %i-player event through real request contracts', async (count) => {
    const stored = catalogFixture();
    stored.seedEvent();
    const api = {
      courses: stored.courses, players: stored.players, workspace: stored.workspace,
      canManageCatalog: (identity: typeof creator) => identity.tenantId === creator.tenantId && identity.objectId === creator.objectId,
      verify: vi.fn((authorization: string | null) => Promise.resolve(authorization === 'Bearer fictional-member' ? member : creator)),
      limiter: { check: vi.fn().mockResolvedValue(undefined) },
    };
    const context = new InvocationContext({ invocationId: 'fictional-workflow', logHandler: () => undefined });
    const send = vi.fn<typeof fetch>().mockImplementation(async (target, options) => {
      const url = typeof target === 'string' ? target : target instanceof URL ? target.href : target.url;
      const parts = new URL(url).pathname.replace(/^\/api\//, '').split('/').map(decodeURIComponent);
      let action: CatalogAction;
      let params: Record<string, string> = {};
      if (parts[0] === 'events') {
        action = parts[3] === 'rounds' ? 'round-indices-refresh' : 'workspace';
        params = { id: parts[1] ?? '', roundId: parts[4] ?? '' };
      } else if (parts[1] === 'players') {
        action = parts[3] === 'indices' ? 'indices' : parts[2] ? 'player' : 'players';
        params = { playerId: parts[2] ?? '' };
      } else if (parts[2] === 'imports') {
        action = parts[4] === 'profiles' ? 'import-profile' : parts[4] === 'publish' ? 'import-publish' : parts[3] ? 'import' : 'imports';
        params = { importId: parts[3] ?? '', profileId: parts[5] ?? '' };
      } else {
        action = parts[3] === 'versions' ? 'course-version' : 'courses';
        params = { courseId: parts[2] ?? '', versionId: parts[4] ?? '' };
      }
      const request = new HttpRequest({
        url, method: options?.method ?? 'GET', params,
        headers: Object.fromEntries(new Headers(options?.headers).entries()),
        ...(typeof options?.body === 'string' ? { body: { string: options.body } } : {}),
      });
      const result = await createCatalogHandler(() => api, action)(request, context);
      return new Response(JSON.stringify(result.jsonBody), { status: result.status ?? 200 });
    });
    const signal = new AbortController().signal;
    const catalog = createCatalogClient('https://fictional.example.test/api', () => Promise.resolve('fictional-organizer'), send);
    const setup = createSetupClient('https://fictional.example.test/api', () => Promise.resolve('fictional-organizer'), send);
    expect((await catalog.courses(signal)).courses).toEqual([]);
    const importId = identifier(100);
    await catalog.beginImport(manifest, importId, signal);
    await catalog.uploadProfile(importId, tee, signal);
    const version = await catalog.publish(importId, null, signal);
    expect((await catalog.courses(signal)).courses[0]?.currentVersionId).toBe(version.id);
    const players = await Promise.all([201, 202, 203, 204].slice(0, count).map((id) =>
      catalog.createPlayer(`Fictional golfer ${String(id)}`, identifier(id), signal,
        id === 201 ? { value: '+2.4', effectiveDate: '2026-01-01', source: 'Fictional starting observation' } : undefined)));
    const first = players[0];
    if (!first) throw new Error('Missing fictional first golfer.');
    expect(first.currentIndex?.value).toBe('+2.4');
    expect((await catalog.history(first.id, signal)).observations[0]?.id).toBe(first.id);
    const empty = await setup.load(event.id, signal);
    const playerIds = players.map((player) => player.id);
    const input = {
      name: 'Fictional saved round event', location: 'Fictional general location', playerIds,
      rounds: [{
        id: identifier(500), name: 'Fictional round', courseId: version.courseId,
        courseVersionId: version.id, teeProfileId: tee.id, groups: [{ number: 1, playerIds }],
      }],
    };
    const saved = await setup.save(event.id, empty.etag, input, signal);
    expect(saved.rounds[0]?.players[0]?.handicapIndex?.value).toBe('+2.4');
    const currentPlayer = (await catalog.players(signal)).players.find((player) => player.id === first.id);
    if (!currentPlayer) throw new Error('Missing saved fictional player.');
    await catalog.recordIndex(currentPlayer, { value: '12.3', effectiveDate: '2026-01-02', source: 'Fictional later observation' }, identifier(302), signal);
    expect((await setup.load(event.id, signal)).rounds).toEqual(saved.rounds);
    const refreshed = await setup.refreshIndices(event.id, identifier(500), saved.etag, identifier(600), signal);
    expect(refreshed.rounds[0]?.players[0]?.handicapIndex?.value).toBe('12.3');
    expect(refreshed.rounds[0]?.teeProfile).toEqual(saved.rounds[0]?.teeProfile);
    expect(refreshed.rounds[0]?.groups).toEqual(saved.rounds[0]?.groups);
    expect((await setup.refreshIndices(event.id, identifier(500), saved.etag, identifier(600), signal)).etag).toBe(refreshed.etag);
    expect((await catalog.history(first.id, signal)).observations).toHaveLength(2);
    await expect(setup.save(event.id, empty.etag, input, signal)).rejects.toBeInstanceOf(EventChangedError);
    const repeated = await catalog.publish(importId, null, signal);
    expect(repeated.id).toBe(version.id);
    stored.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'member' });
    const participantSetup = createSetupClient('https://fictional.example.test/api', () => Promise.resolve('fictional-member'), send);
    const participantCatalog = createCatalogClient('https://fictional.example.test/api', () => Promise.resolve('fictional-member'), send);
    const projection = await participantSetup.load(event.id, signal);
    expect(projection.roster).toHaveLength(count);
    expect(JSON.stringify(projection)).not.toContain('handicapIndex');
    expect(JSON.stringify(projection)).not.toContain('recordedBy');
    await expect(participantCatalog.players(signal)).rejects.toThrow('permission');
    expect(api.verify).toHaveBeenCalledWith('Bearer fictional-organizer');
    expect(api.verify).toHaveBeenCalledWith('Bearer fictional-member');
  });
});
