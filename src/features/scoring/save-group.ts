import type { ScoresClient } from '../../client/scoring';
import { EventChangedError } from '../../client/events';
import type { HoleScore, RoundScores, ScoreChange } from '../../domain/scoring';
import { sameHoleScore, preserveScoreExtras, supportsDotsSpecials, supportsIndividualDotsPlayerCount } from '../../domain/scoring';
import { scoreDeclarationIntent } from '../../domain/game-declarations';
import { cardFor, conflictedDraft, entryKey, entryScore, savedHole } from './entry-state';
import type { HoleDraft } from './entry-state';
import { scoreAccessKey, writablePlayerIds } from './score-access';
import { isHoleScore } from '../../contracts/scoring';
import { validChurchyCounts } from '../churchy';
import { churchySpecialsMatchGame, churchyV3Records, sameChurchySpecials } from '../../domain/churchy';
import { dotsAutomaticWriteConflicts, dotsCoexistenceWriteConflicts, dotsDeclarationWriteIssues } from '../../domain/dots';
import type { DotsPlayerDeclaration } from '../../domain/dots';
import { dotsRecordsFor } from '../../domain/game-declarations';
import type { DotRoundInput } from '../../domain/dot-context';

function changedDeclarationConflicts(players: readonly DotsPlayerDeclaration[], previous: readonly DotsPlayerDeclaration[] = []): boolean {
  const canonical = (player: DotsPlayerDeclaration | undefined) => player && JSON.stringify({
    playerId: player.playerId, counts: Object.entries(player.counts).sort(([a], [b]) => a.localeCompare(b)),
    calls: player.calls.map((call) => [call.id, call.kind, call.result, call.murphyPresses ?? null,
      call.murphyTarget ?? null, call.pareeTarget ?? null]),
  });
  return players.some((player) => canonical(player) !== canonical(previous.find((entry) => entry.playerId === player.playerId))
    && dotsDeclarationWriteIssues(player).conflicts.length > 0);
}

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
    if (draft?.churchyCounts && !validChurchyCounts(draft.churchyCounts)) { invalid.push(playerId); continue; }
    if (draft?.churchy && !sameChurchySpecials(draft.churchy, saved.churchy)) {
      const specials = draft.churchy;
      const game = round.games?.configuration.games.find((game) => game.kind === 'churchy' && game.id === specials.gameId);
      if (round.churchyEnabled !== true || game?.kind !== 'churchy'
        || game.version !== 1 && !round.churchyRulesVersions?.includes(game.version)
        || !churchySpecialsMatchGame(specials, game)
        || specials.version === 3 && changedDeclarationConflicts(specials.players,
          saved.churchy?.version === 3 && saved.churchy.gameId === specials.gameId
            && saved.churchy.number === specials.number ? saved.churchy.players : undefined)) { invalid.push(playerId); continue; }
    }
    if (draft?.dots?.some((record) => {
      const game = round.games?.configuration.games.find((game) => game.kind === 'dots' && game.id === record.gameId);
      if (game?.kind !== 'dots' || game.version === 2 && !round.dotsRulesVersions?.includes(2)
        || game.highLow !== undefined && round.dotsHighLowVersion !== 1
        || !supportsDotsSpecials(round, game.specials)
        || game.mode === 'individual' && !supportsIndividualDotsPlayerCount(round, game.playerIds.length)) return true;
      const previous = saved.dots?.find((entry) => entry.gameId === record.gameId && entry.number === record.number);
      return changedDeclarationConflicts(record.players, previous?.players);
    })) { invalid.push(playerId); continue; }
    const entry = draft ? entryScore(draft.text, draft.churchy ?? saved.churchy, draft.kp !== undefined ? draft.kp : saved.kp,
      draft.nassau, draft.wolf, draft.dots) : saved;
    if (!entry || !isHoleScore(entry)) { invalid.push(playerId); continue; }
    const score = preserveScoreExtras(entry, saved);
    if (round.dotsCallTargets !== true && score.dots?.some((record) => record.players.some((player) =>
      player.calls.some((call) => call.murphyTarget !== undefined || call.pareeTarget !== undefined
        || call.murphyPresses !== undefined)))) { invalid.push(playerId); continue; }
    targets.set(playerId, score);
    if (!draft) continue;
    if (draft.status === 'conflict' || !draft.attempt?.sent && draft.baseEtag !== card.etag) {
      conflicts.push(playerId);
    } else if (!draft.attempt?.sent && !draft.mustWrite && sameHoleScore(score, saved)) {
      unchanged.push(entryKey(playerId, holeNumber));
    } else {
      writes.push({ playerId, draft, score: scoreDeclarationIntent(entry, saved) });
    }
  }
  const nextCards = round.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => {
    const score = targets.get(card.playerId);
    return hole.number === holeNumber && score ? { ...hole, score } : hole;
  }) }));
  const before: DotRoundInput = { layout: round.layout, groups: round.groups, cards: round.cards,
    stringRulesVersion: round.stringRulesVersion ?? 1,
    dotsCategorySweepsVersion: round.dotsCategorySweepsVersion ?? 0,
    playerLayouts: round.playerTees?.map((entry) => ({ playerId: entry.playerId, layout: entry.profile.holes })) ?? [] };
  for (const game of round.games?.configuration.games ?? []) {
    if (game.kind !== 'dots' && (game.kind !== 'churchy' || game.version !== 3)) continue;
    const previous = game.kind === 'dots' ? dotsRecordsFor(game, round.groups, round.cards) : churchyV3Records(game, round.groups, round.cards);
    const records = game.kind === 'dots' ? dotsRecordsFor(game, round.groups, nextCards) : churchyV3Records(game, round.groups, nextCards);
    if (round.dotsCoexistenceRulesVersion === 2) {
      for (const id of dotsCoexistenceWriteConflicts(game, before, { ...before, cards: nextCards }, previous, records)) {
        if (!invalid.includes(id)) invalid.push(id);
      }
    }
    for (const id of dotsAutomaticWriteConflicts(game, before, { ...before, cards: nextCards }, previous, records)) {
      if (!invalid.includes(id)) invalid.push(id);
    }
  }
  return { targets, writes, unchanged, invalid, conflicts };
}

export async function saveGroupEntries({ client, round, holeNumber, plan, signal, refreshVersion, onDraft, onProjection }: {
  readonly client: ScoresClient;
  readonly round: RoundScores;
  readonly holeNumber: number;
  readonly plan: GroupPlan;
  readonly signal: AbortSignal;
  readonly refreshVersion: number;
  readonly onDraft: (key: string, value: HoleDraft | null) => void;
  readonly onProjection: (round: RoundScores) => void;
}): Promise<RoundScores> {
  if (plan.invalid.length > 0 || plan.conflicts.length > 0) throw new Error('Review all entries and resolve incompatible specials for the same golfer and hole before saving this group.');
  const accessKey = scoreAccessKey(round);
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
      const expected = acknowledged.get(playerId)?.after ?? intended;
      if (!sameHoleScore(savedHole(card, holeNumber), expected)) {
        onDraft(entryKey(playerId, holeNumber), conflictedDraft(intended, card, refreshVersion,
          queued.find((write) => write.playerId === playerId)?.draft, acknowledged.get(playerId)));
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
      if (scoreAccessKey(latest) !== accessKey || !writablePlayerIds(latest).includes(write.playerId)
        || !write.attempt.sent && card.etag !== write.attempt.etag) {
        onDraft(key, conflictedDraft(write.score, card, refreshVersion, { ...write.draft, attempt: write.attempt }));
        throw new EventChangedError('Saved data changed while saving this group. Refresh and review; remaining values were not sent.');
      }
      const attempt = { ...write.attempt, sent: true };
      onDraft(key, { ...write.draft, attempt, status: 'saving' });
      try {
        const result = await client.save(round.eventId, round.roundId, write.playerId, holeNumber, write.score,
          attempt.etag, attempt.id, signal, round.inputRevision ?? null);
        signal.throwIfAborted();
        latest = result.round;
        acknowledged.set(write.playerId, result.change);
        onDraft(key, null);
        onProjection(latest);
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
