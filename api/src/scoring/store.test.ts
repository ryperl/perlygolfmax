import { describe, expect, it } from 'vitest';
import type { HoleScore } from '../../../src/domain/scoring.js';
import { isRoundScores, isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import { canonical } from '../catalog/entities.js';
import { TableEventStore } from '../events/store.js';

describe('owner-only saved-round gross scorecards', () => {
  it('initializes virtual unplayed cards using only captured tee holes, then atomically writes card, audit, lock and conditional authority', async () => {
    const f = await scoringFixture();
    const initial = await f.scores.get(creator, event.id, f.roundId);
    expect(isRoundScores(initial)).toBe(true);
    expect(initial.setupLocked).toBe(false);
    expect(initial.cards).toHaveLength(4);
    expect(initial.cards.every((card) => card.etag === null && card.updatedAt === null && card.holes.every((hole) => hole.score.kind === 'unplayed'))).toBe(true);
    expect(initial.layout.map((hole) => hole.sourceId)).toEqual(Array.from({ length: 18 }, (_, i) => i + 201));
    expect(f.submit).not.toHaveBeenCalled();
    const result = await f.write();
    expect(isScoreWriteResult(result)).toBe(true);
    expect(result.change).toMatchObject({
      before: { kind: 'unplayed' }, after: { kind: 'strokes', strokes: 4 }, expectedEtag: null, recordedBy: creator,
    });
    expect(result.round.cards[0]?.etag).toBe(f.rows.get(`${event.id}|score-card:${f.roundId}:${f.playerId}`)?.etag);
    expect(result.round.cards[0]?.holes[0]?.score).toEqual({ kind: 'strokes', strokes: 4 });
    const actions = f.submit.mock.calls[0]?.[0];
    expect(actions).toHaveLength(5);
    expect(actions?.[0]?.[3]).toEqual({ etag: f.saved.etag });
    expect(actions?.[1]?.[3]?.etag).toEqual(expect.any(String));
    expect(actions?.map((action) => action[0])).toEqual(['update', 'update', 'create', 'create', 'create']);
    expect(actions?.every((action) => action[1].partitionKey === event.id)).toBe(true);
    expect(result.round.setupLocked).toBe(true);
    expect(result.round).not.toHaveProperty('handicapIndex');
  });

  it('audits all explicit score states and owner corrections without changing earlier history or unlocking a cleared card', async () => {
    const f = await scoringFixture();
    let result = await f.write();
    const first = result.change;
    for (const [index, score] of ([{ kind: 'picked-up' }, { kind: 'did-not-finish' }, { kind: 'unplayed' }] satisfies HoleScore[]).entries()) {
      result = await f.scores.write(creator, event.id, f.roundId, f.playerId, 1, score, result.round.cards[0]?.etag ?? null, identifier(601 + index));
    }
    expect(result.round.cards[0]?.holes.every((hole) => hole.score.kind === 'unplayed')).toBe(true);
    expect(result.round.setupLocked).toBe(true);
    const history = await f.scores.history(creator, event.id, f.roundId, f.playerId);
    expect(history.changes).toHaveLength(4);
    expect(history.changes[0]).toEqual(first);
    expect(history.changes[3]?.before).toEqual({ kind: 'did-not-finish' });
    expect(history.changes[3]?.after).toEqual({ kind: 'unplayed' });
  });

  it('atomically extends a bounded written-player registry for each first card and never confuses missing saved cards with untouched golfers', async () => {
    const f = await scoringFixture();
    await f.write();
    const lockKey = `${event.id}|score-lock:${f.roundId}`;
    const initialLock = f.rows.get(lockKey);
    if (!initialLock || typeof initialLock.content !== 'string') throw new Error('Missing fictional first lock');
    const untouched = (await f.scores.get(creator, event.id, f.roundId)).cards.find((card) => card.playerId === identifier(201));
    expect(untouched?.etag).toBeNull();
    const second = await f.scores.write(creator, event.id, f.roundId, identifier(201), 1, { kind: 'picked-up' }, null, identifier(601));
    expect(second.round.cards.filter((card) => card.etag !== null)).toHaveLength(2);
    const actions = f.submit.mock.calls.at(-1)?.[0];
    expect(actions?.at(-1)).toEqual([
      'update', expect.objectContaining({ rowKey: `score-lock:${f.roundId}` }), 'Replace', { etag: initialLock.etag },
    ]);
    const updatedLock = f.rows.get(lockKey);
    if (!updatedLock || typeof updatedLock.content !== 'string') throw new Error('Missing fictional updated lock');
    const stored: unknown = JSON.parse(updatedLock.content);
    expect(stored).toMatchObject({ writtenPlayerIds: [f.playerId, identifier(201)], requestId: identifier(600) });
    const cardKey = `${event.id}|score-card:${f.roundId}:${identifier(201)}`;
    f.rows.delete(cardKey);
    await expect(f.scores.get(creator, event.id, f.roundId)).rejects.toMatchObject({ code: 'INVALID_STORED_SCORECARD' });
    await expect(f.scores.write(creator, event.id, f.roundId, identifier(201), 2, { kind: 'unplayed' }, null, identifier(602))).rejects.toMatchObject({ code: 'INVALID_STORED_SCORECARD' });
    expect(f.rows.has(cardKey)).toBe(false);
    f.rows.delete(`${event.id}|score-card:${f.roundId}:${f.playerId}`);
    await expect(f.scores.get(creator, event.id, f.roundId)).rejects.toMatchObject({ code: 'INVALID_STORED_SCORECARD' });
    const writes = f.submit.mock.calls.length;
    await expect(f.scores.write(creator, event.id, f.roundId, identifier(202), 1, { kind: 'unplayed' }, null, identifier(603))).rejects.toMatchObject({ code: 'INVALID_STORED_SCORECARD' });
    expect(f.submit).toHaveBeenCalledTimes(writes);
  });

  it('rejects invalid registry players and unregistered persisted cards', async () => {
    const f = await scoringFixture();
    const first = await f.write();
    const lock = f.rows.get(`${event.id}|score-lock:${f.roundId}`);
    if (!lock || typeof lock.content !== 'string') throw new Error('Missing fictional lock');
    const original: unknown = JSON.parse(lock.content);
    if (typeof original !== 'object' || original === null) throw new Error('Invalid fictional lock');
    for (const writtenPlayerIds of [[], [identifier(999)], [f.playerId, f.playerId]]) {
      f.seed({ ...lock, content: canonical({ ...original, writtenPlayerIds }) });
      await expect(f.scores.get(creator, event.id, f.roundId)).rejects.toMatchObject({ status: 503 });
    }
    f.seed(lock);
    const card = first.round.cards[0];
    if (!card) throw new Error('Missing fictional card');
    const { etag: _etag, ...content } = card;
    void _etag;
    f.seed({ partitionKey: event.id, rowKey: `score-card:${f.roundId}:${identifier(201)}`, content: canonical({ ...content, playerId: identifier(201) }) });
    await expect(f.scores.get(creator, event.id, f.roundId)).rejects.toMatchObject({ code: 'INVALID_STORED_SCORECARD' });
  });

  it('permits an appointed noncatalog owner, never global authority, member, wrong tenant or cross-event IDs', async () => {
    const f = await scoringFixture();
    await expect(f.scores.get(member, event.id, f.roundId)).rejects.toMatchObject({ status: 404 });
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'member' });
    await expect(f.scores.get(member, event.id, f.roundId)).rejects.toMatchObject({ status: 403 });
    await expect(f.scores.history(member, event.id, f.roundId, f.playerId)).rejects.toMatchObject({ status: 403 });
    await expect(f.scores.write(member, event.id, f.roundId, f.playerId, 1, { kind: 'unplayed' }, null, identifier(600))).rejects.toMatchObject({ status: 403 });
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'owner' });
    await expect(f.scores.write(member, event.id, f.roundId, f.playerId, 1, { kind: 'picked-up' }, null, identifier(600))).resolves.toMatchObject({ change: { recordedBy: member } });
    await expect(f.scores.get({ ...member, tenantId: identifier(999) }, event.id, f.roundId)).rejects.toMatchObject({ status: 404 });
    await expect(f.scores.get(creator, identifier(999), f.roundId)).rejects.toMatchObject({ status: 404 });
    await expect(f.scores.get(creator, event.id, identifier(999))).rejects.toMatchObject({ status: 404 });
    f.rows.delete(`${event.id}|member:${creator.objectId}`);
    await expect(f.scores.get(creator, event.id, f.roundId)).rejects.toMatchObject({ status: 404 });
  });

  it('rejects holes/golfers not in the saved round, including source IDs masquerading as ordinal holes', async () => {
    const f = await scoringFixture();
    for (const hole of [0, 19, 201, 1.5, NaN]) await expect(f.write(null, 600, hole)).rejects.toMatchObject({ status: 400 });
    await expect(f.scores.write(creator, event.id, f.roundId, identifier(999), 1, { kind: 'unplayed' }, null, identifier(600))).rejects.toMatchObject({ code: 'ROUND_PLAYER_NOT_FOUND' });
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('initializes exactly nine real saved holes rather than assuming an eighteen-hole course', async () => {
    const f = await scoringFixture();
    const round = f.saved.rounds[0];
    if (!round) throw new Error('Missing fictional round');
    const nine = {
      ...round, teeProfile: {
        ...round.teeProfile, holeCount: 9, totalYardage: 3150, totalPar: 36,
        holes: round.teeProfile.holes.slice(0, 9),
      },
    };
    f.seed({ partitionKey: event.id, rowKey: `round:${f.roundId}`, content: canonical(nine) });
    const read = await f.scores.get(creator, event.id, f.roundId);
    expect(isRoundScores(read)).toBe(true);
    expect(read.cards.every((card) => card.holes.length === 9)).toBe(true);
    expect((await f.write(null, 600, 9)).change.holeNumber).toBe(9);
    await expect(f.write(null, 601, 10)).rejects.toMatchObject({ code: 'ROUND_HOLE_NOT_FOUND' });
  });

  it('rejects stale/create preconditions, missing or corrupt cards and corrupt locks without replacing data', async () => {
    const f = await scoringFixture();
    await expect(f.write('missing-revision')).rejects.toMatchObject({ code: 'SCORECARD_CHANGED' });
    const first = await f.write();
    await expect(f.write(null, 601)).rejects.toMatchObject({ code: 'SCORECARD_CHANGED' });
    await expect(f.write('stale-revision', 601)).rejects.toMatchObject({ code: 'SCORECARD_CHANGED' });
    const key = `${event.id}|score-card:${f.roundId}:${f.playerId}`;
    const original = f.rows.get(key);
    if (!original) throw new Error('Missing fictional card');
    f.rows.delete(key);
    await expect(f.write(first.round.cards[0]?.etag ?? 'missing', 601)).rejects.toMatchObject({ code: 'INVALID_STORED_SCORECARD' });
    await expect(f.scores.get(creator, event.id, f.roundId)).rejects.toMatchObject({ code: 'INVALID_STORED_SCORECARD' });
    await expect(f.write()).rejects.toMatchObject({ code: 'INVALID_STORED_SCORECARD' });
    f.seed({ ...original, content: '{}' });
    await expect(f.scores.get(creator, event.id, f.roundId)).rejects.toMatchObject({ status: 503 });
    f.seed(original);
    f.seed({ partitionKey: event.id, rowKey: `score-lock:${f.roundId}`, content: '{}' });
    await expect(f.scores.get(creator, event.id, f.roundId)).rejects.toMatchObject({ status: 503 });
    await expect(f.workspace.save(creator, event.id, f.input, (await new TableEventStore(f.table).list(creator)).events[0]?.etag ?? '')).rejects.toMatchObject({ status: 503 });
  });

  it('returns definitive original acknowledgement plus fresh round on retries, even after a later correction and lost commit response', async () => {
    const f = await scoringFixture();
    f.submit.mockImplementationOnce((actions) => {
      f.apply(actions);
      return Promise.reject(new Error('Fictional timeout after commit'));
    });
    const first = await f.write();
    const correction = await f.scores.write(creator, event.id, f.roundId, f.playerId, 1, { kind: 'strokes', strokes: 5 }, first.round.cards[0]?.etag ?? null, identifier(601));
    const replay = await f.write();
    expect(replay.change).toEqual(first.change);
    expect(replay.round).toEqual(correction.round);
    expect((await f.scores.history(creator, event.id, f.roundId, f.playerId)).changes).toHaveLength(2);
    await expect(f.scores.write(creator, event.id, f.roundId, f.playerId, 2, { kind: 'strokes', strokes: 4 }, null, identifier(600))).rejects.toMatchObject({ code: 'SCORE_REQUEST_CONFLICT' });
    await expect(f.write('other', 600)).rejects.toMatchObject({ code: 'SCORE_REQUEST_CONFLICT' });
    await expect(f.scores.write(creator, event.id, f.roundId, f.playerId, 1, { kind: 'picked-up' }, null, identifier(600))).rejects.toMatchObject({ code: 'SCORE_REQUEST_CONFLICT' });
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'owner' });
    await expect(f.scores.write(member, event.id, f.roundId, f.playerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(600))).rejects.toMatchObject({ code: 'SCORE_REQUEST_CONFLICT' });
  });

  it('serializes competing writes; identical operation retries create exactly one audit', async () => {
    const f = await scoringFixture();
    const same = await Promise.all([f.write(), f.write()]);
    expect(same[0].change).toEqual(same[1].change);
    expect((await f.scores.history(creator, event.id, f.roundId, f.playerId)).changes).toHaveLength(1);
    const etag = same[0].round.cards[0]?.etag ?? null;
    const outcomes = await Promise.allSettled([f.write(etag, 601), f.write(etag, 602)]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await f.scores.history(creator, event.id, f.roundId, f.playerId)).changes).toHaveLength(2);
  });

  it('returns the original accepted change even when another edit commits before its round read-back', async () => {
    const f = await scoringFixture();
    f.submit.mockImplementationOnce(async (actions) => {
      f.apply(actions);
      const current = await f.scores.get(creator, event.id, f.roundId);
      await f.scores.write(creator, event.id, f.roundId, f.playerId, 1, { kind: 'strokes', strokes: 7 }, current.cards[0]?.etag ?? null, identifier(601));
      return { status: 202, subResponses: [], getResponseForEntity: () => undefined };
    });
    const result = await f.write();
    expect(isScoreWriteResult(result)).toBe(true);
    expect(result.change.after).toEqual({ kind: 'strokes', strokes: 4 });
    expect(result.round.cards[0]?.holes[0]?.score).toEqual({ kind: 'strokes', strokes: 7 });
    expect((await f.scores.history(creator, event.id, f.roundId, f.playerId)).changes).toHaveLength(2);
  });

  it('conflicts concurrent operation-ID collisions without overwriting the first value', async () => {
    const f = await scoringFixture();
    const outcomes = await Promise.allSettled([
      f.write(), f.scores.write(creator, event.id, f.roundId, f.playerId, 1, { kind: 'picked-up' }, null, identifier(600)),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toMatchObject([{ reason: { code: 'SCORE_REQUEST_CONFLICT' } }]);
    expect((await f.scores.history(creator, event.id, f.roundId, f.playerId)).changes).toHaveLength(1);
  });

  it.each(['scores', 'history'] as const)('rechecks owner access after reading %s and does not leak data after revocation', async (action) => {
    const f = await scoringFixture();
    await f.write();
    const implementation = f.get.getMockImplementation();
    if (!implementation) throw new Error('Missing fictional get implementation');
    let revoked = false;
    f.get.mockImplementation((partition, key, options) => {
      const result = implementation(partition, key, options);
      if (!revoked && key === `score-card:${f.roundId}:${f.playerId}`) {
        revoked = true;
        f.rows.delete(`${event.id}|member:${creator.objectId}`);
      }
      return result;
    });
    if (action === 'history') {
      const list = f.list.getMockImplementation();
      if (!list) throw new Error('Missing fictional list implementation');
      f.list.mockImplementation((options) => {
        f.rows.delete(`${event.id}|member:${creator.objectId}`);
        return list(options);
      });
    }
    await expect(action === 'scores' ? f.scores.get(creator, event.id, f.roundId)
      : f.scores.history(creator, event.id, f.roundId, f.playerId)).rejects.toMatchObject({ status: 404 });
  });

  it('allowlists card and history fields and fails closed on invalid stored event status', async () => {
    const f = await scoringFixture();
    const first = await f.write();
    const card = first.round.cards[0];
    if (!card) throw new Error('Missing fictional card');
    const { etag: _etag, ...content } = card;
    void _etag;
    f.seed({
      partitionKey: event.id, rowKey: `score-card:${f.roundId}:${f.playerId}`,
      content: canonical({ ...content, privateField: 'fictional-private-marker', holes: content.holes.map((hole) => ({ ...hole, privateField: 'fictional-private-marker' })) }),
    });
    const audit = f.rows.get(`${event.id}|score-change:${identifier(600)}`);
    if (!audit) throw new Error('Missing fictional audit');
    f.seed({ ...audit, content: canonical({ ...first.change, privateField: 'fictional-private-marker', recordedBy: { ...creator, privateField: 'fictional-private-marker' } }) });
    expect(JSON.stringify(await f.scores.get(creator, event.id, f.roundId))).not.toContain('fictional-private-marker');
    expect(JSON.stringify(await f.scores.history(creator, event.id, f.roundId, f.playerId))).not.toContain('fictional-private-marker');
    const root = f.rows.get(`${event.id}|event`);
    if (!root) throw new Error('Missing fictional event');
    f.seed({ ...root, status: null });
    await expect(f.scores.get(creator, event.id, f.roundId)).rejects.toMatchObject({ code: 'INVALID_STORED_EVENT' });
  });

  it('allows archived owner reads/history only and rechecks revocation on every replay', async () => {
    const f = await scoringFixture();
    const first = await f.write();
    const events = new TableEventStore(f.table);
    const current = await f.workspace.get(creator, event.id);
    await events.setStatus(creator, event.id, 'archived', current.etag);
    expect((await f.scores.get(creator, event.id, f.roundId)).eventStatus).toBe('archived');
    expect((await f.scores.history(creator, event.id, f.roundId, f.playerId)).changes[0]).toEqual(first.change);
    await expect(f.write()).rejects.toMatchObject({ code: 'EVENT_ARCHIVED' });
    f.rows.delete(`${event.id}|member:${creator.objectId}`);
    await expect(f.write()).rejects.toMatchObject({ status: 404 });
    await expect(f.scores.history(creator, event.id, f.roundId, f.playerId)).rejects.toMatchObject({ status: 404 });
  });

  it.each(['archive', 'revoke'] as const)('conditionally rejects a write racing %s without creating a card, audit or lock', async (action) => {
    const f = await scoringFixture();
    f.submit.mockImplementationOnce((actions) => {
      if (action === 'archive') {
        const root = f.rows.get(`${event.id}|event`);
        if (!root) throw new Error('Missing fictional event');
        f.seed({ ...root, status: 'archived' });
      } else {
        const grant = f.rows.get(`${event.id}|member:${creator.objectId}`);
        if (!grant) throw new Error('Missing fictional grant');
        f.seed({ ...grant, role: 'member' });
      }
      try { f.apply(actions); } catch (error) { return Promise.reject(error instanceof Error ? error : new Error('Invalid fictional conflict')); }
      throw new Error('Expected fictional race to reject');
    });
    await expect(f.write()).rejects.toMatchObject({ status: 409 });
    expect([...f.rows.values()].filter((row) => row.rowKey?.startsWith('score-'))).toHaveLength(0);
  });

  it('rejects storage outages and malformed immutable audit rows rather than returning an empty history', async () => {
    const f = await scoringFixture();
    f.get.mockRejectedValueOnce({ statusCode: 404, code: 'TableNotFound' });
    await expect(f.scores.get(creator, event.id, f.roundId)).rejects.toMatchObject({ statusCode: 404 });
    await f.write();
    const row = f.rows.get(`${event.id}|score-change:${identifier(600)}`);
    if (!row) throw new Error('Missing fictional audit');
    f.seed({ ...row, content: canonical({ wrong: 'audit' }) });
    await expect(f.scores.history(creator, event.id, f.roundId, f.playerId)).rejects.toMatchObject({ status: 503 });
    await expect(f.write()).rejects.toMatchObject({ status: 503 });
  });

  it('bounds and scopes history pages to the selected saved player and round', async () => {
    const f = await scoringFixture();
    let result = await f.write();
    for (let index = 1; index < 52; index++) result = await f.write(result.round.cards[0]?.etag ?? null, 600 + index);
    await f.scores.write(creator, event.id, f.roundId, identifier(201), 1, { kind: 'picked-up' }, null, identifier(900));
    const first = await f.scores.history(creator, event.id, f.roundId, f.playerId);
    expect(first.changes).toHaveLength(50);
    expect(first.continuationToken).toEqual(expect.any(String));
    const second = await f.scores.history(creator, event.id, f.roundId, f.playerId, first.continuationToken);
    expect(second.changes).toHaveLength(2);
    expect(second.continuationToken).toBeUndefined();
    expect([...first.changes, ...second.changes].every((change) => change.playerId === f.playerId && change.roundId === f.roundId)).toBe(true);
    expect(f.list.mock.calls.at(-1)?.[0]?.queryOptions?.filter).toContain(`playerId eq '${f.playerId}'`);
  });
});
