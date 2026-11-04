import type { AccountIdentity } from './events.js';

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

export interface RoundGameDefinition {
  readonly id: string;
  readonly name: string;
  readonly preset: StablefordPreset;
  readonly basis: GameScoreBasis;
  readonly handicapAllowancePercent: number;
  readonly points: StablefordPointsTable;
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

export interface GameHoleResult {
  readonly number: number;
  readonly points: number | null;
  readonly strokesReceived: number | null;
}

export interface GamePlayerResult {
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
  readonly gameId: string;
  readonly players: readonly GamePlayerResult[];
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
  readonly recordedBy: AccountIdentity;
}

export const defaultHandicapAllowancePercent = 95;
export const maximumExactGamePoints = Math.floor(Number.MAX_SAFE_INTEGER / 18);
export const maximumGamesPerRound = 16;
export const maximumPointsRows = 32;

export function sameGameDefinitions(left: readonly RoundGameDefinition[], right: readonly RoundGameDefinition[]): boolean {
  return left.length === right.length && left.every((game, index) => {
    const other = right[index];
    return other !== undefined && game.id === other.id && game.name === other.name
      && game.preset === other.preset && game.basis === other.basis
      && game.handicapAllowancePercent === other.handicapAllowancePercent
      && game.points.betterScorePoints === other.points.betterScorePoints
      && game.points.worseScorePoints === other.points.worseScorePoints
      && game.points.rows.length === other.points.rows.length
      && game.points.rows.every((row, rowIndex) => {
        const counterpart = other.points.rows[rowIndex];
        return counterpart !== undefined && row.scoreToPar === counterpart.scoreToPar && row.points === counterpart.points;
      });
  });
}
