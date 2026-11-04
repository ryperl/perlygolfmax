import { describe, expect, it, vi } from 'vitest';
import { fictionalChange, fictionalRoundScores, scoreResult } from '../../client/scoring.test-support';
import { fictionalId } from '../../client/catalog.test-support';
import type { RoundScores, ScoreChange } from '../../domain/scoring';
import { cardFor, editedDraft, entryKey } from './entry-state';
import type { HoleDraft } from './entry-state';
import { planGroup, saveGroupEntries } from './save-group';
import { deferred, memoryScores } from './scoring.test-support';

const playerIds = fictionalRoundScores.cards.map((card) => card.playerId);
function entries() {
  return new Map(playerIds.map((id) => [entryKey(id, 1), editedDraft('4', cardFor(fictionalRoundScores, id))]));
}
function harness(initial = fictionalRoundScores) {
  const store = memoryScores(initial);
  const drafts = entries();
  const changes: ScoreChange[] = [];
  let latest = initial;
  const callbacks = {
    onDraft: (key: string, value: HoleDraft | null) => { if (value) drafts.set(key, value); else drafts.delete(key); },
    onProjection: (round: RoundScores) => { latest = round; }, onAcknowledged: (change: ScoreChange) => { changes.push(change); },
  };
  return { ...store, drafts, changes, latest: () => latest,
    save: () => saveGroupEntries({ client: store.client, round: latest, holeNumber: 1,
      plan: planGroup(latest, playerIds, 1, drafts), signal: new AbortController().signal, refreshVersion: 0, ...callbacks }) };
}
describe('serialized group save protocol', () => {
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
    expect(test.changes).toHaveLength(4);
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
    expect(calls.map((call) => call[6])).toEqual([test.changes[0]?.id, b?.id, b?.id, c?.id, d?.id]);
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
    expect(test.changes).toHaveLength(4);
    expect(test.drafts.get(entryKey(fictionalId(1), 1))).toMatchObject({
      text: 'X7', status: 'conflict', acknowledged: { after: { kind: 'picked-up', reportedStrokes: 7 } },
    });
    expect(test.drafts.get(entryKey(fictionalId(1), 1))?.attempt).toBeUndefined();
  });
});
