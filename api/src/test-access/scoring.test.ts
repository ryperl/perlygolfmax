import { describe, expect, it, vi } from 'vitest';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { isEventWorkspace } from '../../../src/contracts/setup.js';
import { isRoundScores, isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { roundMatchesSnapshot } from '../../../src/contracts/round-context.js';
import { stablefordPoints } from '../../../src/domain/stableford.js';
import { TablePurseStore } from '../purse/store.js';
import { stagePrivateContent, privateContent } from '../private-values.js';
import { TableTesterAccessStore } from './store.js';
import { testerFixture } from './test-support.js';
import { scoringLock } from '../scoring/lock.js';

describe('event-scoped tester scoring authority', () => {
  it('derives net games and overall handicaps from private server captures without exposing observations', async () => {
    const f = await testerFixture();
    for (const [index, playerId] of f.input.playerIds.entries()) {
      const profile = await f.players.get(creator, playerId);
      await f.players.observe(creator, playerId, identifier(3300 + index), {
        value: '18.0', effectiveDate: '2026-01-01', source: 'Fictional private tester observation',
      }, profile.etag);
    }
    const before = await f.workspace.get(creator, event.id);
    const captured = await f.workspace.refreshIndices(creator, event.id, f.roundId, identifier(3400), before.etag);
    await f.workspace.save(creator, event.id, { ...f.input,
      overallCompetition: { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 95 },
    }, captured.etag);
    await f.scores.saveGames(creator, event.id, f.roundId, [{ id: identifier(3401), name: 'Fictional tester net',
      preset: 'standard', basis: 'net', handicapAllowancePercent: 95, points: stablefordPoints('standard') }], null, identifier(3402));
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.peerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(3403));
    const owner = await f.scores.get(creator, event.id, f.roundId);
    expect(saved.round.games).toEqual(owner.games);
    expect(saved.round.overallHandicaps).toEqual(owner.overallHandicaps);
    expect(isRoundScores(saved.round)).toBe(true);
    const publicText = JSON.stringify({ saved, workspace: await f.workspace.get(f.actor, event.id) });
    expect(publicText).not.toContain('handicapIndex');
    expect(publicText).not.toContain('Fictional private tester observation');
    expect(publicText).not.toContain(creator.objectId);
  });
  it('reads and scores every saved group as tester, without private inputs or management authority', async () => {
    const f = await testerFixture();
    const workspace = await f.workspace.get(f.actor, event.id);
    expect(isEventWorkspace(workspace)).toBe(true);
    expect(workspace).toMatchObject({ testerAccess: true, canViewScores: true, event: { role: 'viewer' } });
    expect(workspace.viewerPlayerId).toBeUndefined();
    expect(JSON.stringify(workspace)).not.toContain('handicapIndex');
    const round = await f.scores.get(f.actor, event.id, f.roundId);
    expect(isRoundScores(round)).toBe(true);
    expect(round.cards).toHaveLength(8);
    expect(round.permissions).toEqual({ role: 'tester', writePlayerIds: f.input.playerIds, canManageGames: false });
    const snapshot = workspace.rounds[0];
    if (!snapshot) throw new Error('Missing fictional round');
    expect(roundMatchesSnapshot(workspace, snapshot, round)).toBe(true);
    for (const [index, playerId] of [f.peerId, f.foreignId].entries()) {
      const result = await f.scores.write(f.actor, event.id, f.roundId, playerId, 1, { kind: 'picked-up', reportedStrokes: 7 }, null, identifier(3100 + index));
      expect(isScoreWriteResult(result)).toBe(true);
      expect(result.change.recordedBy).toEqual(f.actor);
      expect(JSON.stringify(result)).not.toContain('tenantId');
      expect(JSON.stringify(result)).not.toContain('handicapIndex');
      expect((await scoringLock(f.table, event.id, f.roundId))?.startedBy).toEqual(f.actor);
    }
    expect(f.rows.has(`${event.id}|member:undefined`)).toBe(false);
    expect(f.row(`tester-link:${f.linkId}`)).not.toHaveProperty('role');
    await expect(f.scores.history(f.actor, event.id, f.roundId, f.peerId)).rejects.toMatchObject({ status: 403 });
  });

  it('replays lost-response writes with a tester actor and rejects a different actor reusing the receipt', async () => {
    const f = await testerFixture();
    f.submit.mockImplementationOnce((actions) => { f.apply(actions); return Promise.reject(new Error('Fictional lost response')); });
    const score = { kind: 'strokes' as const, strokes: 4 };
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.peerId, 1, score, null, identifier(3100));
    expect(await f.scores.write(f.actor, event.id, f.roundId, f.peerId, 1, score, null, identifier(3100))).toEqual(saved);
    await expect(f.scores.write(creator, event.id, f.roundId, f.peerId, 1, score, null, identifier(3100)))
      .rejects.toMatchObject({ code: 'SCORE_REQUEST_CONFLICT' });
    await f.revoke();
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.peerId, 1, score, null, identifier(3100)))
      .rejects.toMatchObject({ status: 403 });
  });

  it('blocks forged cross-event and cross-round targets and retains account-only management contracts', async () => {
    const f = await testerFixture();
    await expect(f.scores.get(f.actor, identifier(9999), f.roundId)).rejects.toMatchObject({ status: 403 });
    await expect(f.scores.get(f.actor, event.id, identifier(9999))).rejects.toMatchObject({ status: 404 });
    await expect(f.scores.write(f.actor, event.id, f.roundId, identifier(9999), 1, { kind: 'strokes', strokes: 4 }, null, identifier(3100)))
      .rejects.toMatchObject({ status: 404 });
    // Deliberately hostile runtime input: public endpoints still verify JWT independently.
    const forged = { ...creator, ...f.actor };
    const game = { id: identifier(3102), name: 'Fictional game', preset: 'standard' as const, basis: 'gross' as const,
      handicapAllowancePercent: 95, points: stablefordPoints('standard') };
    await expect(f.scores.saveGames(forged, event.id, f.roundId, [game], null, identifier(3103))).rejects.toMatchObject({ status: 403 });
    await expect(f.workspace.save(forged, event.id, f.input, (await f.workspace.get(creator, event.id)).etag)).rejects.toMatchObject({ status: 403 });
    const purse = new TablePurseStore(f.table, f.workspace, f.scores);
    await expect(purse.get(forged, event.id, vi.fn().mockResolvedValue(undefined))).rejects.toMatchObject({ status: 403 });
  });

  it.each(['grant-only', 'owner-revoke', 'archive', 'grant-revision'] as const)(
    'atomically rejects a %s race without publishing a card, audit or first-score lock', async (race) => {
      const f = await testerFixture();
      f.submit.mockImplementationOnce(async (actions) => {
        if (race === 'grant-only') f.seed({ ...f.row(`tester-link:${f.linkId}`), state: 'revoked' });
        if (race === 'owner-revoke') await f.revoke();
        if (race === 'archive') f.seed({ ...f.row('event'), status: 'archived' });
        if (race === 'grant-revision') {
          f.seed({ ...f.row(`tester-link:${f.linkId}`), revision: identifier(3999) });
        }
        f.apply(actions);
        return { status: 202, subResponses: [], getResponseForEntity: () => undefined };
      });
      await expect(f.scores.write(f.actor, event.id, f.roundId, f.peerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(3100)))
        .rejects.toMatchObject({ status: 409 });
      expect(f.rows.has(`${event.id}|score-card:${f.roundId}:${f.peerId}`)).toBe(false);
      expect(f.rows.has(`${event.id}|score-change:${identifier(3100)}`)).toBe(false);
      expect(f.rows.has(`${event.id}|score-lock:${f.roundId}`)).toBe(false);
    },
  );

  it('conditionally checks the actual card revision independently of grant/event races', async () => {
    const f = await testerFixture();
    const first = await f.scores.write(f.actor, event.id, f.roundId, f.peerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(3100));
    const card = first.round.cards.find((entry) => entry.playerId === f.peerId);
    if (!card?.etag) throw new Error('Missing fictional card');
    f.submit.mockImplementationOnce((actions) => {
      f.seed({ ...f.row(`score-card:${f.roundId}:${f.peerId}`) });
      f.apply(actions);
      return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
    });
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.peerId, 2, { kind: 'strokes', strokes: 5 }, card.etag, identifier(3101)))
      .rejects.toMatchObject({ status: 409 });
    expect(f.rows.has(`${event.id}|score-change:${identifier(3101)}`)).toBe(false);
    expect((await f.scores.get(f.actor, event.id, f.roundId)).cards.find((entry) => entry.playerId === f.peerId)?.holes[1]?.score)
      .toEqual({ kind: 'unplayed' });
  });

  it('rechecks expiry immediately before publishing after async card reads', async () => {
    const f = await testerFixture();
    const get = f.get.getMockImplementation();
    if (!get) throw new Error('Missing fictional reader');
    const clock = vi.spyOn(Date, 'now');
    const now = Date.parse(String(f.row(`tester-link:${f.linkId}`).expiresAt));
    f.get.mockImplementation(async (partition, key, options) => {
      try { return await get(partition, key, options); }
      finally { if (key === `score-card:${f.roundId}:${f.peerId}`) clock.mockReturnValue(now); }
    });
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.peerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(3100)))
      .rejects.toMatchObject({ status: 403 });
    expect(f.rows.has(`${event.id}|score-lock:${f.roundId}`)).toBe(false);
    expect(f.rows.has(`${event.id}|score-change:${identifier(3100)}`)).toBe(false);
    clock.mockRestore();
  });

  it('supports tester-owned large immutable fragments without fabricated account fields', async () => {
    const f = await testerFixture();
    const text = JSON.stringify({ fictional: 'x'.repeat(60_000) });
    const pointer = await stagePrivateContent(f.table, event.id, 'score-lock:fictional', f.actor, text);
    expect(await privateContent(f.table, event.id, 'score-lock:fictional', pointer)).toBe(text);
    const fragments = [...f.rows.values()].filter((row) => row.kind === 'private-fragment');
    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments.every((row) => row.ownerTenantId === undefined && row.ownerObjectId === undefined)).toBe(true);
  });

  it('permits a one-golfer saved event through the same tester grant', async () => {
    const f = await scoringFixture(1);
    const testers = new TableTesterAccessStore(f.table);
    await testers.create(creator, event.id, { linkId: identifier(3000), tokenHash: '0'.repeat(64) }, f.saved.etag, identifier(3001));
    const actor = { kind: 'tester-link' as const, eventId: event.id, linkId: identifier(3000) };
    const result = await f.scores.write(actor, event.id, f.roundId, f.playerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(3100));
    expect(isScoreWriteResult(result)).toBe(true);
    expect(result.round.permissions?.writePlayerIds).toEqual([f.playerId]);
  });
});
