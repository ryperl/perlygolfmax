import type { AccountIdentity } from './events.js';
import type { PublicScoreIdentity } from './public-access.js';
import type { ChurchyGameDefinition, ChurchyResults } from './churchy.js';
import type { WolfGameDefinition, WolfResults } from './wolf.js';
import type { NassauGameDefinition, MatchPlayGameDefinition, NassauResults } from './nassau.js';
import type { DotsGameDefinition, DotsResults } from './dots.js';

export type StablefordPreset = 'standard' | 'modified';
export type GameScoreBasis = 'gross' | 'net';

export interface StablefordPointsRow {
  readonly scoreToPar: number;
  readonly points: number;
}

export interface StablefordPointsTable {
  readonly rows: readonly StablefordPointsRow[];
  readonly betterScorePoints: number;
  readonly worseScorePoints: number;
}

interface CommonGameDefinition {
  readonly id: string;
  readonly name: string;
  readonly kind?: 'stableford';
  readonly preset: StablefordPreset;
  readonly handicapAllowancePercent: number;
  readonly points: StablefordPointsTable;
}

export interface IndividualGameDefinition extends CommonGameDefinition {
  readonly basis: GameScoreBasis;
  readonly format?: never;
  readonly teams?: never;
}

export type StablefordTeamFormat = 'two-net-better-ball' | 'two-net-aggregate' | 'four-two-net';
export type BallDropFormat = 'ball-drop-net-gross' | 'ball-drop-two-net' | 'ball-drop-two-gross';
export type TeamGameFormat = StablefordTeamFormat;
export type CompetitionTeamFormat = TeamGameFormat | BallDropFormat;

export interface GameTeam {
  readonly id: string;
  readonly name: string;
  readonly playerIds: readonly string[];
}

export interface TeamGameDefinition extends CommonGameDefinition {
  readonly basis: 'net';
  readonly format: StablefordTeamFormat;
  readonly teams: readonly GameTeam[];
}

interface StrokeGameDefinition {
  readonly id: string;
  readonly name: string;
  readonly version: 1;
  readonly preset?: never;
  readonly points?: never;
  readonly handicapAllowancePercent?: never;
}

export interface BallDropGameDefinition extends StrokeGameDefinition {
  readonly kind: 'ball-drop';
  readonly basis: 'gross' | 'net';
  readonly format: BallDropFormat;
  readonly teams: readonly GameTeam[];
  readonly carryovers?: never;
}

export interface SkinsGameDefinition extends StrokeGameDefinition {
  readonly kind: 'skins';
  readonly basis: GameScoreBasis;
  readonly carryovers: boolean;
  readonly format?: never;
  readonly teams?: never;
}

export interface StrokePlayGameDefinition extends StrokeGameDefinition {
  readonly kind: 'stroke-play';
  readonly basis: GameScoreBasis;
  readonly format?: never;
  readonly teams?: never;
}

export type StablefordGameDefinition = IndividualGameDefinition | TeamGameDefinition;
export type NewRoundGameDefinition = BallDropGameDefinition | SkinsGameDefinition | StrokePlayGameDefinition;
export type RoundGameDefinition = StablefordGameDefinition | NewRoundGameDefinition | ChurchyGameDefinition | WolfGameDefinition | NassauGameDefinition | MatchPlayGameDefinition | DotsGameDefinition;
export const roundGameKinds = ['stableford', 'ball-drop', 'skins', 'churchy', 'stroke-play', 'wolf', 'nassau', 'match-play', 'dots'] as const;
export type RoundGameKind = (typeof roundGameKinds)[number];

export function isStablefordGame(game: RoundGameDefinition): game is StablefordGameDefinition {
  return game.kind === undefined || game.kind === 'stableford';
}

export function isTeamGameDefinition(game: StablefordGameDefinition): game is TeamGameDefinition;
export function isTeamGameDefinition(game: RoundGameDefinition): game is TeamGameDefinition | BallDropGameDefinition;
export function isTeamGameDefinition(game: RoundGameDefinition): game is TeamGameDefinition | BallDropGameDefinition {
  return game.format !== undefined;
}

export function teamSize(format: CompetitionTeamFormat): 2 | 4 {
  return format === 'four-two-net' || format.startsWith('ball-drop-') ? 4 : 2;
}

export function teamCountingSize(format: CompetitionTeamFormat): 1 | 2 {
  return format === 'two-net-better-ball' ? 1 : 2;
}

export function gameTeamsMatchRoster(game: RoundGameDefinition, playerIds: readonly string[]): boolean {
  if (!isTeamGameDefinition(game)) return true;
  const size = teamSize(game.format);
  const assigned = game.teams.flatMap((team) => team.playerIds);
  const roster = new Set(playerIds);
  return playerIds.length >= size && playerIds.length % size === 0
    && new Set(playerIds).size === playerIds.length
    && game.teams.every((team) => team.playerIds.length === size)
    && new Set(game.teams.map((team) => team.id)).size === game.teams.length
    && assigned.length === playerIds.length && new Set(assigned).size === assigned.length
    && assigned.every((id) => roster.has(id));
}

export interface GameConfiguration {
  readonly eventId: string;
  readonly roundId: string;
  readonly etag: string | null;
  readonly games: readonly RoundGameDefinition[];
}

export type GameUnavailableReason =
  | 'missing-handicap-index'
  | 'invalid-handicap-index'
  | 'missing-tee-ratings'
  | 'missing-stroke-index'
  | 'missing-score-data';

export type StrokeGameUnavailableReason = GameUnavailableReason | 'invalid-stroke-score' | 'arithmetic-range';

export interface StrokeGameHole {
  readonly number: number;
  readonly par: number | null;
  readonly status: 'complete' | 'pending' | 'ineligible' | 'unavailable';
  readonly grossToPar: number | null;
  readonly netToPar: number | null;
  readonly value: number | null;
  readonly countingPlayerIds: readonly string[];
}

export interface StrokeGameScore {
  readonly kind: 'ball-drop' | 'skins' | 'stroke-play';
  readonly version: 1;
  readonly holes: readonly StrokeGameHole[];
  readonly frontTotal: number | null;
  readonly backTotal: number | null;
  readonly total: number | null;
  readonly relativeToPar?: number | null;
  readonly unavailableReason?: StrokeGameUnavailableReason;
}

export interface GameHoleResult {
  readonly number: number;
  readonly points: number | null;
  readonly strokesReceived: number | null;
}

export interface GamePlayerResult {
  readonly strokeGame?: StrokeGameScore;
  readonly playerId: string;
  readonly displayName: string;
  readonly playingHandicap: number | null;
  readonly status: 'complete' | 'in-progress' | 'unavailable';
  readonly unavailableReason?: GameUnavailableReason;
  readonly holes: readonly GameHoleResult[];
  readonly holesScored: number;
  readonly totalHoles: number;
  readonly frontPoints: number | null;
  readonly backPoints: number | null;
  readonly totalPoints: number | null;
}

export interface RoundGameResult {
  readonly kind?: 'ball-drop' | 'skins' | 'churchy' | 'stroke-play' | 'wolf' | 'nassau' | 'match-play' | 'dots';
  readonly churchy?: ChurchyResults;
  readonly wolf?: WolfResults;
  readonly nassau?: NassauResults;
  readonly dots?: DotsResults;
  readonly version?: 1 | 2 | 3;
  readonly unawardedSkins?: number;
  readonly pendingSkins?: number;
  readonly gameId: string;
  readonly players: readonly GamePlayerResult[];
  readonly teams?: readonly GameTeamResult[];
  readonly teamSetupRequired?: true;
}

export interface GameTeamHoleResult {
  readonly number: number;
  readonly points: number | null;
}

export interface GameTeamResult {
  readonly strokeGame?: StrokeGameScore;
  readonly teamId: string;
  readonly displayName: string;
  readonly playerIds: readonly string[];
  readonly status: 'complete' | 'in-progress' | 'unavailable';
  readonly unavailableReason?: GameUnavailableReason;
  readonly holes: readonly GameTeamHoleResult[];
  readonly holesScored: number;
  readonly totalHoles: number;
  readonly frontPoints: number | null;
  readonly backPoints: number | null;
  readonly totalPoints: number | null;
}

export interface RoundGamesView {
  readonly configuration: GameConfiguration;
  readonly results: readonly RoundGameResult[];
}

export interface GameChange {
  readonly id: string;
  readonly eventId: string;
  readonly roundId: string;
  readonly expectedEtag: string | null;
  readonly before: readonly RoundGameDefinition[];
  readonly after: readonly RoundGameDefinition[];
  readonly recordedAt: string;
  readonly recordedBy: AccountIdentity | PublicScoreIdentity;
}

export const defaultHandicapAllowancePercent = 95;
export const defaultTeamHandicapAllowancePercent = 100;
export const maximumExactGamePoints = Math.floor(Number.MAX_SAFE_INTEGER / 18);
export const maximumGameConfigurationBytes = 12 * 1024;
export const maximumGamesPerRound = 16;
export const maximumPointsRows = 32;

export function maximumExactPointsForGame(game: RoundGameDefinition): number {
  return Math.floor(Number.MAX_SAFE_INTEGER / (18 * (isTeamGameDefinition(game) ? teamCountingSize(game.format) : 1)));
}

export function sameGameDefinitions(left: readonly RoundGameDefinition[], right: readonly RoundGameDefinition[]): boolean {
  return left.length === right.length && left.every((game, index) => {
    const other = right[index];
    if (!other) return false;
    if (game.kind === 'dots' || other.kind === 'dots') {
      return game.kind === 'dots' && other.kind === 'dots' && game.id === other.id && game.name === other.name
        && game.groupNumber === other.groupNumber && game.mode === other.mode && game.version === other.version
        && game.rotationHoles === other.rotationHoles
        && game.stakeMinor === other.stakeMinor && game.linkedGameId === other.linkedGameId
        && game.playerIds.length === other.playerIds.length && game.playerIds.every((id, i) => id === other.playerIds[i])
        && (game.partnerIds?.length ?? 0) === (other.partnerIds?.length ?? 0)
        && (game.partnerIds ?? []).every((id, i) => id === other.partnerIds?.[i])
        && game.specials.length === other.specials.length && game.specials.every((special) =>
          other.specials.some((entry) => entry.kind === special.kind && entry.units === special.units));
    }
    if (game.kind === 'wolf' || other.kind === 'wolf') {
      return game.kind === 'wolf' && other.kind === 'wolf' && game.id === other.id && game.name === other.name
        && game.basis === other.basis && game.groupNumber === other.groupNumber && game.allowPig === other.allowPig
        && game.version === other.version && game.stakeMinor === other.stakeMinor
        && game.playerIds.length === other.playerIds.length && game.playerIds.every((id, i) => id === other.playerIds[i]);
    }
    if (game.kind === 'nassau' || game.kind === 'match-play' || other.kind === 'nassau' || other.kind === 'match-play') {
      return (game.kind === 'nassau' || game.kind === 'match-play') && (other.kind === 'nassau' || other.kind === 'match-play')
        && game.kind === other.kind && game.id === other.id && game.name === other.name
        && game.basis === other.basis && game.groupNumber === other.groupNumber && game.variant === other.variant
        && game.automaticPresses === other.automaticPresses
        && game.stakes.frontMinor === other.stakes.frontMinor && game.stakes.backMinor === other.stakes.backMinor
        && game.stakes.overallMinor === other.stakes.overallMinor && game.sides.length === other.sides.length
        && game.sides.every((side, i) => {
          const counterpart = other.sides[i];
          return counterpart !== undefined && side.id === counterpart.id && side.name === counterpart.name
            && side.playerIds.length === counterpart.playerIds.length && side.playerIds.every((id, index) => id === counterpart.playerIds[index]);
        });
    }
    if (game.kind === 'churchy' || other.kind === 'churchy') {
      return game.kind === 'churchy' && other.kind === 'churchy' && game.id === other.id
        && game.name === other.name && game.groupNumber === other.groupNumber
        && game.version === other.version
        && (game.version === 1 || game.version === 3 && other.version === 3
          && game.orderMode === other.orderMode && game.specials.length === other.specials.length
          && game.specials.every((special) => other.specials.some((entry) => entry.kind === special.kind && entry.units === special.units))
          || game.version === 2 && other.version === 2
          && game.enabledSpecials.length === other.enabledSpecials.length
          && game.enabledSpecials.every((special) => other.enabledSpecials.includes(special)))
        && game.amountPerDotMinor === other.amountPerDotMinor
        && game.playerIds.length === other.playerIds.length && game.playerIds.every((id, i) => id === other.playerIds[i]);
    }
    if (!isStablefordGame(game) || !isStablefordGame(other)) {
      return !isStablefordGame(game) && !isStablefordGame(other)
        && game.id === other.id && game.name === other.name && game.kind === other.kind
        && game.basis === other.basis && game.format === other.format
        && (game.kind === 'stroke-play' && other.kind === 'stroke-play' ? true
          : game.kind === 'skins' && other.kind === 'skins' ? game.carryovers === other.carryovers
          : game.kind === 'ball-drop' && other.kind === 'ball-drop'
            && game.teams.length === other.teams.length && game.teams.every((team, index) => {
              const counterpart = other.teams[index];
              return counterpart !== undefined && team.id === counterpart.id && team.name === counterpart.name
                && team.playerIds.length === counterpart.playerIds.length
                && team.playerIds.every((id, memberIndex) => id === counterpart.playerIds[memberIndex]);
            }));
    }
    return game.id === other.id && game.name === other.name
      && game.preset === other.preset && game.basis === other.basis
      && game.handicapAllowancePercent === other.handicapAllowancePercent
      && game.format === other.format
      && (!isTeamGameDefinition(game) || isTeamGameDefinition(other)
        && game.teams.length === other.teams.length && game.teams.every((team, teamIndex) => {
          const counterpart = other.teams[teamIndex];
          return counterpart !== undefined && team.id === counterpart.id && team.name === counterpart.name
            && team.playerIds.length === counterpart.playerIds.length
            && team.playerIds.every((id, memberIndex) => id === counterpart.playerIds[memberIndex]);
        }))
      && game.points.betterScorePoints === other.points.betterScorePoints
      && game.points.worseScorePoints === other.points.worseScorePoints
      && game.points.rows.length === other.points.rows.length
      && game.points.rows.every((row, rowIndex) => {
        const counterpart = other.points.rows[rowIndex];
        return counterpart !== undefined && row.scoreToPar === counterpart.scoreToPar && row.points === counterpart.points;
      });
  });
}

export function gameResultTotal(result: GamePlayerResult | GameTeamResult): number | null {
  return result.strokeGame ? result.strokeGame.total : result.totalPoints;
}

export function gameResultRankValue(result: GamePlayerResult | GameTeamResult): number | null {
  return result.strokeGame?.kind === 'stroke-play' ? result.strokeGame.relativeToPar ?? null : gameResultTotal(result);
}

export function gameResultDirection(game: RoundGameDefinition): 1 | -1 {
  return game.kind === 'ball-drop' || game.kind === 'stroke-play' ? 1 : -1;
}

export function gameResultUnit(game: RoundGameDefinition): string {
  return game.kind === 'churchy' || game.kind === 'wolf' || game.kind === 'dots' ? 'dots' : game.kind === 'nassau' ? 'matches'
    : game.kind === 'stroke-play' ? 'strokes' : game.kind === 'ball-drop' ? 'to par' : game.kind === 'skins' ? 'skins' : 'points';
}

export function visibleGames(games: readonly RoundGameDefinition[], churchyEnabled: boolean | undefined): readonly RoundGameDefinition[] {
  return games.filter((game) => game.kind !== 'churchy' || churchyEnabled === true);
}
