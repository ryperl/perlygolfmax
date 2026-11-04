import type { ScoresClient } from '../../client/scoring';
import { EventChangedError } from '../../client/events';
import type { HoleScore, RoundScores, ScoreChange } from '../../domain/scoring';
import { sameHoleScore } from '../../domain/scoring';
import { cardFor, conflictedDraft, entryKey, entryScore, savedHole } from './entry-state';
import type { HoleDraft } from './entry-state';

export interface GroupWrite {
  readonly playerId: string;
  readonly draft: HoleDraft;
  readonly score: HoleScore;
}
export interface GroupPlan {
  readonly targets: ReadonlyMap<string, HoleScore>;
  readonly writes: readonly GroupWrite[];
  readonly unchanged: readonly string[];
  readonly invalid: readonly string[];
  readonly conflicts: readonly string[];
}

export function planGroup(round: RoundScores, playerIds: readonly string[], holeNumber: number, drafts: ReadonlyMap<string, HoleDraft>): GroupPlan {
  const targets = new Map<string, HoleScore>();
  const writes: GroupWrite[] = [];
  const unchanged: string[] = [];
  const invalid: string[] = [];
  const conflicts: string[] = [];
  for (const playerId of playerIds) {
    const card = cardFor(round, playerId);
    const saved = savedHole(card, holeNumber);
    const draft = drafts.get(entryKey(playerId, holeNumber));
    const score = draft ? entryScore(draft.text) : saved;
    if (!score) { invalid.push(playerId); continue; }
    targets.set(playerId, score);
    if (!draft) continue;
    if (draft.status === 'conflict' || !draft.attempt?.sent && draft.baseEtag !== card.etag) {
      conflicts.push(playerId);
    } else if (!draft.attempt?.sent && !draft.mustWrite && sameHoleScore(score, saved)) {
      unchanged.push(entryKey(playerId, holeNumber));
    } else {
      writes.push({ playerId, draft, score });
    }
  }
  return { targets, writes, unchanged, invalid, conflicts };
}

export async function saveGroupEntries({ client, round, holeNumber, plan, signal, refreshVersion, onDraft, onProjection, onAcknowledged }: {
  readonly client: ScoresClient;
  readonly round: RoundScores;
  readonly holeNumber: number;
  readonly plan: GroupPlan;
  readonly signal: AbortSignal;
  readonly refreshVersion: number;
  readonly onDraft: (key: string, value: HoleDraft | null) => void;
  readonly onProjection: (round: RoundScores) => void;
  readonly onAcknowledged: (change: ScoreChange) => void;
}): Promise<RoundScores> {
  if (plan.invalid.length > 0 || plan.conflicts.length > 0) throw new Error('Review all entries before saving this group.');
  let latest = round;
  const acknowledged = new Map<string, ScoreChange>();
  const queued = plan.writes.map((write) => ({
    ...write, attempt: write.draft.attempt ?? { id: crypto.randomUUID(), etag: write.draft.baseEtag, sent: false },
  }));
  for (const write of queued) onDraft(entryKey(write.playerId, holeNumber), { ...write.draft, attempt: write.attempt });
  const detectLaterChanges = () => {
    let changed = false;
    for (const [playerId, intended] of plan.targets) {
      if (queued.some((write) => write.playerId === playerId) && !acknowledged.has(playerId)) continue;
      const card = cardFor(latest, playerId);
      if (!sameHoleScore(savedHole(card, holeNumber), intended)) {
        onDraft(entryKey(playerId, holeNumber), conflictedDraft(intended, card, refreshVersion, undefined, acknowledged.get(playerId)));
        changed = true;
      }
    }
    return changed;
  };
  try {
    for (const write of queued) {
      signal.throwIfAborted();
      const key = entryKey(write.playerId, holeNumber);
      const card = cardFor(latest, write.playerId);
      if (latest.eventStatus !== 'active' || !write.attempt.sent && card.etag !== write.attempt.etag) {
        onDraft(key, conflictedDraft(write.score, card, refreshVersion, { ...write.draft, attempt: write.attempt }));
        throw new EventChangedError('Saved data changed while saving this group. Refresh and review; remaining values were not sent.');
      }
      const attempt = { ...write.attempt, sent: true };
      onDraft(key, { ...write.draft, attempt, status: 'saving' });
      try {
        const result = await client.save(round.eventId, round.roundId, write.playerId, holeNumber, write.score, attempt.etag, attempt.id, signal);
        signal.throwIfAborted();
        latest = result.round;
        acknowledged.set(write.playerId, result.change);
        onDraft(key, null);
        onProjection(latest);
        onAcknowledged(result.change);
      } catch (failure) {
        signal.throwIfAborted();
        onDraft(key, failure instanceof EventChangedError
          ? conflictedDraft(write.score, card, refreshVersion, { ...write.draft, attempt })
          : { ...write.draft, attempt, status: 'failed' });
        throw failure;
      }
    }
  } catch (failure) {
    signal.throwIfAborted();
    detectLaterChanges();
    throw failure;
  }
  if (detectLaterChanges()) throw new EventChangedError('Saves were acknowledged, but later saved values differ. Refresh and review before continuing.');
  return latest;
}
