import { describe, expect, it } from 'vitest';
import { isIndexRefreshAudit } from './index-refresh.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event } from '../../test/fixtures.js';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { privateContent } from '../private-values.js';
import { TableScoreStore } from '../scoring/store.js';

describe('captured-index refresh audit roster', () => {
  it.each([1, 2, 3])('accepts %i captured golfers and rejects empty, duplicate or mismatched counterparts', (count) => {
    const inputs = Array.from({ length: count }, (_, index) => ({ playerId: identifier(200 + index), handicapIndex: null }));
    const audit = { eventId: event.id, roundId: identifier(500), requestId: identifier(600),
      expectedEtag: 'fictional-etag', recordedAt: '2026-01-01T00:00:00Z', recordedBy: creator,
      previous: inputs, updated: inputs };
    expect(isIndexRefreshAudit(audit)).toBe(true);
    expect(isIndexRefreshAudit({ ...audit, previous: [], updated: [] })).toBe(false);
    expect(isIndexRefreshAudit({ ...audit, previous: [...inputs, ...inputs], updated: [...inputs, ...inputs] })).toBe(false);
    expect(isIndexRefreshAudit({ ...audit, updated: inputs.map((entry) => ({ ...entry, playerId: identifier(999) })) })).toBe(false);
  });

  describe('current unstarted indexes and atomic first-score capture', () => {
    it('updates every unstarted round on reads without writes, then freezes all players at first score', async () => {
      const f = await scoringFixture();
      const first = f.input.rounds[0];
      if (!first) throw new Error('Missing fictional round');
      await f.workspace.save(creator, event.id, {
        ...f.input, rounds: [first, { ...first, id: identifier(501), name: 'Fictional later round' }],
      }, f.saved.etag);
      const player = await f.players.get(creator, f.playerId);
      const observed = await f.players.observe(creator, player.id, identifier(810), {
        value: '+1.5', effectiveDate: '2026-03-01', source: 'Fictional updated index',
      }, player.etag);
      const rowsBefore = new Map(f.rows);
      const workspace = await f.workspace.get(creator, event.id);
      expect(workspace.rounds.map((round) => round.players[0]?.handicapIndex)).toEqual([
        observed.currentIndex, observed.currentIndex,
      ]);
      expect(f.rows).toEqual(rowsBefore);
      const scores = await f.scores.get(creator, event.id, f.roundId);
      expect(scores.courseHandicaps?.find((entry) => entry.playerId === f.playerId)?.courseHandicap).toBe(-2);
      const written = await f.write();
      const captured = f.rows.get(`${event.id}|index-capture:${f.roundId}`);
      expect(JSON.parse(await privateContent(f.table, event.id, `index-capture:${f.roundId}`, captured?.content)))
        .toMatchObject({ requestId: identifier(600), recordedBy: creator,
          players: [expect.objectContaining({ playerId: f.playerId, handicapIndex: observed.currentIndex }),
            ...f.input.playerIds.slice(1).map((playerId) => ({ playerId, handicapIndex: null }))] });
      const frozenRound = f.rows.get(`${event.id}|round:${f.roundId}`);
      const latest = await f.players.observe(creator, player.id, identifier(811), {
        value: '12.3', effectiveDate: '2026-04-01', source: 'Fictional later index',
      }, observed.etag);
      const after = await f.workspace.get(creator, event.id);
      expect(after.rounds[0]?.players[0]?.handicapIndex).toEqual(observed.currentIndex);
      expect(after.rounds[1]?.players[0]?.handicapIndex).toEqual(latest.currentIndex);
      await f.write(written.round.cards[0]?.etag ?? null, 601, 2);
      expect(f.rows.get(`${event.id}|round:${f.roundId}`)).toEqual(frozenRound);
      expect(f.rows.get(`${event.id}|index-capture:${f.roundId}`)).toEqual(captured);
    });

    it('archives keep saved inputs rather than adopting later catalog observations', async () => {
      const f = await scoringFixture();
      const player = await f.players.get(creator, f.playerId);
      await f.players.observe(creator, player.id, identifier(810), {
        value: '8.2', effectiveDate: '2026-03-01', source: 'Fictional update',
      }, player.etag);
      const summary = f.rows.get(`${event.id}|event`);
      f.seed({ ...summary, partitionKey: event.id, rowKey: 'event', status: 'archived' });
      expect((await f.workspace.get(creator, event.id)).rounds[0]?.players[0]?.handicapIndex).toBeNull();
    });

    it('fails atomically when setup changes before the first score publishes, retaining old captures and no audit or lock', async () => {
      const f = await scoringFixture();
      const before = f.rows.get(`${event.id}|round:${f.roundId}`);
      f.submit.mockImplementationOnce((actions) => {
        const summary = f.rows.get(`${event.id}|event`);
        f.seed({ ...summary, partitionKey: event.id, rowKey: 'event', name: 'Fictional concurrent setup' });
        f.apply(actions);
        return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
      });
      await expect(f.write()).rejects.toMatchObject({ code: 'SCORECARD_CHANGED' });
      expect(f.rows.get(`${event.id}|round:${f.roundId}`)).toEqual(before);
      expect(f.rows.has(`${event.id}|index-capture:${f.roundId}`)).toBe(false);
      expect(f.rows.has(`${event.id}|score-lock:${f.roundId}`)).toBe(false);
      expect(f.rows.has(`${event.id}|score-card:${f.roundId}:${f.playerId}`)).toBe(false);
    });

    it('public first-score capture uses current inputs without catalog authority and keeps observation metadata private', async () => {
      const f = await scoringFixture();
      const player = await f.players.get(creator, f.playerId);
      await f.players.observe(creator, player.id, identifier(810), {
        value: '8.2', effectiveDate: '2026-03-01', source: 'Fictional private provenance',
      }, player.etag);
      const actor = { kind: 'public-score' as const, eventId: event.id };
      const scores = new TableScoreStore(f.table, f.workspace);
      const result = await scores.write(actor, event.id, f.roundId, f.playerId, 1, {
        kind: 'strokes', strokes: 4,
      }, null, identifier(600));
      expect(result.round.courseHandicaps?.find((entry) => entry.playerId === f.playerId)?.courseHandicap).toBe(9);
      expect(JSON.stringify(result.round)).not.toContain('Fictional private provenance');
      expect(JSON.stringify(result.round)).not.toContain('effectiveDate');
      const capture = f.rows.get(`${event.id}|index-capture:${f.roundId}`);
      const audit: unknown = JSON.parse(await privateContent(f.table, event.id, `index-capture:${f.roundId}`, capture?.content));
      expect(audit).toMatchObject({ recordedBy: actor });
    });
  });
});
