import type { CourseHole } from '../../domain/catalog';
import type { RoundScores, Scorecard } from '../../domain/scoring';
import type { GamePlayerResult, GameTeamResult, RoundGameDefinition, RoundGameResult } from '../../domain/games';
import { gameUnavailableMessage } from '../games';
import { summarizeGross } from '../../domain/scoring';
import { visibleGames } from '../../domain/games';
import { handicapStrokesForHole } from '../../domain/stableford';
import { hasStrokeAllocation } from '../../domain/tees';
import { gameHandicap } from '../../domain/game-handicaps';
import type { PlayerCourseHandicap } from '../../domain/scoring';
import type { RoundGroup } from '../../domain/setup';
import type { WolfGameDefinition } from '../../domain/wolf';

export function scorecardHandicapStrokes(
  handicap: number | null | undefined, layout: readonly CourseHole[], enabled: boolean | undefined,
): ReadonlyMap<number, number> | null {
  if (typeof handicap !== 'number' || !Number.isSafeInteger(handicap) || ![9, 18].includes(layout.length)) return null;
  if (handicap === 0) return new Map(layout.map((hole) => [hole.number, 0]));
  if (!hasStrokeAllocation({ holes: layout, strokeAllocation: enabled === true })) return null;
  return new Map(layout.map((hole) => [hole.number, handicapStrokesForHole(handicap, hole.allocation, layout.length)]));
}

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
  readonly linkedWolf?: {
    readonly definition: WolfGameDefinition;
    readonly result: RoundGameResult | undefined;
  };
}

export function scorecardUsesStrokesOff(game: ScorecardGame | undefined): boolean {
  const definition = game?.linkedWolf?.definition ?? game?.definition;
  if (definition?.kind === 'dots') return definition.highLow?.handicapRule === 'group-low-v1';
  return definition !== undefined && definition.basis === 'net'
    && (definition.handicapRule === 'group-low-v1'
      || definition.handicapRule === undefined && (definition.kind === 'churchy' || definition.kind === 'wolf'));
}

export function scorecardStrokeHandicap(
  game: ScorecardGame | undefined, playerId: string, courseHandicaps: readonly PlayerCourseHandicap[] | undefined,
  groups: readonly RoundGroup[],
): { readonly value: number | null | undefined; readonly basis: 'CH' | 'SO' } {
  const course = { value: courseHandicaps?.find((entry) => entry.playerId === playerId)?.courseHandicap, basis: 'CH' as const };
  if (!scorecardUsesStrokesOff(game)) return course;
  const source = game?.linkedWolf ?? game;
  if (!source) return course;
  const definition = source.definition;
  if ('groupNumber' in definition && !groups.some((group) => group.number === definition.groupNumber
    && group.playerIds.includes(playerId))) return course;
  if (definition.kind !== 'dots' && definition.handicapRule === undefined) {
    return { value: source.result?.players.find((player) => player.playerId === playerId)?.playingHandicap ?? null, basis: 'SO' };
  }
  const value = gameHandicap('group-low-v1', playerId, courseHandicaps?.map((entry) => ({
    playerId: entry.playerId, handicap: entry.courseHandicap ?? entry.unavailableReason ?? null,
  })) ?? [], groups);
  return { value: typeof value === 'number' ? value : null, basis: 'SO' };
}

export function scorecardGame(round: RoundScores, gameId?: string | null, playerIds?: readonly string[]): ScorecardGame | undefined {
  if (gameId === null) return undefined;
  const games = visibleGames(round.games?.configuration.games ?? [], round.churchyEnabled).filter((game) =>
    (game.kind === 'nassau' || game.kind === 'match-play' ? playerIds === undefined
      || playerIds.some((id) => game.sides.some((side) => side.playerIds.includes(id)))
      : (game.kind !== 'churchy' && game.kind !== 'wolf' && game.kind !== 'dots') || playerIds === undefined
        || playerIds.length > 0 && playerIds.every((id) => game.playerIds.includes(id))));
  const definition = games.find((game) => game.id === gameId) ?? games.find((game) => game.kind !== 'nassau') ?? games[0];
  if (!definition) return undefined;
  const linked = definition.kind === 'dots' && definition.mode === 'linked'
    ? round.games?.configuration.games.find((game) => game.id === definition.linkedGameId) : undefined;
  const compatible = linked?.kind === 'wolf' && definition.kind === 'dots'
    && linked.groupNumber === definition.groupNumber && linked.playerIds.length === definition.playerIds.length
    && linked.playerIds.every((id) => definition.playerIds.includes(id))
    && round.games?.configuration.games.filter((game) => game.kind === 'dots' && game.mode === 'linked'
      && game.linkedGameId === linked.id).length === 1;
  return { definition, result: round.games?.results.find((result) => result.gameId === definition.id),
    ...(compatible ? { linkedWolf: { definition: linked,
      result: round.games.results.find((result) => result.gameId === linked.id) } } : {}) };
}

export function pointsTotalText(value: number | null, complete: boolean): string {
  return value === null ? '—' : `${String(value)}${complete ? '' : '*'}`;
}

export function scorecardGamePlayer(game: ScorecardGame | undefined, playerId: string): GamePlayerResult | GameTeamResult | undefined {
  return game?.definition.kind === 'ball-drop'
    ? game.result?.teams?.find((entry) => entry.playerIds.includes(playerId))
    : game?.result?.players.find((entry) => entry.playerId === playerId);
}

export function scorecardBallDropTeams(game: ScorecardGame | undefined, cards: readonly Scorecard[]): readonly GameTeamResult[] {
  if (game?.definition.kind !== 'ball-drop' || game.result?.teamSetupRequired) return [];
  const shown = new Set(cards.map((card) => card.playerId));
  return game.result?.teams?.filter((team) => team.playerIds.some((id) => shown.has(id))) ?? [];
}

export function ballDropContribution(game: ScorecardGame | undefined, playerId: string, holeNumber: number): {
  readonly teamName: string;
  readonly basis: 'net' | 'gross';
} | undefined {
  if (game?.definition.kind !== 'ball-drop' || game.result?.teamSetupRequired) return undefined;
  const team = game.result?.teams?.find((entry) => entry.playerIds.includes(playerId));
  const hole = team?.strokeGame?.holes.find((entry) => entry.number === holeNumber);
  if (!team || team.status === 'unavailable' || hole?.status !== 'complete' || hole.value === null
    || hole.countingPlayerIds.length !== 2 || new Set(hole.countingPlayerIds).size !== 2
    || hole.countingPlayerIds.some((id) => !team.playerIds.includes(id))) return undefined;
  const position = hole.countingPlayerIds.indexOf(playerId);
  if (position < 0) return undefined;
  return { teamName: team.displayName, basis: game.definition.format === 'ball-drop-two-gross' ? 'gross'
    : game.definition.format === 'ball-drop-two-net' || position === 0 ? 'net' : 'gross' };
}

export function ballDropScoreText(value: number | null | undefined, complete = true): string {
  return value == null ? '—' : `${value > 0 ? '+' : ''}${String(value)}${complete ? '' : '*'}`;
}

export function scorecardGameWarnings(game: ScorecardGame | undefined, cards: readonly Scorecard[]): readonly string[] {
  const unavailable = new Map<string, string[]>();
  if (game && game.definition.kind !== 'match-play' && game.definition.kind !== 'nassau') for (const card of cards) {
    const player = scorecardGamePlayer(game, card.playerId);
    if (!player || player.status === 'unavailable') {
      const reason = game.result?.teamSetupRequired ? 'Update team assignments before relying on team scores.'
        : player ? gameUnavailableMessage(player.strokeGame?.unavailableReason ?? player.unavailableReason) : 'Game results are unavailable.';
      unavailable.set(reason, [...(unavailable.get(reason) ?? []), card.displayName]);
    }
  }
  return [...unavailable].map(([reason, names]) => `${names.join(', ')}: ${reason}`);
}
