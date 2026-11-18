import { describe, expect, it, vi } from 'vitest';
import { fictionalChange, fictionalRoundScores, scoreResult } from '../../client/scoring.test-support';
import { fictionalId } from '../../client/catalog.test-support';
import type { RoundScores } from '../../domain/scoring';
import { cardFor, editedDraft, entryKey } from './entry-state';
import type { HoleDraft } from './entry-state';
import { planGroup, saveGroupEntries } from './save-group';
import { deferred, memoryScores } from './scoring.test-support';
import { churchyFixture } from '../../domain/churchy.test-support';
import { fictionalKpRound } from '../kp/kp.test-support';
import { matchGamesFixture } from '../../domain/match-games.test-support';
import { dotsFixture } from '../dots/dots.test-support';
import type { DotsHoleRecord } from '../../domain/dots';

const playerIds = fictionalRoundScores.cards.map((card) => card.playerId);
function entries() {
  return new Map(playerIds.map((id) => [entryKey(id, 1), editedDraft('4', cardFor(fictionalRoundScores, id))]));
}
function harness(initial = fictionalRoundScores) {
  const store = memoryScores(initial);
  const drafts = entries();
  let latest = initial;
  const callbacks = {
    onDraft: (key: string, value: HoleDraft | null) => { if (value) drafts.set(key, value); else drafts.delete(key); },
    onProjection: (round: RoundScores) => { latest = round; },
  };
  return { ...store, drafts, latest: () => latest,
    save: () => saveGroupEntries({ client: store.client, round: latest, holeNumber: 1,
      plan: planGroup(latest, playerIds, 1, drafts), signal: new AbortController().signal, refreshVersion: 0, ...callbacks }) };
}
describe('serialized group save protocol', () => {
  it('prevents every group write for new source conflicts while retaining unchanged historical conflicts for other golfer edits', async () => {
    const f = dotsFixture(), anchor = f.ids[0], peer = f.ids[1];
    if (!anchor || !peer || !f.round.games) throw new Error('Missing fictional group.');
    const record: DotsHoleRecord = { number: 1, gameId: f.game.id, gameEtag: 'fictional-game-revision',
      players: [{ playerId: anchor, counts: { hogan: 1, seve: 1 }, calls: [] }], contests: [] };
    const game = { ...f.game, specials: [...f.game.specials, { kind: 'hogan' as const, units: 1 }, { kind: 'seve' as const, units: 1 }] };
    const round = { ...f.round, games: { ...f.round.games, configuration: { ...f.round.games.configuration, games: [game] } } };
    const drafts = new Map(f.ids.map((id) => [entryKey(id, 1), { ...editedDraft('3', cardFor(round, id)),
      ...(id === anchor ? { dots: [record] } : {}) }]));
    const store = memoryScores(round);
    const plan = planGroup(round, f.ids, 1, drafts);
    expect(plan.invalid).toEqual([anchor]);
    await expect(saveGroupEntries({ client: store.client, round, holeNumber: 1, plan, signal: new AbortController().signal,
      refreshVersion: 0, onDraft: vi.fn(), onProjection: vi.fn() })).rejects.toThrow('Review all entries');
    expect(store.client.save).not.toHaveBeenCalled();
    const historical = { ...round, cards: round.cards.map((card) => card.playerId === anchor ? { ...card,
      holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score: { ...hole.score, dots: [record] } } : hole) } : card) };
    drafts.set(entryKey(anchor, 1), { ...editedDraft('3', cardFor(historical, anchor)), dots: [{ ...record,
      players: [...record.players, { playerId: peer, counts: { sandy: 1 }, calls: [] }] }] });
    expect(planGroup(historical, f.ids, 1, drafts).invalid).toEqual([]);
    drafts.set(entryKey(anchor, 1), { ...editedDraft('3', cardFor(historical, anchor)), dots: [{ ...record,
      players: [{ playerId: anchor, counts: { hogan: 1, seve: 1, sandy: 1 }, calls: [] }] }] });
    expect(planGroup(historical, f.ids, 1, drafts).invalid).toEqual([anchor]);
  });

  it('sends only explicit Dots game replacements, retaining hidden peer records and retrying an unconfirmed call once', async () => {
    const f = dotsFixture();
    const anchor = f.ids[0];
    if (!anchor) throw new Error('Missing fictional anchor');
    const saved: DotsHoleRecord = { number: 1, gameId: f.game.id, gameEtag: 'fictional-game-revision',
      players: [{ playerId: anchor, counts: { sandy: 1 }, calls: [] }], contests: [] };
    const hidden = { ...saved, gameId: fictionalId(981), players: [] };
    let round: RoundScores = { ...f.round, cards: f.round.cards.map((card) => card.playerId === anchor
      ? { ...card, holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score: { ...hole.score, dots: [saved, hidden] } } : hole) } : card) };
    const store = memoryScores(round);
    const patch: DotsHoleRecord = { ...saved, players: [{ playerId: anchor, counts: { sandy: 2 },
      calls: [{ id: fictionalId(982), kind: 'paree', result: 'failure' }] }] };
    const drafts = new Map<string, HoleDraft>([[entryKey(anchor, 1), { ...editedDraft('4', cardFor(round, anchor), undefined, false), dots: [patch] }]]);
    const plan = planGroup(round, [anchor], 1, drafts);
    expect(plan.writes[0]?.score.dots).toEqual([patch]);
    expect(plan.targets.get(anchor)?.dots).toEqual([patch, hidden]);
    const normal = vi.mocked(store.client.save).getMockImplementation();
    if (!normal) throw new Error('Missing fictional save');
    vi.mocked(store.client.save).mockRejectedValueOnce(new Error('Fictional interrupted Dots save')).mockImplementation(normal);
    const save = () => saveGroupEntries({ client: store.client, round, holeNumber: 1,
      plan: planGroup(round, [anchor], 1, drafts), signal: new AbortController().signal, refreshVersion: 0,
      onDraft: (key, value) => { if (value) drafts.set(key, value); else drafts.delete(key); },
      onProjection: (value) => { round = value; } });
    await expect(save()).rejects.toThrow('Fictional interrupted Dots save');
    expect(drafts.get(entryKey(anchor, 1))).toMatchObject({ dots: [patch], status: 'failed' });
    await save();
    const calls = vi.mocked(store.client.save).mock.calls;
    expect(calls[1]?.[6]).toBe(calls[0]?.[6]);
    expect(calls[1]?.[4].dots).toEqual([patch]);
    expect(cardFor(round, anchor).holes.find((hole) => hole.number === 1)?.score.dots).toEqual([patch, hidden]);
    expect(drafts.size).toBe(0);
  });
  it('acknowledges anchor declarations and server late metadata once, then retries only the unconfirmed peer with its original identity', async () => {
    const f = matchGamesFixture();
    let round = f.round();
    const store = memoryScores(round);
    const [anchor, peer] = f.ids;
    if (!anchor || !peer) throw new Error('Missing fictional golfers');
    const drafts = new Map<string, HoleDraft>([
      [entryKey(anchor, 1), { ...editedDraft('4', cardFor(round, anchor), undefined, false),
        wolf: [{ number: 1, choice: { gameId: f.wolf.id, gameEtag: 'fictional-game-revision', mode: 'blind' } }] }],
      [entryKey(peer, 1), editedDraft('5', cardFor(round, peer))],
    ]);
    const normal = vi.mocked(store.client.save).getMockImplementation();
    if (!normal) throw new Error('Missing fictional save');
    let failed = false;
    vi.mocked(store.client.save).mockImplementation(async (...args) => {
      if (args[2] === peer && !failed) { failed = true; throw new Error('Fictional peer connection failure'); }
      const result = await normal(...args);
      if (args[2] !== anchor) return result;
      const records = result.change.after.wolf;
      if (!records) throw new Error('Missing fictional acknowledged choice');
      const after = { ...result.change.after, wolf: records.map((record) => ({ ...record, recordedLate: true as const })) };
      const projected = { ...result.round, cards: result.round.cards.map((card) => card.playerId === anchor
        ? { ...card, holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score: after } : hole) } : card) };
      store.replace(projected);
      return { round: projected, change: { ...result.change, after } };
    });
    const save = () => saveGroupEntries({ client: store.client, round, holeNumber: 1,
      plan: planGroup(round, [anchor, peer], 1, drafts), signal: new AbortController().signal, refreshVersion: 0,
      onDraft: (key, value) => { if (value) drafts.set(key, value); else drafts.delete(key); },
      onProjection: (value) => { round = value; } });
    await expect(save()).rejects.toThrow('Fictional peer connection failure');
    expect([...drafts.keys()]).toEqual([entryKey(peer, 1)]);
    await save();
    const calls = vi.mocked(store.client.save).mock.calls;
    expect(calls.map((call) => call[2])).toEqual([anchor, peer, peer]);
    expect(calls[1]?.[6]).toBe(calls[2]?.[6]);
    expect(drafts.size).toBe(0);
    expect(cardFor(round, anchor).holes[0]?.score.wolf?.[0]?.recordedLate).toBe(true);
  });
  it('keeps only unacknowledged KP drafts after a partial group failure, preserving exact retry IDs and blank raw scores', async () => {
    let round = fictionalKpRound();
    const store = memoryScores(round);
    const ids = round.cards.slice(0, 2).map((card) => card.playerId);
    const drafts = new Map<string, HoleDraft>(ids.map((id, index) => [entryKey(id, 1), {
      ...editedDraft('', cardFor(round, id), undefined, false),
      kp: index === 0 ? { kind: 'measured', inches: 0, onGreen: true, measurementId: fictionalId(988) } : { kind: 'no-measurement' },
    }]));
    const normal = vi.mocked(store.client.save).getMockImplementation();
    if (!normal) throw new Error('Missing fixture');
    let failed = false;
    vi.mocked(store.client.save).mockImplementation((...args) => {
      if (args[2] === ids[1] && !failed) { failed = true; return Promise.reject(new Error('Fictional KP network failure')); }
      return normal(...args);
    });
    const save = () => saveGroupEntries({ client: store.client, round, holeNumber: 1, plan: planGroup(round, ids, 1, drafts),
      signal: new AbortController().signal, refreshVersion: 0,
      onDraft: (key, value) => { if (value) drafts.set(key, value); else drafts.delete(key); },
      onProjection: (value) => { round = value; } });
    await expect(save()).rejects.toThrow('Fictional KP network failure');
    expect(drafts.size).toBe(1);
    await save();
    const calls = vi.mocked(store.client.save).mock.calls;
    expect(calls.map((call) => call[2])).toEqual([ids[0], ids[1], ids[1]]);
    expect(calls[1]?.[6]).toBe(calls[2]?.[6]);
    expect(calls.every((call) => call[4].kind === 'unplayed')).toBe(true);
    expect(calls[0]?.[4].kp).toMatchObject({ kind: 'measured', inches: 0 });
    expect(calls[2]?.[4].kp).toEqual({ kind: 'no-measurement' });
    expect(drafts.size).toBe(0);
  });
  it('retries only unacknowledged specials-only writes with the same metadata, request IDs and original card proofs', async () => {
    const f = churchyFixture();
    const initial = f.round();
    const store = memoryScores(initial);
    const ids = f.game.playerIds;
    const drafts = new Map(ids.map((id) => [entryKey(id, 1), {
      ...editedDraft('4', cardFor(initial, id)), churchy: { ...f.extras, murphy: true, murphyPresses: 2 as const },
    }]));
    const mutable: Map<string, HoleDraft> = drafts;
    let round = initial;
    const normal = vi.mocked(store.client.save).getMockImplementation();
    if (!normal) throw new Error('Missing fictional saver');
    let failed = false;
    vi.mocked(store.client.save).mockImplementation((...args) => {
      if (args[2] === ids[1] && !failed) { failed = true; return Promise.reject(new Error('Fictional uncertain specials')); }
      return normal(...args);
    });
    function save() {
      return saveGroupEntries({ client: store.client, round, holeNumber: 1, plan: planGroup(round, ids, 1, mutable),
        signal: new AbortController().signal, refreshVersion: 0,
        onDraft: (key, value) => { if (value) mutable.set(key, value); else mutable.delete(key); },
        onProjection: (value) => { round = value; } });
    }
    await expect(save()).rejects.toThrow('Fictional uncertain specials');
    const retryId = ids[1] ? mutable.get(entryKey(ids[1], 1))?.attempt?.id : undefined;
    expect(mutable.size).toBe(3);
    await save();
    const calls = vi.mocked(store.client.save).mock.calls;
    expect(calls[1]?.[6]).toBe(retryId);
    expect(calls[2]?.[6]).toBe(retryId);
    expect(calls.every((call) => {
      const specials = call[4].churchy;
      return specials !== undefined && specials.version !== 3 && specials.murphyPresses === 2;
    })).toBe(true);
    expect(mutable.size).toBe(0);
  });
  it('plans blank as unplayed, skips unchanged blanks, and prevalidates every intended row before sending anything', async () => {
    const blank = new Map([[entryKey(fictionalId(1), 1), editedDraft('', cardFor(fictionalRoundScores, fictionalId(1)))]]);
    const plan = planGroup(fictionalRoundScores, playerIds, 1, blank);
    expect(plan.writes).toEqual([]);
    expect(plan.unchanged).toEqual([entryKey(fictionalId(1), 1)]);
    expect([...plan.targets.values()]).toEqual(Array.from({ length: 4 }, () => ({ kind: 'unplayed' })));
    const test = harness();
    test.drafts.set(entryKey(fictionalId(4), 1), editedDraft('X0', cardFor(fictionalRoundScores, fictionalId(4))));
    await expect(test.save()).rejects.toThrow('Review all entries');
    expect(test.client.save).not.toHaveBeenCalled();
    expect(test.drafts.size).toBe(4);
  });
  it('issues no second player request before the first settles, then acknowledges each draft individually', async () => {
    const test = harness();
    const normal = vi.mocked(test.client.save).getMockImplementation();
    if (!normal) throw new Error('Missing fictional save');
    const gate = deferred<undefined>();
    let first = true;
    vi.mocked(test.client.save).mockImplementation(async (...args) => {
      if (first) { first = false; await gate.promise; }
      return normal(...args);
    });
    const operation = test.save();
    expect(test.client.save).toHaveBeenCalledOnce();
    expect(test.drafts.get(entryKey(fictionalId(1), 1))?.status).toBe('saving');
    expect(test.drafts.get(entryKey(fictionalId(2), 1))?.attempt?.sent).toBe(false);
    gate.resolve(undefined);
    await operation;
    expect(test.client.save).toHaveBeenCalledTimes(4);
    expect(test.drafts.size).toBe(0);
  });
  it('preserves request IDs and original bases for failed and unattempted players across a partial-save retry', async () => {
    const test = harness();
    const normal = vi.mocked(test.client.save).getMockImplementation();
    if (!normal) throw new Error('Missing fictional save');
    let failed = false;
    vi.mocked(test.client.save).mockImplementation((...args) => {
      if (args[2] === fictionalId(2) && !failed) { failed = true; return Promise.reject(new Error('Network failed.')); }
      return normal(...args);
    });
    await expect(test.save()).rejects.toThrow('Network failed');
    expect(test.drafts.has(entryKey(fictionalId(1), 1))).toBe(false);
    const b = test.drafts.get(entryKey(fictionalId(2), 1))?.attempt;
    const c = test.drafts.get(entryKey(fictionalId(3), 1))?.attempt;
    const d = test.drafts.get(entryKey(fictionalId(4), 1))?.attempt;
    expect(b?.sent).toBe(true);
    expect(c?.sent).toBe(false);
    expect(d?.sent).toBe(false);
    await test.save();
    const calls = vi.mocked(test.client.save).mock.calls;
    expect(calls.map((call) => call[6])).toEqual([calls[0]?.[6], b?.id, b?.id, c?.id, d?.id]);
    expect(calls.slice(2).map((call) => call[5])).toEqual([null, null, null]);
    expect(test.drafts.size).toBe(0);
  });
  it('does not silently rebase an unsent player after another player’s save returns concurrent changes', async () => {
    const test = harness();
    const normal = vi.mocked(test.client.save).getMockImplementation();
    if (!normal) throw new Error('Missing fictional save');
    vi.mocked(test.client.save).mockImplementation(async (...args) => {
      const saved = await normal(...args);
      return { ...saved, round: scoreResult({ ...fictionalChange, playerId: fictionalId(2), after: { kind: 'strokes', strokes: 8 } }, saved.round).round };
    });
    await expect(test.save()).rejects.toThrow('Saved data changed');
    expect(test.client.save).toHaveBeenCalledOnce();
    const draftB = test.drafts.get(entryKey(fictionalId(2), 1));
    expect(draftB).toMatchObject({ text: '4', baseEtag: null, status: 'conflict' });
    expect(draftB?.attempt?.etag).toBeNull();
    expect(draftB?.attempt?.sent).toBe(false);
  });
  it('treats a definitive X7 acknowledgement separately from a later X8 projection and preserves review intent', async () => {
    const test = harness();
    test.drafts.set(entryKey(fictionalId(1), 1), editedDraft('X7', cardFor(fictionalRoundScores, fictionalId(1))));
    const normal = vi.mocked(test.client.save).getMockImplementation();
    if (!normal) throw new Error('Missing fictional save');
    vi.mocked(test.client.save).mockImplementation(async (...args) => {
      const saved = await normal(...args);
      return args[2] === fictionalId(4) ? {
        ...saved, round: scoreResult({ ...fictionalChange, after: { kind: 'picked-up', reportedStrokes: 8 } }, saved.round).round,
      } : saved;
    });
    await expect(test.save()).rejects.toThrow('later saved values differ');
    expect(test.client.save).toHaveBeenCalledTimes(4);
    expect(test.drafts.get(entryKey(fictionalId(1), 1))).toMatchObject({
      text: 'X7', status: 'conflict', acknowledged: { after: { kind: 'picked-up', reportedStrokes: 7 } },
    });
    expect(test.drafts.get(entryKey(fictionalId(1), 1))?.attempt).toBeUndefined();
  });
});
