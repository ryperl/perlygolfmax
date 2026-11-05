import { describe, expect, it, vi } from 'vitest';
import { playerFixture } from '../../test/player-fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import { isRoundScores } from '../../../src/contracts/scoring.js';
import { isEventLeaderboardView } from '../../../src/contracts/event-leaderboard.js';
import { isEventPurseView } from '../../../src/contracts/purse-settings.js';
import { stablefordPoints } from '../../../src/domain/stableford.js';
import { TablePurseStore } from '../purse/store.js';
import { TableEventStore } from '../events/store.js';

describe('admitted playing-group score authority', () => {
  it('reads all groups but writes only the current assigned group without promoting membership', async () => {
    const f = await playerFixture();
    const read = await f.scores.get(member, event.id, f.roundId);
    expect(isRoundScores(read)).toBe(true);
    expect(read.cards).toHaveLength(8);
    expect(read.permissions).toEqual({ role: 'player', viewerPlayerId: f.boundPlayerId,
      writePlayerIds: [204, 205, 206, 207].map(identifier), canManageGames: false });
    const saved = await f.scores.write(member, event.id, f.roundId, f.peerId, 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(910));
    expect(saved.change.recordedBy).toEqual(member);
    expect(saved.round.cards.find((card) => card.playerId === f.peerId)?.holes[0]?.score).toEqual({ kind: 'strokes', strokes: 4 });
    const grant = f.rows.get(`${event.id}|member:${member.objectId}`);
    expect(grant).toMatchObject({ role: 'member', playerId: f.boundPlayerId, admissionId: f.inviteId });
    expect(grant?.role).not.toBe('owner');
    await expect(f.scores.write(member, event.id, f.roundId, f.foreignId, 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(911))).rejects.toMatchObject({ status: 403 });
    await expect(f.scores.history(member, event.id, f.roundId, f.peerId)).rejects.toMatchObject({ status: 403 });
  });
  it('uses the saved playing group, not a stale screen or competition team', async () => {
    const f = await playerFixture();
    const current = await f.workspace.get(creator, event.id);
    await f.workspace.save(creator, event.id, { ...f.input, rounds: f.input.rounds.map((round) => ({
      ...round, groups: [
        { number: 1, playerIds: [200, 205, 202, 203].map(identifier) },
        { number: 2, playerIds: [204, 201, 206, 207].map(identifier) },
      ],
    })) }, current.etag);
    await expect(f.scores.write(member, event.id, f.roundId, f.peerId, 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(910))).rejects.toMatchObject({ status: 403 });
    const read = await f.scores.get(member, event.id, f.roundId);
    expect(read.permissions?.writePlayerIds).toEqual([204, 201, 206, 207].map(identifier));
  });
  it('grants readonly access to other active events, never their score writes or management', async () => {
    const f = await playerFixture();
    const otherEvent = identifier(1000);
    const otherRound = identifier(1001);
    f.seed({ partitionKey: otherEvent, rowKey: 'event', name: 'Fictional Other Event', createdAt: '2026-01-01', status: 'active' });
    f.seed({ partitionKey: otherEvent, rowKey: `member:${creator.objectId}`, ...creator, role: 'owner' });
    const empty = await f.workspace.get(creator, otherEvent);
    await f.workspace.save(creator, otherEvent, { ...f.input, rounds: f.input.rounds.map((round) => ({ ...round, id: otherRound })) }, empty.etag);
    const workspace = await f.workspace.get(member, otherEvent);
    expect(workspace.event.role).toBe('viewer');
    expect(workspace.canViewScores).toBe(true);
    expect(workspace.viewerPlayerId).toBeUndefined();
    expect(JSON.stringify(workspace)).not.toContain('handicapIndex');
    const cards = await f.scores.get(member, otherEvent, otherRound);
    expect(cards.permissions).toEqual({ role: 'viewer', writePlayerIds: [], canManageGames: false });
    await expect(f.scores.write(member, otherEvent, otherRound, f.peerId, 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(910))).rejects.toMatchObject({ status: 403 });
    const game = { id: identifier(920), name: 'Fictional game', preset: 'standard' as const, basis: 'gross' as const,
      handicapAllowancePercent: 95, points: stablefordPoints('standard') };
    await expect(f.scores.saveGames(member, event.id, f.roundId, [game], null, identifier(921))).rejects.toMatchObject({ status: 403 });
    await expect(f.scores.receiveGames(member, event.id, f.roundId, { games: [game] }, null, identifier(921)))
      .rejects.toMatchObject({ status: 403 });
    await expect(f.workspace.save(member, otherEvent, f.input, workspace.etag)).rejects.toMatchObject({ status: 403 });
    const purse = new TablePurseStore(f.table, f.workspace, f.scores);
    const read = await purse.get(member, otherEvent, vi.fn().mockResolvedValue(undefined));
    expect(isEventPurseView(read)).toBe(true);
    await expect(purse.save(member, otherEvent, { eventId: otherEvent, currency: 'USD',
      funding: { kind: 'fixed', budgetMinor: 0 }, pools: [] }, [], null, identifier(922), vi.fn().mockResolvedValue(undefined)))
      .rejects.toMatchObject({ status: 403 });
  });
  it('projects a removed unscored roster binding as read-only rather than an invalid golfer identity', async () => {
    const f = await playerFixture();
    const current = await f.workspace.get(creator, event.id);
    await f.workspace.save(creator, event.id, { ...f.input,
      playerIds: f.input.playerIds.filter((id) => id !== f.boundPlayerId),
      rounds: f.input.rounds.map((round) => ({ ...round, groups: round.groups.map((group) => ({
        ...group, playerIds: group.playerIds.filter((id) => id !== f.boundPlayerId),
      })) })),
    }, current.etag);
    const workspace = await f.workspace.get(member, event.id);
    expect(workspace.viewerPlayerId).toBeUndefined();
    expect(workspace.canViewScores).toBe(true);
    const cards = await f.scores.get(member, event.id, f.roundId);
    expect(isRoundScores(cards)).toBe(true);
    expect(cards.permissions).toEqual({ role: 'viewer', writePlayerIds: [], canManageGames: false });
    await expect(f.scores.write(member, event.id, f.roundId, f.peerId, 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(923))).rejects.toMatchObject({ status: 403 });
  });
  it('publishes identical net standings and prizes while withholding private index observations', async () => {
    const f = await playerFixture();
    for (const id of f.input.playerIds) {
      const profile = await f.players.get(creator, id);
      await f.players.observe(creator, id, identifier(2000 + f.input.playerIds.indexOf(id)), {
        value: '18.0', effectiveDate: '2026-01-01', source: 'Fictional private observation',
      }, profile.etag);
    }
    const before = await f.workspace.get(creator, event.id);
    const captured = await f.workspace.refreshIndices(creator, event.id, f.roundId, identifier(2200), before.etag);
    await f.workspace.save(creator, event.id, { ...f.input,
      overallCompetition: { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 95 },
    }, captured.etag);
    await f.scores.saveGames(creator, event.id, f.roundId, [{ id: identifier(920), name: 'Fictional net game',
      preset: 'standard', basis: 'net', handicapAllowancePercent: 100, points: stablefordPoints('standard') }], null, identifier(921));
    await f.scores.write(member, event.id, f.roundId, f.peerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(910));
    const charge = vi.fn().mockResolvedValue(undefined);
    const owner = await f.scores.leaderboard(creator, event.id, charge);
    const publicView = await f.scores.leaderboard(member, event.id, charge);
    expect(publicView.standings).toEqual(owner.standings);
    expect(isEventLeaderboardView(publicView)).toBe(true);
    expect(JSON.stringify(publicView)).not.toContain('handicapIndex');
    expect(JSON.stringify(publicView)).not.toContain('Fictional private observation');
    const purse = new TablePurseStore(f.table, f.workspace, f.scores);
    await purse.save(creator, event.id, { eventId: event.id, currency: 'USD', funding: { kind: 'fixed', budgetMinor: 10000 },
      pools: [{ id: identifier(2300), name: 'Fictional overall award', source: { kind: 'overall' },
        awardUnit: 'per-golfer', tiePolicy: 'pooled', prizes: [{ place: 1, amountMinor: 10000 }] }] },
    [], null, identifier(2301), charge);
    const awards = await purse.get(member, event.id, charge);
    expect(isEventPurseView(awards)).toBe(true);
    expect(awards.view?.calculation).toEqual((await purse.get(creator, event.id, charge)).view?.calculation);
    expect(JSON.stringify(awards)).not.toContain('handicapIndex');
  });
  it('revokes edit/global-view authority and rejects archived member reads', async () => {
    const f = await playerFixture();
    const management = await f.store.list(creator, event.id);
    const invitation = management.invitations.find((entry) => entry.inviteId === f.inviteId);
    if (!invitation) throw new Error('Missing fictional approved invitation.');
    await f.store.revoke(creator, event.id, { inviteId: f.inviteId, revision: invitation.revision }, management.etag, identifier(930));
    await expect(f.scores.get(member, event.id, f.roundId)).rejects.toMatchObject({ status: 404 });
    await expect(f.scores.write(member, event.id, f.roundId, f.peerId, 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(931))).rejects.toMatchObject({ status: 404 });
    expect((await new TableEventStore(f.table).list(member)).events).toEqual([]);
  });
  it('does not commit a group score or first-score lock when its member grant is revoked during the write', async () => {
    const f = await playerFixture();
    f.submit.mockImplementationOnce(async (actions) => {
      const current = await f.store.list(creator, event.id);
      const invitation = current.invitations.find((entry) => entry.inviteId === f.inviteId);
      if (!invitation) throw new Error('Missing fictional invitation.');
      await f.store.revoke(creator, event.id, { inviteId: f.inviteId, revision: invitation.revision }, current.etag, identifier(940));
      f.apply(actions);
      return { status: 202, subResponses: [], getResponseForEntity: () => undefined };
    });
    await expect(f.scores.write(member, event.id, f.roundId, f.peerId, 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(941))).rejects.toMatchObject({ status: 409 });
    expect(f.rows.has(`${event.id}|score-card:${f.roundId}:${f.peerId}`)).toBe(false);
    expect(f.rows.has(`${event.id}|score-change:${identifier(941)}`)).toBe(false);
    expect(f.rows.has(`${event.id}|score-lock:${f.roundId}`)).toBe(false);
    expect(f.rows.get(`${event.id}|member:${member.objectId}`)).toMatchObject({ role: 'member', revoked: true });
  });
  it('keeps target archives owner-only even when the admitted player can browse other active events', async () => {
    const f = await playerFixture();
    const current = await f.workspace.get(creator, event.id);
    await new TableEventStore(f.table).setStatus(creator, event.id, 'archived', current.etag);
    await expect(f.scores.get(member, event.id, f.roundId)).rejects.toMatchObject({ status: 404 });
    await expect(f.workspace.get(member, event.id)).rejects.toMatchObject({ status: 404 });
    expect((await f.scores.get(creator, event.id, f.roundId)).permissions).toEqual({
      role: 'owner', writePlayerIds: [], canManageGames: false,
    });
  });
});
