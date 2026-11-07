import { isRoundScores } from '../../contracts/scoring';
import type { RoundScores } from '../../domain/scoring';
import type { RoundSnapshot } from '../../domain/setup';
import type { RoundGameDefinition } from '../../domain/games';

export type EntryProgressStatus = 'No scores yet' | 'In progress' | 'Entries complete';

export interface EntryCoverage {
  readonly status: EntryProgressStatus;
  readonly entered: number;
  readonly total: number;
  readonly completeHoles: number;
  readonly totalHoles: number;
}

export interface RoundEntryProgress extends EntryCoverage {
  readonly groups: readonly (EntryCoverage & { readonly number: number })[];
  readonly selectedGameName?: string;
  readonly selectedGame?: RoundGameDefinition;
}

export type RoundEntryProgressState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ready'; readonly summary: RoundEntryProgress };

export type EventEntryProgress = Readonly<Record<string, RoundEntryProgressState>>;

/** Counts saved dispositions, not gross scores, approval, or competition results. */
export function summarizeEntryProgress(eventId: string, round: RoundSnapshot, scores: RoundScores, selectedGameId?: string): RoundEntryProgressState {
  if (!isRoundScores(scores) || scores.eventId !== eventId || scores.roundId !== round.id
    || scores.layout.length !== round.teeProfile.holes.length || scores.layout.length !== round.teeProfile.holeCount
    || scores.cards.length !== round.players.length || new Set(round.players.map((player) => player.playerId)).size !== round.players.length
    || round.players.length === 0 || scores.groups.length !== round.groups.length
    || scores.cards.some((card) => !round.players.some((player) => player.playerId === card.playerId))
    || scores.layout.some((hole) => !round.teeProfile.holes.some((saved) =>
      saved.number === hole.number && saved.sourceId === hole.sourceId && saved.par === hole.par
      && saved.length === hole.length && saved.allocation === hole.allocation))
    || round.groups.some((group) => !scores.groups.some((saved) =>
      saved.number === group.number && saved.playerIds.length === group.playerIds.length
      && group.playerIds.every((id) => saved.playerIds.includes(id))))) return { kind: 'unavailable' };

  function coverage(playerIds: readonly string[]): EntryCoverage {
    const cards = scores.cards.filter((card) => playerIds.includes(card.playerId));
    const total = cards.length * scores.layout.length;
    const entered = cards.reduce((sum, card) => sum + card.holes.filter((hole) => hole.score.kind !== 'unplayed').length, 0);
    const completeHoles = cards.length === 0 ? 0 : scores.layout.filter((hole) =>
      cards.every((card) => card.holes.some((entry) => entry.number === hole.number && entry.score.kind !== 'unplayed'))).length;
    return {
      status: entered === 0 ? 'No scores yet' : entered === total ? 'Entries complete' : 'In progress',
      entered, total, completeHoles, totalHoles: scores.layout.length,
    };
  }
  const selectedGame = scores.games?.configuration.games.find((game) => game.id === selectedGameId);
  return {
    kind: 'ready',
    summary: {
      ...coverage(round.players.map((player) => player.playerId)),
      ...(selectedGame === undefined ? {} : { selectedGameName: selectedGame.name, selectedGame }),
      groups: round.groups.map((group) => ({ number: group.number, ...coverage(group.playerIds) })),
    },
  };
}
