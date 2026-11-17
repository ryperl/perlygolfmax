import type { NassauGameDefinition, NassauHoleRecord, NassauManualPress, NassauRoundContext } from './nassau.js';
import type { WolfGameDefinition, WolfHoleRecord, WolfRoundInput } from './wolf.js';
import { sameWolfChoice } from './wolf.js';
import type { HoleScore, RoundScores, Scorecard } from './scoring.js';
import type { RoundGroup } from './setup.js';
import type { GamePlayerResult } from './games.js';
import type { WolfResults } from './wolf.js';

export type RoundGameScoringContext = Pick<RoundScores, 'roundId' | 'layout' | 'groups' | 'cards' | 'playerTees'
  | 'courseHandicaps' | 'teeStrokeAllocation' | 'gameInputContext' | 'inputRevision'>;

export class GameDeclarationConflictError extends Error {}

function samePress(a: NassauManualPress, b: NassauManualPress): boolean {
  return a.id === b.id && a.parentBetId === b.parentBetId && a.matchId === b.matchId
    && a.startHole === b.startHole && a.declaredAfterHole === b.declaredAfterHole
    && a.pressingSide === b.pressingSide && a.proof === b.proof;
}

export function sameNassauRecords(a: readonly NassauHoleRecord[] | undefined, b: readonly NassauHoleRecord[] | undefined): boolean {
  return (a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every((record) => {
    const other = b?.find((entry) => entry.gameId === record.gameId);
    return other !== undefined && record.number === other.number && record.gameEtag === other.gameEtag
      && record.outcomes.length === other.outcomes.length && record.outcomes.every((outcome) =>
        other.outcomes.some((entry) => outcome.matchId === entry.matchId && outcome.outcome === entry.outcome))
      && record.presses.length === other.presses.length && record.presses.every((press) => {
        const counterpart = other.presses.find((entry) => entry.id === press.id);
        return counterpart !== undefined && samePress(press, counterpart);
      });
  });
}

export function sameWolfRecords(a: readonly WolfHoleRecord[] | undefined, b: readonly WolfHoleRecord[] | undefined): boolean {
  return (a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every((record) => {
    const other = b?.find((entry) => entry.choice.gameId === record.choice.gameId);
    return other !== undefined && record.number === other.number && record.outcome === other.outcome
      && record.recordedLate === other.recordedLate
      && sameWolfChoice(record.choice, other.choice);
  });
}

export function mergeNassauRecords(edits: readonly NassauHoleRecord[], saved: readonly NassauHoleRecord[] = []): readonly NassauHoleRecord[] {
  const result = new Map(saved.map((record) => [record.gameId, record]));
  for (const edit of edits) {
    const previous = result.get(edit.gameId);
    const outcomes = new Map(previous?.outcomes.map((outcome) => [outcome.matchId, outcome]) ?? []);
    const presses = new Map(previous?.presses.map((press) => [press.id, press]) ?? []);
    for (const outcome of edit.outcomes) {
      if (outcome.outcome === 'scores') outcomes.delete(outcome.matchId);
      else outcomes.set(outcome.matchId, outcome);
    }
    for (const press of edit.presses) {
      const old = presses.get(press.id);
      if (old && !samePress(old, press)) throw new GameDeclarationConflictError('A saved Nassau press cannot be replaced.');
      presses.set(press.id, press);
    }
    if (outcomes.size || presses.size) result.set(edit.gameId, { ...edit, outcomes: [...outcomes.values()], presses: [...presses.values()] });
    else result.delete(edit.gameId);
  }
  return [...result.values()];
}

export function mergeWolfRecords(edits: readonly WolfHoleRecord[], saved: readonly WolfHoleRecord[] = []): readonly WolfHoleRecord[] {
  const result = new Map(saved.map((record) => [record.choice.gameId, record]));
  for (const edit of edits) {
    const previous = result.get(edit.choice.gameId);
    const outcome = edit.outcome ?? previous?.outcome;
    result.set(edit.choice.gameId, { number: edit.number, choice: edit.choice,
      ...(previous?.recordedLate || edit.recordedLate ? { recordedLate: true as const } : {}),
      ...(outcome && outcome !== 'scores' ? { outcome } : {}) });
  }

  return [...result.values()];
}

export function scoreMatchesIntent(saved: HoleScore, intent: HoleScore): boolean {
  try {
    return sameNassauRecords(mergeNassauRecords(intent.nassau ?? [], saved.nassau), saved.nassau)
      && sameWolfRecords(mergeWolfRecords(intent.wolf ?? [], saved.wolf), saved.wolf);
  } catch (error) {
    if (error instanceof GameDeclarationConflictError) return false;
    throw error;
  }
}

export function gameAnchorPlayerId(game: WolfGameDefinition | NassauGameDefinition, groups: readonly RoundGroup[]): string | undefined {
  return groups.find((group) => group.number === game.groupNumber)?.playerIds[0];
}

export function nassauRecordsFor(game: NassauGameDefinition, groups: readonly RoundGroup[], cards: readonly Scorecard[]): readonly NassauHoleRecord[] {
  return cards.find((card) => card.playerId === gameAnchorPlayerId(game, groups))?.holes
    .flatMap((hole) => hole.score.nassau?.filter((record) => record.gameId === game.id) ?? []) ?? [];
}

export function wolfRecordsFor(game: WolfGameDefinition, groups: readonly RoundGroup[], cards: readonly Scorecard[]): readonly WolfHoleRecord[] {
  return cards.find((card) => card.playerId === gameAnchorPlayerId(game, groups))?.holes
    .flatMap((hole) => hole.score.wolf?.filter((record) => record.choice.gameId === game.id) ?? []) ?? [];
}

export function wolfInputFromScores(round: RoundGameScoringContext): WolfRoundInput {
  return { layout: round.layout, groups: round.groups, players: round.cards.map((card) => {
    const tee = round.playerTees?.find((entry) => entry.playerId === card.playerId)?.profile;
    const handicap = round.courseHandicaps?.find((entry) => entry.playerId === card.playerId);
    return { playerId: card.playerId, displayName: card.displayName, layout: tee?.holes ?? round.layout,
      strokeAllocation: tee?.strokeAllocation ?? round.teeStrokeAllocation,
      handicap: handicap?.courseHandicap ?? handicap?.unavailableReason ?? 'missing-handicap-index' };
  }) };
}

export function nassauContextFromScores(round: RoundGameScoringContext): NassauRoundContext | null {
  const context = round.gameInputContext;
  if (!context) return null;
  return { id: round.roundId, courseVersionId: context.courseVersionId,
    ...(round.inputRevision ? { inputRevision: round.inputRevision } : {}),
    teeProfile: { id: context.teeProfileId, holeCount: round.layout.length, holes: round.layout,
      strokeAllocation: round.teeStrokeAllocation === true },
    playerTees: round.playerTees ?? [], groups: round.groups,
    players: round.cards.map((card) => ({ playerId: card.playerId, displayName: card.displayName })) };
}

export function wolfResultPlayers(wolf: WolfResults): readonly GamePlayerResult[] {
  const total = (holes: GamePlayerResult['holes']) => holes.some((hole) => hole.points !== null)
    ? holes.reduce((sum, hole) => sum + (hole.points ?? 0), 0) : null;
  return wolf.players.map((player) => {
    const holes = wolf.holes.map((hole) => ({ number: hole.number,
      points: hole.transfers.find((entry) => entry.playerId === player.playerId)?.dots ?? null, strokesReceived: null }));
    return { playerId: player.playerId, displayName: player.displayName, playingHandicap: player.playingHandicap,
      status: player.status, holes, holesScored: player.holesScored, totalHoles: player.totalHoles,
      frontPoints: total(holes.filter((hole) => hole.number <= 9)),
      backPoints: total(holes.filter((hole) => hole.number > 9)), totalPoints: player.balance };
  });
}

/** Unchanged namespaces need not be echoed into bounded raw-score requests. */
export function scoreDeclarationIntent(score: HoleScore, saved: HoleScore): HoleScore {
  const { nassau, wolf, ...raw } = score;
  return { ...raw,
    ...(nassau && !sameNassauRecords(mergeNassauRecords(nassau, saved.nassau), saved.nassau) ? { nassau } : {}),
    ...(wolf && !sameWolfRecords(mergeWolfRecords(wolf, saved.wolf), saved.wolf) ? { wolf } : {}),
  };
}
