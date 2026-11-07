import { describe, expect, it } from 'vitest';
import { publicFixture } from '../public-access/test-support.js';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { stablefordPoints } from '../../../src/domain/stableford.js';
import { roundMatchesSnapshot } from '../../../src/contracts/round-context.js';
import { isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { isRecord } from '../../../src/contracts/events.js';
import { TableEventStore } from '../events/store.js';

describe('current golfer names in saved round displays', () => {
  it('still rejects a tampered stored card name even if it matches the new display name', async () => {
    const f = await publicFixture();
    await f.write();
    const profile = await f.players.get(creator, f.playerId);
    await f.players.rename(creator, f.playerId, 'Fictional corrected name', profile.etag);
    const key = `${event.id}|score-card:${f.roundId}:${f.playerId}`;
    const row = f.rows.get(key);
    if (!row || typeof row.content !== 'string') throw new Error('Missing fictional card.');
    const card: unknown = JSON.parse(row.content);
    if (!isRecord(card)) throw new Error('Invalid fictional card.');
    f.rows.set(key, { ...row, content: JSON.stringify({ ...card, displayName: 'Fictional corrected name' }) });
    await expect(f.scores.get(f.actor, event.id, f.roundId)).rejects.toMatchObject({ code: 'INVALID_STORED_SCORECARD' });
  });
  it('uses an already-renamed player across every round, scorecard, game, overall and purse without rewriting captures or scores', async () => {
    const f = await publicFixture();
    const first = f.input.rounds[0];
    if (!first) throw new Error('Missing fictional round.');
    const game = { id: identifier(800), name: 'Fictional game', basis: 'gross' as const, preset: 'standard' as const,
      handicapAllowancePercent: 95, points: stablefordPoints('standard') };
    const roundIds = [first.id, identifier(501)];
    const before = await f.workspace.get(creator, event.id);
    await f.workspace.save(creator, event.id, { ...f.input,
      rounds: [first, { ...first, id: roundIds[1] ?? '', name: 'Fictional second round' }] }, before.etag);
    for (const [index, roundId] of roundIds.entries()) {
      await f.scores.saveGames(creator, event.id, roundId, [game], null, identifier(810 + index));
    }
    const workspace = await f.workspace.get(creator, event.id);
    await f.workspace.save(creator, event.id, { ...f.input,
      rounds: [first, { ...first, id: roundIds[1] ?? '', name: 'Fictional second round' }],
      overallCompetition: { kind: 'stableford', credit: 'individual', roundGames: roundIds.map((roundId) => ({ roundId, gameId: game.id })) },
    }, workspace.etag);
    const saved = await f.scores.write(f.actor, event.id, first.id, f.playerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(820));
    const storedCaptures = new Map([...f.rows].filter(([key]) => key.startsWith(`${event.id}|round:`)
      || key.startsWith(`${event.id}|score-`) || key === `${event.id}|workspace`));
    const profile = await f.players.get(creator, f.playerId);
    await f.players.rename(creator, f.playerId, 'Fictional corrected golfer', profile.etag);
    const renamed = await f.workspace.get(f.actor, event.id);
    expect(renamed.roster.find((player) => player.playerId === f.playerId)?.displayName).toBe('Fictional corrected golfer');
    for (const round of renamed.rounds) {
      expect(round.players.find((player) => player.playerId === f.playerId)?.displayName).toBe('Fictional corrected golfer');
      const scores = await f.scores.get(f.actor, event.id, round.id);
      expect(scores.cards.find((card) => card.playerId === f.playerId)?.displayName).toBe('Fictional corrected golfer');
      expect(scores.games?.results[0]?.players.find((player) => player.playerId === f.playerId)?.displayName).toBe('Fictional corrected golfer');
      expect(roundMatchesSnapshot(renamed, round, scores)).toBe(true);
      expect(JSON.stringify(scores)).not.toMatch(/currentIndex|recordedBy|handicapIndex/);
    }
    const standings = await f.scores.leaderboard(f.actor, event.id, () => Promise.resolve());
    expect(standings.standings.players.find((player) => player.playerId === f.playerId)?.displayName).toBe('Fictional corrected golfer');
    const purse = await f.purse.get(f.actor, event.id, () => Promise.resolve());
    expect(purse.workspace.roster.find((player) => player.playerId === f.playerId)?.displayName).toBe('Fictional corrected golfer');
    const replay = await f.scores.write(f.actor, event.id, first.id, f.playerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(820));
    expect(replay.change).toEqual(saved.change);
    expect(replay.round.cards.find((card) => card.playerId === f.playerId)?.displayName).toBe('Fictional corrected golfer');
    expect(isScoreWriteResult(replay)).toBe(true);
    for (const [key, value] of storedCaptures) expect(f.rows.get(key)).toEqual(value);
    const otherEvent = identifier(55);
    f.seed({ partitionKey: otherEvent, rowKey: 'event', name: 'Fictional other event', createdAt: event.createdAt, status: 'active' });
    f.seed({ partitionKey: otherEvent, rowKey: `member:${creator.objectId}`, ...creator, role: 'owner' });
    const other = await f.workspace.get(creator, otherEvent);
    await f.workspace.save(creator, otherEvent, f.input, other.etag);
    const newer = await f.players.get(creator, f.playerId);
    await f.players.rename(creator, f.playerId, 'Fictional newest name', newer.etag);
    expect((await f.workspace.get(creator, otherEvent)).roster.find((player) => player.playerId === f.playerId)?.displayName).toBe('Fictional newest name');
    const active = await f.workspace.get(creator, event.id);
    await new TableEventStore(f.table).setStatus(creator, event.id, 'archived', active.etag);
    expect((await f.scores.get(creator, event.id, first.id)).cards.find((player) => player.playerId === f.playerId)?.displayName).toBe('Fictional newest name');
  });

  it('fails explicitly on a missing name source and does not permit a public read after archival during name resolution', async () => {
    const f = await publicFixture();
    const key = `catalog:players|player:${f.playerId}`;
    const profile = f.rows.get(key);
    if (!profile) throw new Error('Missing fictional player.');
    f.rows.delete(key);
    await expect(f.scores.get(f.actor, event.id, f.roundId)).rejects.toMatchObject({ code: 'INVALID_STORED_PLAYER_NAME' });
    f.rows.set(key, profile);
    const resolve = f.get.getMockImplementation();
    if (!resolve) throw new Error('Missing fictional entity reader.');
    let archived = false;
    f.get.mockImplementation(async (partition, row) => {
      const value = await resolve(partition, row);
      if (!archived && partition === 'catalog:players') {
        archived = true;
        const owner = await f.workspace.get(creator, event.id);
        await new TableEventStore(f.table).setStatus(creator, event.id, 'archived', owner.etag);
      }
      return value;
    });
    await expect(f.scores.get(f.actor, event.id, f.roundId)).rejects.toMatchObject({ code: 'PUBLIC_EVENT_NOT_AVAILABLE' });
  });
});
