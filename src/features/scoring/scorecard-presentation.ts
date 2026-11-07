import type { CourseHole } from '../../domain/catalog';
import type { RoundScores, Scorecard } from '../../domain/scoring';
import type { GamePlayerResult, GameTeamResult, RoundGameDefinition, RoundGameResult } from '../../domain/games';
import { gameUnavailableMessage } from '../games';
import { summarizeGross } from '../../domain/scoring';

export function summarizeCard(card: Scorecard, layout: readonly CourseHole[]) {
  const saved = new Map(card.holes.map((hole) => [hole.number, hole]));
  const entries = layout.flatMap((hole) => {
    const entry = saved.get(hole.number);
    return entry ? [entry] : [];
  });
  const summary = summarizeGross(entries);
  return {
    total: summary.recordedHoles === 0 ? null : summary.recordedStrokes,
    completed: summary.numericHoles,
    missing: entries.length !== layout.length,
    complete: entries.length === layout.length && summary.completeGross !== null,
  };
}

export function cardTotalText(card: Scorecard, layout: readonly CourseHole[]): string {
  const summary = summarizeCard(card, layout);
  return summary.total === null ? '—' : `${String(summary.total)}${summary.complete ? '' : '*'}`;
}

export interface ScorecardGame {
  readonly definition: RoundGameDefinition;
  readonly result: RoundGameResult | undefined;
}

export function scorecardGame(round: RoundScores, gameId?: string | null): ScorecardGame | undefined {
  if (gameId === null) return undefined;
  const games = round.games?.configuration.games ?? [];
  const definition = games.find((game) => game.id === gameId) ?? games[0];
  return definition ? { definition, result: round.games?.results.find((result) => result.gameId === definition.id) } : undefined;
}

export function pointsTotalText(value: number | null, complete: boolean): string {
  return value === null ? '—' : `${String(value)}${complete ? '' : '*'}`;
}

export function scorecardGamePlayer(game: ScorecardGame | undefined, playerId: string): GamePlayerResult | GameTeamResult | undefined {
  return game?.definition.kind === 'ball-drop'
    ? game.result?.teams?.find((entry) => entry.playerIds.includes(playerId))
    : game?.result?.players.find((entry) => entry.playerId === playerId);
}

export function scorecardGameWarnings(game: ScorecardGame | undefined, cards: readonly Scorecard[]): readonly string[] {
  const unavailable = new Map<string, string[]>();
  if (game) for (const card of cards) {
    const player = scorecardGamePlayer(game, card.playerId);
    if (!player || player.status === 'unavailable') {
      const reason = game.result?.teamSetupRequired ? 'Update team assignments before relying on team scores.'
        : player ? gameUnavailableMessage(player.strokeGame?.unavailableReason ?? player.unavailableReason) : 'Game results are unavailable.';
      unavailable.set(reason, [...(unavailable.get(reason) ?? []), card.displayName]);
    }
  }
  return [...unavailable].map(([reason, names]) => `${names.join(', ')}: ${reason}`);
}
