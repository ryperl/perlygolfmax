import { describe, expect, it } from 'vitest';
import { kpStoreFixture } from '../../test/kp-fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import { calculateKp, calculateKpPayout } from '../../../src/domain/kp.js';
import { isRoundScores, isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { canonical } from '../catalog/entities.js';

const entry = { kind: 'measured', inches: 0, onGreen: true, measurementId: identifier(900) } as const;
describe('KP atomic lifecycle, authority, history and canonical purse integration', () => {
  it('adds KP to an already-scored round without changing its capture/card and fails closed on a missing configuration', async () => {
    const f = await kpStoreFixture(4, true);
    expect(f.configured.round.setupLocked).toBe(true);
    expect(f.configured.round.cards[0]?.holes[0]?.score).toEqual({ kind: 'strokes', strokes: 4 });
    expect(f.rows.has(`${event.id}|index-capture:${f.roundId}`)).toBe(true);
    const row = f.rows.get(`${event.id}|round-kp:${f.roundId}`);
    if (!row) throw new Error('Missing fixture');
    f.rows.delete(`${event.id}|round-kp:${f.roundId}`);
    await expect(f.scores.get(creator, event.id, f.roundId)).rejects.toMatchObject({ code: 'INVALID_STORED_KP' });
    f.rows.set(`${event.id}|round-kp:${f.roundId}`, row);
    expect((await f.scores.get(creator, event.id, f.roundId)).cards[0]?.holes[0]?.score).toEqual({ kind: 'strokes', strokes: 4 });
  });
  it('saves sparse public KP-only/HIO entries with exact replay and immutable audits, never auto-erasing peers or raw X7', async () => {
    const f = await kpStoreFixture();
    const score = { kind: 'picked-up', reportedStrokes: 7, kp: entry } as const;
    f.submit.mockImplementationOnce((actions) => { f.apply(actions); return Promise.reject(new Error('Fictional lost response')); });
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, score, null, identifier(901));
    expect(isScoreWriteResult(saved)).toBe(true);
    expect(saved.change.recordedBy).toEqual(f.actor);
    expect(saved.round.setupLocked).toBe(true);
    expect(saved.round.cards[1]?.holes[0]?.score).toEqual({ kind: 'unplayed' });
    expect(calculateKp(saved.round).holes[0]?.closestPlayerIds).toEqual([f.playerId]);
    expect(calculateKpPayout(saved.round, 10000)).toMatchObject({ status: 'provisional', reservedMinor: 10000 });
    expect((await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, score, null, identifier(901))).change).toEqual(saved.change);
    const raw = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3 }, saved.round.cards[0]?.etag ?? null, identifier(902));
    expect(raw.change.after.kp).toEqual(entry);
    const no = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3, kp: { kind: 'no-measurement' } }, raw.round.cards[0]?.etag ?? null, identifier(903));
    const cleared = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3, kp: null }, no.round.cards[0]?.etag ?? null, identifier(904));
    expect(cleared.change.after.kp).toBeNull();
    expect((await f.scores.history(creator, event.id, f.roundId, f.playerId)).changes).toHaveLength(4);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3, kp: entry }, cleared.round.cards[0]?.etag ?? null, identifier(906)))
      .rejects.toMatchObject({ code: 'SCORECARD_CHANGED' });
    expect(f.rows.has(`${event.id}|score-change:${identifier(906)}`)).toBe(false);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 5,
      { kind: 'unplayed', kp: entry }, cleared.round.cards[0]?.etag ?? null, identifier(905))).rejects.toMatchObject({ code: 'KP_CONTEXT_CHANGED' });
  });
  it('closes separately from ordinary scoring, preserves metadata on raw-only clients, and reopens without unlocking captures', async () => {
    const f = await kpStoreFixture();
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, { kind: 'unplayed', kp: entry }, null, identifier(901));
    const closed = { ...f.selection, status: 'closed' as const };
    f.submit.mockImplementationOnce((actions) => { f.apply(actions); return Promise.reject(new Error('Fictional lost KP receipt')); });
    const result = await f.scores.saveKp(creator, event.id, f.roundId, closed, f.configured.round.kp?.etag ?? null, identifier(902));
    expect(calculateKpPayout(result.round, 10000)).toMatchObject({ status: 'final', reservedMinor: 0 });
    const batch = f.submit.mock.calls.at(-1)?.[0];
    expect(batch?.map((action) => action[1].rowKey)).toEqual(['event', `member:${creator.objectId}`, `round-kp:${f.roundId}`, `kp-change:${identifier(902)}`]);
    const raw = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3 }, saved.round.cards[0]?.etag ?? null, identifier(903));
    expect(raw.change.after.kp).toEqual(entry);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3, kp: null }, raw.round.cards[0]?.etag ?? null, identifier(904))).rejects.toMatchObject({ code: 'KP_ENTRIES_CLOSED' });
    const replay = await f.scores.saveKp(creator, event.id, f.roundId, closed, f.configured.round.kp?.etag ?? null, identifier(902));
    expect(replay.requestId).toBe(identifier(902));
    const reopened = await f.scores.saveKp(creator, event.id, f.roundId, f.selection, result.round.kp?.etag ?? null, identifier(905));
    expect(reopened.round.setupLocked).toBe(true);
    expect(reopened.round.cards[0]?.holes[0]?.score.kp).toEqual(entry);
    await expect(f.scores.saveKp(member, event.id, f.roundId, closed, reopened.round.kp?.etag ?? null, identifier(906))).rejects.toMatchObject({ status: 404 });
  });
  it('keeps closed KP intact when a valid Churchy special is edited through an older raw-plus-dots client', async () => {
    const f = await kpStoreFixture();
    const game = { id: identifier(980), kind: 'churchy' as const, version: 1 as const, basis: 'net' as const,
      name: 'Churchy Game', currency: 'USD' as const, amountPerDotMinor: 100, groupNumber: 1, playerIds: f.playerIds };
    const games = await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(981));
    const churchy = { gameId: game.id, gameEtag: games.round.games?.configuration.etag ?? '',
      paree: false, murphy: false, murphyPresses: 0 as const, sandy: false, pully: false };
    const first = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3, kp: entry, churchy }, null, identifier(982));
    await f.scores.saveKp(creator, event.id, f.roundId, { ...f.selection, status: 'closed' },
      first.round.kp?.etag ?? null, identifier(983));
    const changed = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3, churchy: { ...churchy, murphy: true } }, first.round.cards[0]?.etag ?? null, identifier(984));
    expect(changed.change.after).toMatchObject({ kp: entry, churchy: { murphy: true } });
    expect(changed.round.kp?.status).toBe('closed');
    expect(isScoreWriteResult(changed)).toBe(true);
  });
  it('retains archived owner-only read access and rejects every KP/score write without altering history', async () => {
    const f = await kpStoreFixture();
    const row = f.rows.get(`${event.id}|event`);
    if (!row) throw new Error('Missing fixture');
    f.seed({ ...row, status: 'archived' });
    const read = await f.scores.get(creator, event.id, f.roundId);
    expect(read.kp?.status).toBe('open');
    expect(read.permissions?.writePlayerIds).toEqual([]);
    await expect(f.scores.get(f.actor, event.id, f.roundId)).rejects.toMatchObject({ status: 404 });
    await expect(f.scores.saveKp(creator, event.id, f.roundId, { ...f.selection, status: 'closed' },
      read.kp?.etag ?? null, identifier(986))).rejects.toMatchObject({ code: 'EVENT_ARCHIVED' });
    await expect(f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
      { kind: 'unplayed', kp: { kind: 'no-measurement' } }, null, identifier(987))).rejects.toMatchObject({ code: 'EVENT_ARCHIVED' });
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('conditions closure and measurements against shared event and owner revisions, without publishing failed receipts', async () => {
    const f = await kpStoreFixture();
    for (const key of ['event', `member:${creator.objectId}`]) {
      f.submit.mockImplementationOnce((actions) => {
        const row = f.rows.get(`${event.id}|${key}`);
        if (!row) throw new Error('Missing fixture');
        f.seed({ ...row, revised: true });
        f.apply(actions);
        return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
      });
      await expect(f.scores.saveKp(creator, event.id, f.roundId, { ...f.selection, status: 'closed' },
        f.configured.round.kp?.etag ?? null, identifier(key === 'event' ? 910 : 911))).rejects.toMatchObject({ code: 'KP_CHANGED' });
    }
    expect(f.rows.has(`${event.id}|kp-change:${identifier(910)}`)).toBe(false);
    f.submit.mockImplementationOnce((actions) => {
      const kp = f.rows.get(`${event.id}|round-kp:${f.roundId}`);
      const parent = f.rows.get(`${event.id}|event`);
      if (!kp || !parent) throw new Error('Missing fixture');
      f.seed({ ...kp, content: canonical({ ...f.selection, status: 'closed' }) });
      f.seed({ ...parent, kpUpdatedAt: '2026-01-01T00:00:00Z' });
      f.apply(actions);
      return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
    });
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, { kind: 'unplayed', kp: entry }, null, identifier(912)))
      .rejects.toMatchObject({ code: 'SCORECARD_CHANGED' });
    expect(f.rows.has(`${event.id}|score-change:${identifier(912)}`)).toBe(false);
  });
  it('uses the single purse pot, resolves bound ties with explicit cents, and invalidates decisions after measurement or pot changes', async () => {
    const f = await kpStoreFixture();
    for (const [index, playerId] of f.playerIds.slice(0, 2).entries()) {
      await f.scores.write(f.actor, event.id, f.roundId, playerId, 1, {
        kind: 'unplayed', kp: { ...entry, inches: 12, measurementId: identifier(920 + index) },
      }, null, identifier(930 + index));
    }
    const plan = { eventId: event.id, currency: 'USD' as const, funding: { kind: 'fixed' as const, budgetMinor: 10001 },
      pools: [{ id: identifier(950), name: 'Fictional daily KP', source: { kind: 'kp' as const, roundId: f.roundId },
        awardUnit: 'pot' as const, amountMinor: 10001 }] };
    const funded = await f.purse.save(creator, event.id, plan, [], null, identifier(951), () => Promise.resolve());
    expect(funded.current.view?.calculation.allocatedMinor).toBe(0);
    const closed = await f.scores.saveKp(creator, event.id, f.roundId, { ...f.selection, status: 'closed' }, f.configured.round.kp?.etag ?? null, identifier(952));
    const hole = calculateKp(closed.round).holes[0];
    if (!hole) throw new Error('Missing fixture');
    const choice = { holeNumber: 1, proof: hole.proof, kind: 'split' as const, playerIds: hole.closestPlayerIds,
      holeAmountMinor: 10001, extraCentPlayerIds: [f.playerId] };
    const resolved = await f.scores.saveKp(creator, event.id, f.roundId,
      { ...f.selection, status: 'closed', decisions: [choice] }, closed.round.kp?.etag ?? null, identifier(953));
    expect(resolved.round.kpPot).toEqual({ amountMinor: 10001, currency: 'USD' });
    expect(calculateKpPayout(resolved.round, 10001)).toMatchObject({ status: 'final', reservedMinor: 0 });
    expect(isRoundScores(resolved.round)).toBe(true);
    const edited = { ...plan, pools: plan.pools.map((pool) => ({ ...pool, amountMinor: 10000 })) };
    const changed = await f.purse.save(creator, event.id, edited, [], funded.current.configuration.etag, identifier(954), () => Promise.resolve());
    expect(changed.current.view?.calculation.allocatedMinor).toBe(0);
    expect(changed.current.view?.calculation.reservedMinor).toBe(10000);
    await expect(f.scores.saveKp(creator, event.id, f.roundId, { ...f.selection, status: 'closed', decisions: [choice] },
      resolved.round.kp?.etag ?? null, identifier(955))).rejects.toMatchObject({ code: 'KP_DECISION_CHANGED' });
  });
});
