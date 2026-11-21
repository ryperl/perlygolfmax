import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import { publicFixture } from '../public-access/test-support.js';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { TableCourseCatalog } from '../catalog/courses.js';
import { TablePlayerCatalog } from '../catalog/players.js';
import { TableWorkspaceStore } from '../setup/store.js';
import { TableScoreStore } from '../scoring/store.js';
import { privateContent } from '../private-values.js';
import { ApiError } from '../errors.js';
import { isEventWorkspace } from '../../../src/contracts/setup.js';
import { isGameWriteResult, isRoundScores } from '../../../src/contracts/scoring.js';
import { isQuickCourse, isQuickCourseVersion, isQuickPage, isQuickPlayer } from '../../../src/contracts/quick-round.js';
import { stablefordPoints } from '../../../src/domain/stableford.js';
import { TableQuickRoundStore } from './store.js';
import { createQuickRoundHandler } from './handlers.js';
import type { QuickRoundAction } from './handlers.js';
import { createPublicHandler } from '../public-access/handlers.js';
import type { RoundGameDefinition } from '../../../src/domain/games.js';

async function fixture() {
  const f = await publicFixture();
  const workspace = new TableWorkspaceStore(f.table, new TableCourseCatalog(f.table, () => false),
    new TablePlayerCatalog(f.table, () => false), () => false);
  const quick = new TableQuickRoundStore(f.table, workspace);
  const scores = new TableScoreStore(f.table, workspace);
  const id = identifier(8000);
  const actor = { kind: 'public-score' as const, eventId: id };
  return { ...f, workspace, quick, scores, id, actor };
}

describe('public Quick round authority and persistence', () => {
  it('shares the conditional one-foursome start across explicit net games and new Skins carries, then locks it with the first score', async () => {
    const f = await fixture();
    const input = { ...f.input, playerIds: f.input.playerIds.slice(0, 4), rounds: f.input.rounds.map((round) => ({
      ...round, groups: [{ number: 1, playerIds: f.input.playerIds.slice(0, 4), startingHole: 10 }],
    })) };
    const initial = await f.quick.create(f.id, input);
    const games: readonly RoundGameDefinition[] = [
      { id: identifier(8300), name: 'Fictional one-foursome Skins', kind: 'skins', version: 1, basis: 'gross',
        carryovers: true, carryOrder: 'shared-group-v1' },
      { id: identifier(8301), name: 'Fictional SO Stroke', kind: 'stroke-play', version: 1, basis: 'net', handicapRule: 'group-low-v1' },
    ];
    const saved = await f.scores.saveGames(f.actor, f.id, f.roundId, games, null, identifier(8302));
    expect(saved.round.permissions?.role).toBe('public');
    expect(saved.round.gameHandicapRules).toBe(1);
    expect(saved.round.groups[0]?.startingHole).toBe(10);
    const current = await f.quick.load(f.id);
    const changed = { ...input, rounds: input.rounds.map((round) => ({
      ...round, groups: round.groups.map((group) => ({ ...group, startingHole: 14 })),
    })) };
    const edited = await f.quick.save(f.id, current.etag, identifier(8303), changed);
    expect(edited.rounds[0]?.groups[0]?.startingHole).toBe(14);
    expect(edited.etag).not.toBe(initial.etag);
    const scores = await f.scores.write(f.actor, f.id, f.roundId, f.playerId, 14, { kind: 'strokes', strokes: 4 }, null, identifier(8304));
    expect(scores.round.groups[0]?.startingHole).toBe(14);
    expect(scores.round.setupLocked).toBe(true);
    expect(scores.round.games?.configuration.games).toEqual(games);
    expect(scores.round.games?.results[1]?.players.every((player) => player.playingHandicap === null
      && player.status === 'unavailable')).toBe(true);
    const locked = await f.quick.load(f.id);
    await expect(f.quick.save(f.id, locked.etag, identifier(8305), input)).rejects.toMatchObject({ code: 'ROUND_SCORING_STARTED' });
    const rows = new Map(f.rows);
    expect((await f.scores.write(f.actor, f.id, f.roundId, f.playerId, 14,
      { kind: 'strokes', strokes: 4 }, null, identifier(8304))).change).toEqual(scores.change);
    expect(f.rows).toEqual(rows);
  });
  it('edits a created roster before scoring but refuses the same change after the first saved entry', async () => {
    const f = await fixture();
    const initial = await f.quick.create(f.id, f.input);
    const changed = { ...f.input, playerIds: f.input.playerIds.filter((id) => id !== f.peerId),
      rounds: f.input.rounds.map((round) => ({ ...round, groups: round.groups.map((group) => ({
        ...group, playerIds: group.playerIds.filter((id) => id !== f.peerId),
      })).filter((group) => group.playerIds.length > 0) })) };
    const edited = await f.quick.save(f.id, initial.etag, identifier(8260), changed);
    expect(edited.roster.map((player) => player.playerId)).toEqual(changed.playerIds);
    expect(edited.rounds[0]?.scoringStarted).not.toBe(true);
    const scores = await f.scores.get(f.actor, f.id, f.roundId);
    expect(isRoundScores(scores)).toBe(true);
    expect(scores.cards.some((card) => card.playerId === f.peerId)).toBe(false);
    await f.scores.write(f.actor, f.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(8261));
    const locked = await f.quick.load(f.id);
    await expect(f.quick.save(f.id, locked.etag, identifier(8262), f.input))
      .rejects.toMatchObject({ code: 'ROUND_SCORING_STARTED' });
    expect((await f.quick.load(f.id)).roster.map((player) => player.playerId)).toEqual(changed.playerIds);
  });

  it('archives only a ready Quick round, retaining cards/captures and an idempotent public audit without exposing archives', async () => {
    const f = await fixture();
    await f.quick.create(f.id, f.input);
    await f.scores.write(f.actor, f.id, f.roundId, f.peerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(8200));
    const current = await f.quick.load(f.id);
    const cards = new Map([...f.rows].filter(([key]) => key.startsWith(`${f.id}|score-`) || key.startsWith(`${f.id}|index-capture:`)));
    const result = await f.quick.archive(f.id, current.etag, identifier(8201));
    expect(result).toEqual({ eventId: f.id, requestId: identifier(8201), status: 'archived' });
    for (const [key, row] of cards) expect(f.rows.get(key)).toEqual(row);
    const rows = new Map(f.rows);
    expect(await f.quick.archive(f.id, current.etag, identifier(8201))).toEqual(result);
    expect(f.rows).toEqual(rows);
    expect(JSON.parse(String(f.rows.get(`${f.id}|quick-archive:${identifier(8201)}`)?.content)))
      .toMatchObject({ recordedBy: f.actor, before: 'active', after: 'archived' });
    expect((await f.publicEvents.list({ kind: 'public-browse' })).events.some((entry) => entry.id === f.id)).toBe(false);
    await expect(f.quick.load(f.id)).rejects.toMatchObject({ code: 'PUBLIC_EVENT_NOT_AVAILABLE' });
    await expect(f.scores.get(f.actor, f.id, f.roundId)).rejects.toMatchObject({ code: 'PUBLIC_EVENT_NOT_AVAILABLE' });
    await expect(f.quick.archive(event.id, f.saved.etag, identifier(8202))).rejects.toMatchObject({ code: 'QUICK_ROUND_MANAGEMENT_FORBIDDEN' });
    await expect(f.quick.archive(f.id, 'different-revision', identifier(8201))).rejects.toMatchObject({ code: 'QUICK_ARCHIVE_REQUEST_CONFLICT' });
  });

  it('refuses stale archiving when a score commits concurrently, without publishing an archive audit', async () => {
    const f = await fixture();
    const saved = await f.quick.create(f.id, f.input);
    f.submit.mockImplementationOnce(async (actions) => {
      await f.scores.write(f.actor, f.id, f.roundId, f.peerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(8210));
      f.apply(actions);
      return { status: 202, subResponses: [], getResponseForEntity: () => undefined };
    });
    await expect(f.quick.archive(f.id, saved.etag, identifier(8211))).rejects.toMatchObject({ code: 'EVENT_CHANGED' });
    expect((await f.quick.load(f.id)).event.status).toBe('active');
    expect(f.rows.has(`${f.id}|quick-archive:${identifier(8211)}`)).toBe(false);
  });
  it('keeps interrupted creation out of discovery and resumes the same event without publishing a partial setup', async () => {
    const f = await fixture();
    f.submit.mockRejectedValueOnce(new Error('Fictional interrupted publication'));
    await expect(f.quick.create(f.id, f.input)).rejects.toThrow('Fictional interrupted publication');
    expect((await f.publicEvents.list({ kind: 'public-browse' })).events.some((entry) => entry.id === f.id)).toBe(false);
    const saved = await f.quick.create(f.id, f.input);
    expect(saved.rounds).toHaveLength(1);
    expect((await f.publicEvents.list({ kind: 'public-browse' })).events.find((entry) => entry.id === f.id))
      .toMatchObject({ quickRound: true, role: 'viewer' });
  });
  it('creates one public round with multiple groups, replays without duplicate writes, and rejects changed retry payloads', async () => {
    const f = await fixture();
    const saved = await f.quick.create(f.id, f.input);
    expect(isEventWorkspace(saved)).toBe(true);
    expect(saved).toMatchObject({ quickRound: true, publicAccess: true, event: { role: 'viewer', quickRound: true } });
    expect(saved.rounds[0]?.groups).toHaveLength(2);
    expect([...f.rows.keys()].some((key) => key.startsWith(`${f.id}|member:`))).toBe(false);
    const rows = new Map(f.rows);
    expect(await f.quick.create(f.id, f.input)).toEqual(saved);
    expect(f.rows).toEqual(rows);
    await expect(f.quick.create(f.id, { ...f.input, name: 'Changed retry' })).rejects.toMatchObject({ code: 'QUICK_ROUND_REQUEST_CONFLICT' });
    expect(f.rows).toEqual(rows);
    const audit = f.rows.get(`${f.id}|quick-setup-change:${f.id}`);
    expect(JSON.parse(await privateContent(f.table, f.id, `quick-setup-change:${f.id}`, audit?.content)))
      .toMatchObject({ recordedBy: f.actor, requestId: f.id, input: f.input });
  });

  it('keeps global selections scalar-only and course provenance private, with complete cursor paging', async () => {
    const f = await fixture();
    const player = await f.players.get(creator, f.playerId);
    await f.players.observe(creator, f.playerId, identifier(8001), {
      value: '+2.1', effectiveDate: '2026-01-01', source: 'Fictional private source',
    }, player.etag);
    for (let index = 0; index < 47; index++) await f.players.create(creator, identifier(8100 + index), `Fictional selection ${String(index)}`);
    const courses = await f.quick.courses();
    const players = await f.quick.players();
    expect(isQuickPage(courses, isQuickCourse)).toBe(true);
    expect(isQuickPage(players, isQuickPlayer)).toBe(true);
    expect(players.items).toHaveLength(50);
    expect(players.continuationToken).toBeDefined();
    const rest = await f.quick.players(players.continuationToken);
    expect(rest.items).toHaveLength(5);
    expect(rest.continuationToken).toBeUndefined();
    expect([...players.items, ...rest.items].find((entry) => entry.id === f.playerId)?.handicapIndexValue).toBe('+2.1');
    const course = courses.items[0];
    if (!course) throw new Error('Missing fictional course');
    const version = await f.quick.version(course.id, course.latestVersionId);
    expect(isQuickCourseVersion(version)).toBe(true);
    expect(JSON.stringify({ courses, players, rest, version })).not.toMatch(/recordedBy|currentIndex|provenance|importedAt|effectiveDate|Fictional private source|tenantId|objectId|etag/);
  });

  it('allows shared setup edits with immutable retry receipts and rejects stale concurrent edits', async () => {
    const f = await fixture();
    const initial = await f.quick.create(f.id, f.input);
    const changed = { ...f.input, name: 'Fictional shared edit' };
    const saved = await f.quick.save(f.id, initial.etag, identifier(8020), changed);
    expect(saved.event.name).toBe(changed.name);
    const rows = new Map(f.rows);
    expect(await f.quick.save(f.id, initial.etag, identifier(8020), changed)).toEqual(saved);
    expect(f.rows).toEqual(rows);
    await expect(f.quick.save(f.id, initial.etag, identifier(8021), f.input)).rejects.toMatchObject({ code: 'EVENT_CHANGED' });
    await expect(f.quick.save(f.id, initial.etag, identifier(8020), f.input)).rejects.toMatchObject({ code: 'PRIVATE_UPLOAD_CONFLICT' });
  });

  it('freezes every golfer at the first public score and refuses setup unlocks after scores are cleared', async () => {
    const f = await fixture();
    await f.quick.create(f.id, f.input);
    const first = await f.scores.write(f.actor, f.id, f.roundId, f.peerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(8030));
    const profile = await f.players.get(creator, f.playerId);
    await f.players.observe(creator, f.playerId, identifier(8031), {
      value: '12.3', effectiveDate: '2026-02-01', source: 'Fictional later index',
    }, profile.etag);
    const workspace = await f.quick.load(f.id);
    expect(workspace.roster.find((entry) => entry.playerId === f.playerId)?.handicapIndexValue).toBe('12.3');
    expect(workspace.rounds[0]?.players.find((entry) => entry.playerId === f.playerId)?.handicapIndexValue).toBeNull();
    const card = first.round.cards.find((entry) => entry.playerId === f.peerId);
    if (!card?.etag) throw new Error('Missing fictional saved card');
    await f.scores.write(f.actor, f.id, f.roundId, f.peerId, 1, { kind: 'unplayed' }, card.etag, identifier(8032));
    const fresh = await f.quick.load(f.id);
    expect(fresh.rounds[0]?.scoringStarted).toBe(true);
    await expect(f.quick.save(f.id, fresh.etag, identifier(8033), {
      ...f.input, rounds: f.input.rounds.map((round) => ({ ...round, groups: [...round.groups].reverse() })),
    })).rejects.toMatchObject({ code: 'ROUND_SCORING_STARTED' });
    expect((await f.scores.get(f.actor, f.id, f.roundId)).courseHandicaps).toEqual(first.round.courseHandicaps);
  });

  it('atomically rejects a setup publication racing the first score, without publishing a setup receipt or changing groups', async () => {
    const f = await fixture();
    const initial = await f.quick.create(f.id, f.input);
    f.submit.mockImplementationOnce(async (actions) => {
      await f.scores.write(f.actor, f.id, f.roundId, f.peerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(8034));
      f.apply(actions);
      return { status: 202, subResponses: [], getResponseForEntity: () => undefined };
    });
    await expect(f.quick.save(f.id, initial.etag, identifier(8035), {
      ...f.input, rounds: f.input.rounds.map((round) => ({ ...round, groups: [...round.groups].reverse() })),
    })).rejects.toMatchObject({ code: 'EVENT_CHANGED' });
    const current = await f.quick.load(f.id);
    expect(current.rounds[0]?.groups).toEqual(initial.rounds[0]?.groups);
    expect(current.rounds[0]?.scoringStarted).toBe(true);
    expect(f.rows.has(`${f.id}|setup-receipt:${identifier(8035)}`)).toBe(false);
    expect(f.rows.has(`${f.id}|quick-setup-change:${identifier(8035)}`)).toBe(false);
  });

  it('uses the existing game engine, public event audit actor and conditional retries without owner membership', async () => {
    const f = await fixture();
    await f.quick.create(f.id, f.input);
    const games = [{ id: identifier(8040), name: 'Fictional shared Stableford', basis: 'gross' as const,
      preset: 'standard' as const, handicapAllowancePercent: 95, points: stablefordPoints('standard') }];
    const result = await f.scores.saveGames(f.actor, f.id, f.roundId, games, null, identifier(8041));
    expect(isGameWriteResult(result)).toBe(true);
    expect(isRoundScores(result.round)).toBe(true);
    expect(result.round.permissions).toMatchObject({ role: 'public', canManageGames: true });
    expect(result.change.recordedBy).toEqual(f.actor);
    expect((await f.scores.saveGames(f.actor, f.id, f.roundId, games, null, identifier(8041))).change).toEqual(result.change);
    await expect(f.scores.saveGames(f.actor, f.id, f.roundId, games, null, identifier(8042))).rejects.toMatchObject({ code: 'GAMES_CHANGED' });
    expect([...f.rows.keys()].some((key) => key.startsWith(`${f.id}|member:`))).toBe(false);
  });

  it('accepts existing team/stroke/Churchy definitions through the shared engine and honors the Churchy kill switch', async () => {
    const f = await fixture();
    await f.quick.create(f.id, f.input);
    const games: readonly RoundGameDefinition[] = [
      { id: identifier(8070), name: 'Fictional Skins', kind: 'skins', version: 1, basis: 'net', carryovers: false },
      { id: identifier(8071), name: 'Fictional Ball Drop', kind: 'ball-drop', version: 1, basis: 'net',
        format: 'ball-drop-net-gross', teams: f.input.rounds[0]?.groups.map((group) => ({
          id: identifier(8080 + group.number), name: `Fictional team ${String(group.number)}`, playerIds: group.playerIds,
        })) ?? [] },
      { id: identifier(8072), name: 'Churchy Game', kind: 'churchy', version: 1, basis: 'net',
        groupNumber: 1, playerIds: f.input.playerIds.slice(0, 4), amountPerDotMinor: 0, currency: 'USD' },
    ];
    const result = await f.scores.saveGames(f.actor, f.id, f.roundId, games, null, identifier(8073));
    expect(result.round.games?.configuration.games).toEqual(games);
    expect(isGameWriteResult(result)).toBe(true);
    const disabled = new TableScoreStore(f.table, f.workspace, () => false);
    const changed = games.map((game) => game.kind === 'churchy' ? { ...game, amountPerDotMinor: 1 } : game);
    await expect(disabled.saveGames(f.actor, f.id, f.roundId, changed, result.round.games?.configuration.etag ?? null, identifier(8074)))
      .rejects.toMatchObject({ code: 'CHURCHY_DISABLED' });
    expect((await disabled.get(f.actor, f.id, f.roundId)).churchyEnabled).toBe(false);
  });

  it('never promotes ordinary events or grants public catalogs, archive access, extra rounds or overall management', async () => {
    const f = await fixture();
    await expect(f.quick.load(event.id)).rejects.toMatchObject({ code: 'QUICK_ROUND_MANAGEMENT_FORBIDDEN' });
    await expect(f.quick.create(event.id, f.input)).rejects.toMatchObject({ code: 'QUICK_ROUND_REQUEST_CONFLICT' });
    await expect(f.workspace.save({ kind: 'public-score', eventId: event.id }, event.id, f.input, f.saved.etag,
      { id: identifier(8050), sha256: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'QUICK_ROUND_MANAGEMENT_FORBIDDEN' });
    await expect(f.scores.saveGames({ kind: 'public-score', eventId: event.id }, event.id, f.roundId, [{
      id: identifier(8051), name: 'Forbidden', basis: 'gross', preset: 'standard',
      handicapAllowancePercent: 95, points: stablefordPoints('standard'),
    }], null, identifier(8052))).rejects.toMatchObject({ code: 'SCORES_OWNER_REQUIRED' });
    await expect(f.quick.create(f.id, { ...f.input, rounds: [...f.input.rounds, { ...f.input.rounds[0], id: identifier(8053) }] }))
      .rejects.toMatchObject({ code: 'INVALID_QUICK_ROUND_SETUP' });
    await expect(f.quick.create(f.id, { ...f.input, overallCompetition: { kind: 'stroke-play', basis: 'gross' } }))
      .rejects.toMatchObject({ code: 'INVALID_QUICK_ROUND_SETUP' });
    await f.quick.create(f.id, f.input);
    const row = f.rows.get(`${f.id}|event`);
    f.seed({ ...row, partitionKey: f.id, rowKey: 'event', status: 'archived' });
    await expect(f.quick.load(f.id)).rejects.toMatchObject({ code: 'PUBLIC_EVENT_NOT_AVAILABLE' });
  });
});

describe('Quick round HTTP boundary', () => {
  it('charges shared site/event archive budgets, requires an empty conditional request and returns no archived data', async () => {
    const f = await fixture();
    const saved = await f.quick.create(f.id, f.input);
    const limiter = { check: vi.fn().mockResolvedValue(undefined) };
    const context = new InvocationContext({ invocationId: 'fictional-public-archive', logHandler: () => undefined });
    const invoke = (body: unknown) => createQuickRoundHandler(() => ({ quickRounds: f.quick, limiter }), 'archive')(new HttpRequest({
      method: 'PUT', url: `https://fictional.example.test/api/public/quick-rounds/${f.id}/archive`, params: { id: f.id },
      headers: { 'Content-Type': 'application/json', 'If-Match': saved.etag, 'Idempotency-Key': identifier(8220) },
      body: { string: JSON.stringify(body) },
    }), context);
    expect((await invoke({ status: 'active' })).status).toBe(400);
    limiter.check.mockClear();
    const result = await invoke({});
    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({ eventId: f.id, requestId: identifier(8220), status: 'archived' });
    expect(limiter.check).toHaveBeenNthCalledWith(1, { kind: 'public-browse' }, 'events-manage');
    expect(limiter.check).toHaveBeenNthCalledWith(2, f.actor, 'events-manage');
    expect(JSON.stringify(result.jsonBody)).not.toMatch(/name|roster|scores|recordedBy|etag/);
  });
  it('serves shared game writes only for a Quick round, preserving private history denial and bounded bodies', async () => {
    const f = await fixture();
    await f.quick.create(f.id, f.input);
    const api = { ...f, quickRounds: f.quick, limiter: { check: vi.fn().mockResolvedValue(undefined) } };
    const context = new InvocationContext({ invocationId: 'fictional-quick-games', logHandler: () => undefined });
    const body = { games: [{ id: identifier(8060), name: 'Fictional shared Skins', kind: 'skins',
      version: 1, basis: 'gross', carryovers: false }] };
    const invoke = (id: string, value: unknown = body) => createPublicHandler(() => api, 'games')(new HttpRequest({
      method: 'PUT', url: `https://fictional.example.test/api/public/events/${id}/rounds/${f.roundId}/games`,
      params: { id, roundId: f.roundId },
      headers: { 'Content-Type': 'application/json', 'If-None-Match': '*', 'Idempotency-Key': identifier(8061) },
      body: { string: JSON.stringify(value) },
    }), context);
    const result = await invoke(f.id);
    expect(result.status).toBe(200);
    expect(isGameWriteResult(result.jsonBody)).toBe(true);
    expect(api.limiter.check).toHaveBeenNthCalledWith(1, { kind: 'public-browse' }, 'setup-write');
    expect(api.limiter.check).toHaveBeenNthCalledWith(2, f.actor, 'scores-write');
    expect((await invoke(event.id)).status).toBe(403);
    expect((await invoke(f.id, { padding: 'x'.repeat(12288) })).status).toBe(413);
  });
  it('charges site and event budgets, enforces revisions and never accepts writes after quota failure', async () => {
    const f = await fixture();
    const limiter = { check: vi.fn().mockResolvedValue(undefined) };
    const context = new InvocationContext({ invocationId: 'fictional-quick', logHandler: () => undefined });
    const invoke = (action: QuickRoundAction, method: string, body?: unknown, headers: Record<string, string> = {}) =>
      createQuickRoundHandler(() => ({ quickRounds: f.quick, limiter }), action)(new HttpRequest({
        method, url: 'https://fictional.example.test/api/public/quick-rounds',
        params: { id: f.id }, headers: { 'Content-Type': 'application/json',
          'Idempotency-Key': f.id, 'If-None-Match': '*', ...headers },
        ...(body === undefined ? {} : { body: { string: JSON.stringify(body) } }),
      }), context);
    expect((await invoke('create', 'PUT', f.input)).status).toBe(200);
    expect(limiter.check).toHaveBeenNthCalledWith(1, { kind: 'public-browse' }, 'events-create');
    expect(limiter.check).toHaveBeenNthCalledWith(2, f.actor, 'setup-write');
    expect((await invoke('workspace', 'PUT', f.input)).status).toBe(400);
    expect((await invoke('courses', 'POST')).status).toBe(405);
    expect((await invoke('workspace', 'GET')).jsonBody).toMatchObject({ quickRound: true });
    const rows = new Map(f.rows);
    limiter.check.mockRejectedValueOnce(new ApiError(429, 'REQUEST_LIMIT_EXCEEDED'));
    expect((await invoke('create', 'PUT', f.input)).status).toBe(429);
    expect(f.rows).toEqual(rows);
  });
});
