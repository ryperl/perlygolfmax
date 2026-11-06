import { describe, expect, it } from 'vitest';
import type { EventSetupInput } from '../../../src/domain/setup.js';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event } from '../../test/fixtures.js';

describe('durable first-score setup lock', () => {
  it.each([undefined, 1, 10, 18])('retains scored group start %s, permits equivalent defaults and rejects a different start', async (startingHole) => {
    const f = await scoringFixture();
    const input = { ...f.input, rounds: f.input.rounds.map((round) => ({
      ...round, groups: round.groups.map((group) => ({
        ...group, ...(startingHole === undefined ? {} : { startingHole }),
      })),
    })) };
    const configured = await f.workspace.save(creator, event.id, input, f.saved.etag);
    await f.write();
    const before = await f.workspace.get(creator, event.id);
    const equivalent = { ...input, location: 'Fictional updated metadata', rounds: input.rounds.map((round) => ({
      ...round, groups: round.groups.map((group) => ({
        number: group.number, playerIds: group.playerIds,
        ...(startingHole === 1 ? {} : { startingHole: startingHole ?? 1 }),
      })),
    })) };
    const saved = await f.workspace.save(creator, event.id, equivalent, before.etag);
    expect(saved.location).toBe(equivalent.location);
    expect(saved.rounds[0]?.groups).toEqual(configured.rounds[0]?.groups);
    expect(saved.rounds[0]).toEqual(before.rounds[0]);
    f.submit.mockClear();
    const rows = new Map(f.rows);
    for (const changed of [startingHole === 10 ? 18 : 10, ...(startingHole && startingHole !== 1 ? [undefined] : [])]) {
      await expect(f.workspace.save(creator, event.id, {
        ...input, rounds: input.rounds.map((round) => ({
          ...round, groups: round.groups.map((group) => ({
            number: group.number, playerIds: group.playerIds, ...(changed === undefined ? {} : { startingHole: changed }),
          })),
        })),
      }, saved.etag)).rejects.toMatchObject({ status: 409, code: 'ROUND_SCORING_STARTED' });
    }
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.rows).toEqual(rows);
  });

  it('uses the first captured layout hole, not a hardcoded 1, for an omitted scored starting hole', async () => {
    const f = await scoringFixture();
    const snapshot = f.saved.rounds[0];
    if (!snapshot) throw new Error('Missing fictional captured round');
    f.seed({ partitionKey: event.id, rowKey: `round:${f.roundId}`, content: JSON.stringify({
      ...snapshot, teeProfile: { ...snapshot.teeProfile,
        holes: [...snapshot.teeProfile.holes.slice(9), ...snapshot.teeProfile.holes.slice(0, 9)] },
    }) });
    await f.write();
    const before = await f.workspace.get(creator, event.id);
    const saved = await f.workspace.save(creator, event.id, { ...f.input,
      rounds: f.input.rounds.map((round) => ({ ...round,
        groups: round.groups.map((group) => ({ ...group, startingHole: 10 })),
      })),
    }, before.etag);
    expect(saved.rounds[0]).toEqual(before.rounds[0]);
    await expect(f.workspace.save(creator, event.id, { ...f.input,
      rounds: f.input.rounds.map((round) => ({ ...round,
        groups: round.groups.map((group) => ({ ...group, startingHole: 1 })),
      })),
    }, saved.etag)).rejects.toMatchObject({ code: 'ROUND_SCORING_STARTED' });
  });

  it('conditionally rejects a changed starting hole when the first score wins the setup race', async () => {
    const f = await scoringFixture();
    f.submit.mockImplementationOnce(async (actions) => {
      await f.write();
      f.apply(actions);
      return { status: 202, subResponses: [], getResponseForEntity: () => undefined };
    });
    await expect(f.workspace.save(creator, event.id, { ...f.input,
      rounds: f.input.rounds.map((round) => ({ ...round,
        groups: round.groups.map((group) => ({ ...group, startingHole: 10 })),
      })),
    }, f.saved.etag)).rejects.toMatchObject({ code: 'EVENT_CHANGED' });
    expect((await f.workspace.get(creator, event.id)).rounds[0]?.groups).toEqual(f.input.rounds[0]?.groups);
  });

  it('fails closed without writes for workspace get/save/refresh and scoring when a lock is missing but its card survives', async () => {
    const f = await scoringFixture();
    await f.write();
    const saved = await f.workspace.get(creator, event.id);
    f.rows.delete(`${event.id}|score-lock:${f.roundId}`);
    f.submit.mockClear();
    const rows = [...f.rows.entries()];
    await expect(f.workspace.get(creator, event.id)).rejects.toMatchObject({ status: 503, code: 'INVALID_STORED_SCORE_LOCK' });
    await expect(f.workspace.save(creator, event.id, f.input, saved.etag)).rejects.toMatchObject({ status: 503, code: 'INVALID_STORED_SCORE_LOCK' });
    await expect(f.workspace.refreshIndices(creator, event.id, f.roundId, identifier(700), saved.etag)).rejects.toMatchObject({ status: 503, code: 'INVALID_STORED_SCORE_LOCK' });
    await expect(f.scores.get(creator, event.id, f.roundId)).rejects.toMatchObject({ status: 503, code: 'INVALID_STORED_SCORE_LOCK' });
    await expect(f.write()).rejects.toMatchObject({ status: 503, code: 'INVALID_STORED_SCORE_LOCK' });
    expect(f.submit).not.toHaveBeenCalled();
    expect([...f.rows.entries()]).toEqual(rows);
    expect(f.list.mock.calls.at(-1)?.[0]?.queryOptions?.filter).toBe(
      `PartitionKey eq '${event.id}' and RowKey ge 'score-card:${f.roundId}:' and RowKey lt 'score-card:${f.roundId};'`,
    );
  });

  it('does not confuse other round or event card evidence with an unstarted saved round', async () => {
    const f = await scoringFixture();
    f.seed({ partitionKey: event.id, rowKey: `score-card:${identifier(501)}:${f.playerId}`, content: '{}' });
    f.seed({ partitionKey: identifier(999), rowKey: `score-card:${f.roundId}:${f.playerId}`, content: '{}' });
    expect((await f.workspace.get(creator, event.id)).rounds[0]).not.toHaveProperty('scoringStarted');
  });

  it('derives scoringStarted from a validated lock, never the saved snapshot flag', async () => {
    const f = await scoringFixture();
    const key = `${event.id}|round:${f.roundId}`;
    const snapshot = f.saved.rounds[0];
    if (!snapshot) throw new Error('Missing fictional round');
    f.seed({ partitionKey: event.id, rowKey: `round:${f.roundId}`, content: JSON.stringify({ ...snapshot, scoringStarted: true }) });
    expect((await f.workspace.get(creator, event.id)).rounds[0]).not.toHaveProperty('scoringStarted');
    await f.write();
    expect((await f.workspace.get(creator, event.id)).rounds[0]?.scoringStarted).toBe(true);
    const row = f.rows.get(key);
    if (!row) throw new Error('Missing fictional stored round');
    f.seed({ ...row, content: JSON.stringify({ ...snapshot, scoringStarted: false }) });
    expect((await f.workspace.get(creator, event.id)).rounds[0]?.scoringStarted).toBe(true);
  });

  it('preserves locked snapshots exactly, allows metadata and new rounds, rejects roster/locked-name/course/tee/groups changes', async () => {
    const f = await scoringFixture();
    await f.write();
    const before = await f.workspace.get(creator, event.id);
    const round = f.input.rounds[0];
    if (!round) throw new Error('Missing fictional input round');
    const changed: readonly EventSetupInput[] = [
      { ...f.input, playerIds: [...f.input.playerIds].reverse() },
      { ...f.input, rounds: [{ ...round, name: 'Fictional new locked name' }] },
      { ...f.input, rounds: [{ ...round, courseId: 'ghin:999:999' }] },
      { ...f.input, rounds: [{ ...round, courseVersionId: 'f'.repeat(64) }] },
      { ...f.input, rounds: [{ ...round, teeProfileId: 102 }] },
      { ...f.input, rounds: [{ ...round, groups: [{ number: 2, playerIds: f.input.playerIds }] }] },
    ];
    for (const input of changed) await expect(f.workspace.save(creator, event.id, input, before.etag)).rejects.toMatchObject({ status: 409 });
    const after = await f.workspace.save(creator, event.id, {
      ...f.input, name: 'Fictional changed event name', location: 'Fictional changed location',
      rounds: [round, { ...round, id: identifier(501), name: 'Fictional new round' }],
    }, before.etag);
    expect(after.rounds[0]).toEqual(before.rounds[0]);
    expect(after.rounds[1]).not.toHaveProperty('scoringStarted');
    expect(after.event.name).toBe('Fictional changed event name');
    expect(after.location).toBe('Fictional changed location');
    expect((await f.scores.get(creator, event.id, f.roundId)).cards[0]?.holes[0]?.score).toEqual({ kind: 'strokes', strokes: 4 });
    const currentPlayer = await f.players.get(creator, f.playerId);
    await f.players.observe(creator, currentPlayer.id, identifier(800), {
      value: '12', source: 'Fictional later observation', effectiveDate: '2026-03-01',
    }, currentPlayer.etag);
    const fresh = await f.workspace.get(creator, event.id);
    await expect(f.workspace.refreshIndices(creator, event.id, f.roundId, identifier(900), fresh.etag)).rejects.toMatchObject({ code: 'ROUND_SCORING_STARTED' });
    await expect(f.workspace.refreshIndices(creator, event.id, identifier(501), identifier(900), fresh.etag)).resolves.toMatchObject({
      rounds: [{ scoringStarted: true }, { players: [{ handicapIndex: { value: '12' } }, {}, {}, {}] }],
    });
  });

  it('rejects index-refresh replays after scoring starts, before accepting an old receipt', async () => {
    const f = await scoringFixture();
    await f.workspace.refreshIndices(creator, event.id, f.roundId, identifier(700), f.saved.etag);
    await f.write();
    const before = [...f.rows.entries()];
    await expect(f.workspace.refreshIndices(creator, event.id, f.roundId, identifier(700), f.saved.etag)).rejects.toMatchObject({ code: 'ROUND_SCORING_STARTED' });
    expect([...f.rows.entries()]).toEqual(before);
  });

  it.each(['save', 'refresh'] as const)('rejects a stale %s transaction when first scoring commits first', async (action) => {
    const f = await scoringFixture();
    const round = f.input.rounds[0];
    if (!round) throw new Error('Missing fictional round');
    f.submit.mockImplementationOnce(async (actions) => {
      await f.write();
      f.apply(actions);
      return { status: 202, subResponses: [], getResponseForEntity: () => undefined };
    });
    const setup = action === 'save'
      ? f.workspace.save(creator, event.id, { ...f.input, rounds: [{ ...round, name: 'Fictional racing name' }] }, f.saved.etag)
      : f.workspace.refreshIndices(creator, event.id, f.roundId, identifier(700), f.saved.etag);
    await expect(setup).rejects.toMatchObject({ code: 'EVENT_CHANGED' });
    const saved = await f.workspace.get(creator, event.id);
    expect(saved.rounds[0]?.name).toBe(round.name);
    expect(saved.rounds[0]?.scoringStarted).toBe(true);
    expect([...f.rows.values()].filter((row) => row.rowKey?.startsWith('index-refresh:'))).toHaveLength(0);
  });

  it.each(['save', 'refresh'] as const)('rejects first scoring when a racing %s transaction commits first, with no partial lock/audit/card', async (action) => {
    const f = await scoringFixture();
    const round = f.input.rounds[0];
    if (!round) throw new Error('Missing fictional round');
    f.submit.mockImplementationOnce(async (actions) => {
      if (action === 'save') await f.workspace.save(creator, event.id, { ...f.input, rounds: [{ ...round, name: 'Fictional racing name' }] }, f.saved.etag);
      else await f.workspace.refreshIndices(creator, event.id, f.roundId, identifier(700), f.saved.etag);
      f.apply(actions);
      return { status: 202, subResponses: [], getResponseForEntity: () => undefined };
    });
    await expect(f.write()).rejects.toMatchObject({ code: 'SCORECARD_CHANGED' });
    expect([...f.rows.values()].filter((row) => row.rowKey?.startsWith('score-'))).toHaveLength(0);
    await f.write();
    expect((await f.workspace.get(creator, event.id)).rounds[0]?.scoringStarted).toBe(true);
  });

  it.each(['{}', '{"kind":"score-lock","eventId":"wrong"}', 'not json'])('fails closed on corrupt lock %s for projection/save/refresh/scoring', async (content) => {
    const f = await scoringFixture();
    f.seed({ partitionKey: event.id, rowKey: `score-lock:${f.roundId}`, content });
    await expect(f.workspace.get(creator, event.id)).rejects.toMatchObject({ status: 503 });
    await expect(f.workspace.save(creator, event.id, f.input, f.saved.etag)).rejects.toMatchObject({ status: 503 });
    await expect(f.workspace.refreshIndices(creator, event.id, f.roundId, identifier(700), f.saved.etag)).rejects.toMatchObject({ status: 503 });
    await expect(f.write()).rejects.toMatchObject({ status: 503 });
    expect(f.submit).not.toHaveBeenCalled();
  });
});
