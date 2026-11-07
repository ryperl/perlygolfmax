import { describe, expect, it, vi } from 'vitest';
import { creator, event, member } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { isEventWorkspace } from '../../../src/contracts/setup.js';
import { isRoundScores, isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { isEventLeaderboardView } from '../../../src/contracts/event-leaderboard.js';
import { isEventPurseView } from '../../../src/contracts/purse-settings.js';
import { roundMatchesSnapshot } from '../../../src/contracts/round-context.js';
import { stablefordPoints } from '../../../src/domain/stableford.js';
import { scoringLock } from '../scoring/lock.js';
import { TablePurseStore } from '../purse/store.js';
import { TableEventStore } from '../events/store.js';
import { stagePrivateContent, privateContent } from '../private-values.js';
import { publicFixture } from './test-support.js';

describe('active event public scoring authority', () => {
  it('projects saved start/end dates through the public directory and workspace', async () => {
    const f = await publicFixture();
    const before = await f.workspace.get(creator, event.id);
    await f.workspace.save(creator, event.id, { ...f.input, startDate: '2026-11-06', endDate: '2026-11-10' }, before.etag);
    const workspace = await f.workspace.get(f.actor, event.id);
    expect(workspace.event).toMatchObject({ startDate: '2026-11-06', endDate: '2026-11-10' });
    const directory = await f.publicEvents.list({ kind: 'public-browse' });
    expect(directory.events[0]).toMatchObject({ startDate: '2026-11-06', endDate: '2026-11-10' });
  });
  it('projects saved event/round dates for public readers without raw indices or owner identity', async () => {
    const f = await publicFixture();
    const before = await f.workspace.get(creator, event.id);
    await f.workspace.save(creator, event.id, { ...f.input, startDate: '2024-02-29',
      rounds: f.input.rounds.map((round) => ({ ...round, startDate: '2026-11-06' })) }, before.etag);
    const workspace = await f.workspace.get(f.actor, event.id);
    expect(workspace.event).toMatchObject({ startDate: '2024-02-29', role: 'viewer' });
    expect(workspace.rounds[0]?.startDate).toBe('2026-11-06');
    expect(isEventWorkspace(workspace)).toBe(true);
    expect(JSON.stringify(workspace)).not.toContain(creator.objectId);
    expect(workspace.rounds[0]?.players.every((player) => player.handicapIndex === undefined)).toBe(true);
  });
  it('exposes saved course-local tee times in the existing public round projection', async () => {
    const f = await publicFixture();
    const before = await f.workspace.get(creator, event.id);
    await f.workspace.save(creator, event.id, { ...f.input, rounds: f.input.rounds.map((round) => ({ ...round, teeTime: '08:30' })) }, before.etag);
    const workspace = await f.workspace.get(f.actor, event.id);
    expect(workspace.rounds[0]?.teeTime).toBe('08:30');
    expect(isEventWorkspace(workspace)).toBe(true);
  });
  it('publishes the purse-presence flag for public events without publishing configuration or money in the workspace', async () => {
    const f = await publicFixture();
    expect((await f.workspace.get(f.actor, event.id)).purseConfigured).toBe(false);
    const stored = f.rows.get(`${event.id}|event`);
    if (!stored) throw new Error('Missing fictional event.');
    f.rows.set(`${event.id}|event`, { ...stored, purseConfigured: true });
    const workspace = await f.workspace.get(f.actor, event.id);
    expect(workspace.purseConfigured).toBe(true);
    expect(workspace).not.toHaveProperty('plan');
    expect(workspace).not.toHaveProperty('configuration');
    expect(isEventWorkspace(workspace)).toBe(true);
  });
  it('publishes each group starting hole through public workspace, scores and acknowledged score writes', async () => {
    const f = await publicFixture();
    const before = await f.workspace.get(creator, event.id);
    const input = { ...f.input, rounds: f.input.rounds.map((round) => ({
      ...round, groups: round.groups.map((group, index) => ({ ...group, startingHole: index === 0 ? 10 : 18 })),
    })) };
    await f.workspace.save(creator, event.id, input, before.etag);
    const workspace = await f.workspace.get(f.actor, event.id);
    const scores = await f.scores.get(f.actor, event.id, f.roundId);
    expect(workspace.rounds[0]?.groups).toEqual(input.rounds[0]?.groups);
    expect(scores.groups).toEqual(input.rounds[0]?.groups);
    expect(isEventWorkspace(workspace)).toBe(true);
    expect(isRoundScores(scores)).toBe(true);
    const snapshot = workspace.rounds[0];
    if (!snapshot) throw new Error('Missing fictional public starting-hole round');
    expect(roundMatchesSnapshot(workspace, snapshot, scores)).toBe(true);
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.peerId, 18,
      { kind: 'strokes', strokes: 4 }, null, identifier(4099));
    expect(saved.round.groups).toEqual(scores.groups);
    expect(isScoreWriteResult(saved)).toBe(true);
    expect((await f.workspace.get(f.actor, event.id)).rounds[0]?.groups).toEqual(scores.groups);
  });

  it('reads and scores every saved group as explicit public, never creating membership or admission', async () => {
    const f = await publicFixture();
    const keys = new Set(f.rows.keys());
    const workspace = await f.workspace.get(f.actor, event.id);
    expect(isEventWorkspace(workspace)).toBe(true);
    expect(workspace).toMatchObject({ publicAccess: true, canViewScores: true, event: { role: 'viewer' } });
    expect(workspace.viewerPlayerId).toBeUndefined();
    expect(workspace.testerAccess).toBeUndefined();
    const round = await f.scores.get(f.actor, event.id, f.roundId);
    expect(isRoundScores(round)).toBe(true);
    expect(round.cards).toHaveLength(8);
    expect(round.permissions).toEqual({ role: 'public', writePlayerIds: f.input.playerIds, canManageGames: false });
    const snapshot = workspace.rounds[0];
    if (!snapshot) throw new Error('Missing fictional public round');
    expect(roundMatchesSnapshot(workspace, snapshot, round)).toBe(true);
    const { publicAccess: removed, ...legacyWorkspace } = workspace;
    void removed;
    expect(roundMatchesSnapshot(legacyWorkspace, snapshot, round)).toBe(false);
    for (const [index, playerId] of [f.peerId, f.foreignId].entries()) {
      const saved = await f.scores.write(f.actor, event.id, f.roundId, playerId, 1,
        { kind: 'picked-up', reportedStrokes: 7 }, null, identifier(4100 + index));
      expect(isScoreWriteResult(saved)).toBe(true);
      expect(saved.change.recordedBy).toEqual({ kind: 'public-score', eventId: event.id });
      expect((await scoringLock(f.table, event.id, f.roundId))?.startedBy).toEqual(f.actor);
      const actions = f.submit.mock.calls[index]?.[0];
      expect(actions?.filter((action) => action[1].rowKey === 'event')).toHaveLength(1);
      expect(new Set(actions?.map((action) => action[1].rowKey)).size).toBe(actions?.length);
      expect(actions?.some((action) => action[1].rowKey.startsWith('member:'))).toBe(false);
      expect(JSON.stringify(saved)).not.toContain('tenantId');
      expect(JSON.stringify(saved)).not.toContain('handicapIndex');
    }
    const created = [...f.rows.keys()].filter((key) => !keys.has(key));
    expect(created.every((key) => /score-(card|change|lock):/.test(key))).toBe(true);
    const accountEvents = await new TableEventStore(f.table).list(member);
    expect(accountEvents.events).toEqual([]);
    await expect(f.workspace.get(member, event.id)).rejects.toMatchObject({ status: 404 });
    await expect(f.scores.history(f.actor, event.id, f.roundId, f.peerId)).rejects.toMatchObject({ status: 403 });
  });

  it('derives identical owner/public net games, overall standings and published purse without raw observations or audit identities', async () => {
    const f = await publicFixture();
    for (const [index, playerId] of f.input.playerIds.entries()) {
      const profile = await f.players.get(creator, playerId);
      await f.players.observe(creator, playerId, identifier(4200 + index), {
        value: '18.0', effectiveDate: '2026-01-01', source: 'Fictional protected public-model observation',
      }, profile.etag);
    }
    const before = await f.workspace.get(creator, event.id);
    const captured = await f.workspace.refreshIndices(creator, event.id, f.roundId, identifier(4300), before.etag);
    await f.workspace.save(creator, event.id, { ...f.input,
      overallCompetition: { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 95 },
    }, captured.etag);
    await f.scores.saveGames(creator, event.id, f.roundId, [{
      id: identifier(4301), name: 'Fictional public net game', preset: 'standard', basis: 'net',
      handicapAllowancePercent: 95, points: stablefordPoints('standard'),
    }], null, identifier(4302));
    const charge = vi.fn().mockResolvedValue(undefined);
    const purse = await f.purse.save(creator, event.id, {
      eventId: event.id, currency: 'USD', funding: { kind: 'fixed', budgetMinor: 12000 },
      pools: [
        { id: identifier(4303), name: 'Fictional published pot', source: { kind: 'manual' },
          awardUnit: 'pot', amountMinor: 9001, recipientIds: f.input.playerIds.slice(0, 3) },
        { id: identifier(4306), name: 'Fictional net game prize', source: { kind: 'round-game', roundId: f.roundId, gameId: identifier(4301) },
          awardUnit: 'per-golfer', tiePolicy: 'pooled', prizes: [{ place: 1, amountMinor: 2000 }] },
      ],
    }, [], null, identifier(4304), charge);
    expect(purse.current.view?.calculation.allocatedMinor).toBe(9000);
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.peerId, 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(4305));
    const ownerScores = await f.scores.get(creator, event.id, f.roundId);
    expect(saved.round.games).toEqual(ownerScores.games);
    expect(saved.round.overallHandicaps).toEqual(ownerScores.overallHandicaps);
    const publicStandings = await f.scores.leaderboard(f.actor, event.id, charge);
    const ownerStandings = await f.scores.leaderboard(creator, event.id, charge);
    expect(isEventLeaderboardView(publicStandings)).toBe(true);
    expect(publicStandings.standings).toEqual(ownerStandings.standings);
    const publicPurse = await f.purse.get(f.actor, event.id, charge);
    const ownerPurse = await f.purse.get(creator, event.id, charge);
    expect(isEventPurseView(publicPurse)).toBe(true);
    expect(publicPurse.configuration).toEqual(ownerPurse.configuration);
    expect(publicPurse.view).toEqual(ownerPurse.view);
    const text = JSON.stringify({ saved, publicStandings, publicPurse });
    for (const privateText of ['handicapIndex', 'observationId', 'Fictional protected public-model observation',
      creator.objectId, creator.tenantId, 'recordedBy', 'startedBy']) {
      // The write receipt deliberately identifies only the explicit shared public actor.
      if (privateText !== 'recordedBy') expect(text).not.toContain(privateText);
      else expect(JSON.stringify({ publicStandings, publicPurse })).not.toContain(privateText);
    }
    expect(charge).toHaveBeenCalled();
  });

  it('replays lost replies, binds operation targets/actors and never promotes public to management', async () => {
    const f = await publicFixture();
    f.submit.mockImplementationOnce((actions) => {
      f.apply(actions);
      return Promise.reject(new Error('Fictional public lost response'));
    });
    const score = { kind: 'strokes' as const, strokes: 4 };
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.peerId, 1, score, null, identifier(4400));
    expect(await f.scores.write({ ...f.actor }, event.id, f.roundId, f.peerId, 1, score, null, identifier(4400))).toEqual(saved);
    for (const [playerId, hole, nextScore, etag] of [
      [f.foreignId, 1, score, null], [f.peerId, 2, score, null],
      [f.peerId, 1, { kind: 'strokes' as const, strokes: 5 }, null],
      [f.peerId, 1, score, saved.round.cards.find((card) => card.playerId === f.peerId)?.etag ?? null],
    ] as const) {
      await expect(f.scores.write(f.actor, event.id, f.roundId, playerId, hole, nextScore, etag, identifier(4400)))
        .rejects.toMatchObject({ code: 'SCORE_REQUEST_CONFLICT' });
    }
    await expect(f.scores.write(creator, event.id, f.roundId, f.peerId, 1, score, null, identifier(4400)))
      .rejects.toMatchObject({ code: 'SCORE_REQUEST_CONFLICT' });
    await expect(f.scores.write({ ...f.actor, eventId: identifier(4999) }, event.id, f.roundId, f.peerId, 1, score, null, identifier(4400)))
      .rejects.toMatchObject({ status: 403, code: 'PUBLIC_EVENT_NOT_AVAILABLE' });
    await expect(f.scores.get(f.actor, identifier(4999), f.roundId)).rejects.toMatchObject({ status: 403 });
    const hostile = { ...creator, ...f.actor };
    await expect(f.workspace.save(hostile, event.id, f.input, f.row('event').etag)).rejects.toMatchObject({ status: 403 });
    await expect(f.scores.saveGames(hostile, event.id, f.roundId, [{
      id: identifier(4401), name: 'Fictional forbidden game', basis: 'gross', preset: 'standard',
      handicapAllowancePercent: 95, points: stablefordPoints('standard'),
    }], null, identifier(4402))).rejects.toMatchObject({ status: 403 });
    expect(f.submit).toHaveBeenCalledTimes(1);
  });

  it.each(['archive', 'event-revision'] as const)('atomically rejects %s races with no card/audit/first lock publication', async (race) => {
    const f = await publicFixture();
    f.submit.mockImplementationOnce((actions) => {
      f.seed({ ...f.row('event'), ...(race === 'archive' ? { status: 'archived' } : {}) });
      f.apply(actions);
      return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
    });
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.peerId, 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(4500))).rejects.toMatchObject({ status: 409 });
    expect(f.rows.has(`${event.id}|score-card:${f.roundId}:${f.peerId}`)).toBe(false);
    expect(f.rows.has(`${event.id}|score-change:${identifier(4500)}`)).toBe(false);
    expect(f.rows.has(`${event.id}|score-lock:${f.roundId}`)).toBe(false);
  });

  it('conditionally rejects card races and preserves immutable history and locked captured setup', async () => {
    const f = await publicFixture();
    const first = await f.scores.write(f.actor, event.id, f.roundId, f.peerId, 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(4600));
    const card = first.round.cards.find((entry) => entry.playerId === f.peerId);
    if (!card?.etag) throw new Error('Missing fictional public card');
    f.submit.mockImplementationOnce((actions) => {
      f.seed({ ...f.row(`score-card:${f.roundId}:${f.peerId}`) });
      f.apply(actions);
      return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
    });
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.peerId, 2,
      { kind: 'strokes', strokes: 5 }, card.etag, identifier(4601))).rejects.toMatchObject({ status: 409 });
    expect(f.rows.has(`${event.id}|score-change:${identifier(4601)}`)).toBe(false);
    expect((await f.scores.get(f.actor, event.id, f.roundId)).cards.find((entry) => entry.playerId === f.peerId)?.holes[1]?.score)
      .toEqual({ kind: 'unplayed' });
    const history = await f.scores.history(creator, event.id, f.roundId, f.peerId);
    expect(history.changes).toEqual([first.change]);
    const current = await f.workspace.get(creator, event.id);
    await expect(f.workspace.save(creator, event.id, {
      ...f.input, rounds: f.input.rounds.map((round) => ({ ...round, groups: [...round.groups].reverse().map((group, index) => ({
        ...group, number: index + 1,
      })) })),
    }, current.etag)).rejects.toMatchObject({ status: 409 });
  });

  it('rejects archived reads, writes, replays and purse and rechecks archive after async reads', async () => {
    const f = await publicFixture();
    const score = { kind: 'strokes' as const, strokes: 4 };
    await f.scores.write(f.actor, event.id, f.roundId, f.peerId, 1, score, null, identifier(4700));
    const read = f.get.getMockImplementation();
    if (!read) throw new Error('Missing fictional table reader');
    f.get.mockImplementation(async (partition, key, options) => {
      const value = await read(partition, key, options);
      if (key === `score-card:${f.roundId}:${f.peerId}`) f.seed({ ...f.row('event'), status: 'archived' });
      return value;
    });
    await expect(f.scores.get(f.actor, event.id, f.roundId)).rejects.toMatchObject({ status: 404, code: 'PUBLIC_EVENT_NOT_AVAILABLE' });
    f.get.mockImplementation(read);
    for (const operation of [
      () => f.workspace.get(f.actor, event.id), () => f.scores.get(f.actor, event.id, f.roundId),
      () => f.scores.leaderboard(f.actor, event.id, vi.fn()),
      () => f.purse.get(f.actor, event.id, vi.fn()),
      () => f.scores.write(f.actor, event.id, f.roundId, f.peerId, 1, score, null, identifier(4700)),
      () => f.scores.write(f.actor, event.id, f.roundId, f.peerId, 1, score, null, identifier(4701)),
    ]) await expect(operation()).rejects.toMatchObject({ status: 404, code: 'PUBLIC_EVENT_NOT_AVAILABLE' });
  });

  it('supports public-owned large lock fragments without invented accounts and permanent one-golfer scoring locks', async () => {
    const f = await scoringFixture(1);
    const actor = { kind: 'public-score' as const, eventId: event.id };
    const text = JSON.stringify({ fictional: 'x'.repeat(60_000) });
    const pointer = await stagePrivateContent(f.table, event.id, 'score-lock:fictional', actor, text);
    expect(await privateContent(f.table, event.id, 'score-lock:fictional', pointer)).toBe(text);
    const fragments = [...f.rows.values()].filter((row) => row.kind === 'private-fragment');
    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments.every((row) => row.ownerTenantId === undefined && row.ownerObjectId === undefined)).toBe(true);
    const saved = await f.scores.write(actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(4800));
    expect(isScoreWriteResult(saved)).toBe(true);
    expect(saved.round.permissions?.writePlayerIds).toEqual([f.playerId]);
    const card = saved.round.cards[0];
    if (!card?.etag) throw new Error('Missing fictional one-golfer card');
    const cleared = await f.scores.write(actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'unplayed' }, card.etag, identifier(4801));
    expect(cleared.round.setupLocked).toBe(true);
    expect((await scoringLock(f.table, event.id, f.roundId))?.startedBy).toEqual(actor);
    await expect(new TablePurseStore(f.table, f.workspace, f.scores).get({ ...actor, eventId: identifier(4999) }, event.id, vi.fn()))
      .rejects.toMatchObject({ status: 403 });
  });
});
