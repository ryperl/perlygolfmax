import { describe, expect, it } from 'vitest';
import { publicFixture } from '../public-access/test-support.js';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { isEventWorkspace } from '../../../src/contracts/setup.js';
import { isRoundScores, isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { roundMatchesSnapshot } from '../../../src/contracts/round-context.js';
import { stablefordPoints } from '../../../src/domain/stableford.js';
import { canonical } from '../catalog/entities.js';

describe('allowlisted index displays and captured course handicaps', () => {
  it('keeps legacy uncaptured indices unavailable rather than claiming NH or zero', async () => {
    const f = await publicFixture();
    const captured = (await f.workspace.get(creator, event.id)).rounds[0];
    if (!captured) throw new Error('Missing fictional round.');
    f.seed({ partitionKey: event.id, rowKey: `round:${f.roundId}`, content: canonical({
      ...captured, players: captured.players.map(({ playerId, displayName }) => ({ playerId, displayName })),
    }) });
    for (const actor of [creator, f.actor]) {
      const workspace = await f.workspace.get(actor, event.id);
      expect(isEventWorkspace(workspace)).toBe(true);
      expect(workspace.rounds[0]?.players.every((player) => player.handicapIndexValue === undefined && player.handicapIndex === undefined)).toBe(true);
      const scores = await f.scores.get(actor, event.id, f.roundId);
      expect(isRoundScores(scores)).toBe(true);
      expect(scores.courseHandicaps?.every((entry) => entry.courseHandicap === null
        && entry.unavailableReason === 'uncaptured-handicap-index')).toBe(true);
    }
  });
  it('keeps current roster HI separate from captured group HI and CH without exposing observations or rewriting scores', async () => {
    const f = await publicFixture();
    for (const [index, value] of ['18.9', '0', '+2.1'].entries()) {
      const playerId = f.input.playerIds[index];
      if (!playerId) throw new Error('Missing fictional golfer.');
      const profile = await f.players.get(creator, playerId);
      await f.players.observe(creator, playerId, identifier(9000 + index), {
        value, effectiveDate: '2026-01-01', source: 'Fictional protected index source',
      }, profile.etag);
    }
    const before = await f.workspace.get(creator, event.id);
    await f.workspace.refreshIndices(creator, event.id, f.roundId, identifier(9005), before.etag);
    await f.scores.saveGames(creator, event.id, f.roundId, [{
      id: identifier(9006), name: 'Fictional net game', basis: 'net', preset: 'standard',
      handicapAllowancePercent: 95, points: stablefordPoints('standard'),
    }], null, identifier(9007));
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(9008));
    const stored = new Map([...f.rows].filter(([key]) => key.startsWith(`${event.id}|round:`)
      || key.startsWith(`${event.id}|score-`) || key === `${event.id}|workspace`));
    const profile = await f.players.get(creator, f.playerId);
    await f.players.observe(creator, f.playerId, identifier(9009), {
      value: '29.2', effectiveDate: '2026-01-02', source: 'Fictional newer private observation',
    }, profile.etag);

    const workspace = await f.workspace.get(f.actor, event.id);
    const scores = await f.scores.get(f.actor, event.id, f.roundId);
    expect(isEventWorkspace(workspace)).toBe(true);
    expect(isRoundScores(scores)).toBe(true);
    expect(workspace.roster.find((player) => player.playerId === f.playerId)?.handicapIndexValue).toBe('29.2');
    expect(workspace.rounds[0]?.players.find((player) => player.playerId === f.playerId)?.handicapIndexValue).toBe('18.9');
    expect(workspace.roster.find((player) => player.playerId === f.peerId)?.handicapIndexValue).toBeNull();
    expect(scores.courseHandicaps?.map((player) => player.courseHandicap)).toEqual([20, 0, -2, null, null, null, null, null]);
    expect(scores.courseHandicaps?.[3]?.unavailableReason).toBe('missing-handicap-index');
    expect(scores.games?.results[0]?.players.find((player) => player.playerId === f.playerId)?.playingHandicap).toBe(19);
    expect(scores.courseHandicaps).toEqual(saved.round.courseHandicaps);
    const owner = await f.workspace.get(creator, event.id);
    const ownerScores = await f.scores.get(creator, event.id, f.roundId);
    expect(ownerScores.courseHandicaps).toEqual(scores.courseHandicaps);
    const snapshot = owner.rounds[0];
    if (!snapshot) throw new Error('Missing fictional capture.');
    const courseHandicaps = scores.courseHandicaps;
    if (!courseHandicaps) throw new Error('Missing fictional course handicaps.');
    expect(roundMatchesSnapshot(owner, snapshot, ownerScores)).toBe(true);
    expect(roundMatchesSnapshot(owner, snapshot, { ...ownerScores,
      courseHandicaps: courseHandicaps.map((entry) => ({ playerId: entry.playerId, courseHandicap: 1 })),
    })).toBe(false);
    const replay = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(9008));
    expect(isScoreWriteResult(replay)).toBe(true);
    expect(replay.change).toEqual(saved.change);
    expect(replay.round.courseHandicaps).toEqual(scores.courseHandicaps);
    const text = JSON.stringify({ workspace, scores });
    for (const secret of ['"handicapIndex":', 'currentIndex', 'recordedBy', 'previousObservationId',
      'effectiveDate', 'Fictional protected index source', 'Fictional newer private observation', creator.objectId, creator.tenantId]) {
      expect(text).not.toContain(secret);
    }
    for (const [key, row] of stored) expect(f.rows.get(key)).toEqual(row);
  });
});
