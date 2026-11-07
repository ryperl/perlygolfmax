import type { CourseHole, TeeProfile } from './catalog.js';
import type {
  GamePlayerResult, GameUnavailableReason, RoundGameDefinition, RoundGameResult,
  StablefordGameDefinition, StablefordPointsTable, StablefordPreset,
} from './games.js';
import type { Scorecard } from './scoring.js';
import type { RoundPlayerSnapshot, RoundSnapshot } from './setup.js';
import { gameTeamsMatchRoster, isStablefordGame, isTeamGameDefinition } from './games.js';
import { calculateStrokeGameResults } from './stroke-games.js';
import { aggregateTeamGameResults } from './team-games.js';
import { playerTee } from './tees.js';

export function stablefordPoints(preset: StablefordPreset): StablefordPointsTable {
  const points = preset === 'standard' ? [6, 5, 4, 3, 2, 1, 0] : [8, 5, 2, 0, -1, -2];
  const first = preset === 'standard' ? -4 : -3;
  return {
    rows: points.map((value, index) => ({ scoreToPar: first + index, points: value })),
    betterScorePoints: preset === 'standard' ? 6 : 8,
    worseScorePoints: preset === 'standard' ? 0 : -2,
  };
}

interface Fraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

function decimal(value: number): Fraction {
  const [mantissa = '', exponent = '0'] = String(value).split('e');
  const [whole = '', fractional = ''] = mantissa.split('.');
  const scale = fractional.length - Number(exponent);
  const numerator = BigInt(`${whole}${fractional}`);
  return scale >= 0
    ? { numerator, denominator: 10n ** BigInt(scale) }
    : { numerator: numerator * 10n ** BigInt(-scale), denominator: 1n };
}

function add(left: Fraction, right: Fraction): Fraction {
  return {
    numerator: left.numerator * right.denominator + right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  };
}

function multiply(left: Fraction, right: Fraction): Fraction {
  return { numerator: left.numerator * right.numerator, denominator: left.denominator * right.denominator };
}

function floorDivide(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return numerator < 0n && numerator % denominator !== 0n ? quotient - 1n : quotient;
}

// Exact decimal ties round toward positive infinity, including plus handicaps.
function rounded(value: Fraction): bigint {
  return floorDivide(2n * value.numerator + value.denominator, 2n * value.denominator);
}

function unroundedCourseHandicap(index: string, tee: TeeProfile): Fraction | 'invalid-handicap-index' | 'missing-tee-ratings' {
  if (!/^\+?(?:0|[1-9]\d?)(?:\.\d)?$/.test(index)) return 'invalid-handicap-index';
  const count = tee.holes.length;
  const rating = tee.ratings.find((candidate) => candidate.type === 'Total');
  if (!rating || !Number.isFinite(rating.course) || rating.course <= 0
    || !Number.isFinite(rating.slope) || rating.slope <= 0) return 'missing-tee-ratings';
  let handicap = decimal(Number(index.replace('+', '')));
  if (index.startsWith('+')) handicap = { ...handicap, numerator: -handicap.numerator };
  if (count === 9) {
    const tenths = rounded(multiply(handicap, { numerator: 5n, denominator: 1n }));
    handicap = { numerator: tenths, denominator: 10n };
  }
  return add(
    multiply(handicap, multiply(decimal(rating.slope), { numerator: 1n, denominator: 113n })),
    add(decimal(rating.course), { numerator: -BigInt(tee.holes.reduce((sum, hole) => sum + hole.par, 0)), denominator: 1n }),
  );
}

export function calculateCourseHandicap(index: string, tee: TeeProfile): number | 'invalid-handicap-index' | 'missing-tee-ratings' {
  const result = unroundedCourseHandicap(index, tee);
  return typeof result === 'string' ? result : Number(rounded(result));
}

export function calculatePlayingHandicap(index: string, tee: TeeProfile, allowance: number): number | GameUnavailableReason {
  const result = unroundedCourseHandicap(index, tee);
  if (typeof result === 'string') return result;
  const count = tee.holes.length;
  if (!tee.strokeAllocation || tee.holes.some((hole) => !Number.isSafeInteger(hole.allocation)
    || hole.allocation < 1 || hole.allocation > count)
    || new Set(tee.holes.map((hole) => hole.allocation)).size !== count) return 'missing-stroke-index';
  return Number(rounded(multiply(result, { numerator: BigInt(allowance), denominator: 100n })));
}

export function handicapStrokesForHole(handicap: number, allocation: number, count: number): number {
  const quotient = Math.floor(handicap / count);
  const remainder = handicap - quotient * count;
  return quotient + (allocation <= remainder ? 1 : 0);
}

export function stablefordScorePoints(table: StablefordPointsTable, scoreToPar: number): number {
  const first = table.rows[0];
  if (!first || scoreToPar < first.scoreToPar) return table.betterScorePoints;
  return table.rows.find((row) => row.scoreToPar === scoreToPar)?.points ?? table.worseScorePoints;
}

function unavailable(
  player: RoundPlayerSnapshot, holes: readonly CourseHole[], reason: GameUnavailableReason,
): GamePlayerResult {
  return {
    playerId: player.playerId, displayName: player.displayName, playingHandicap: null,
    status: 'unavailable', unavailableReason: reason,
    holes: holes.map((hole) => ({ number: hole.number, points: null, strokesReceived: null })),
    holesScored: 0, totalHoles: holes.length, frontPoints: null, backPoints: null, totalPoints: null,
  };
}

function sumPoints(holes: GamePlayerResult['holes']): number | null {
  const scored = holes.filter((hole) => hole.points !== null);
  return scored.length ? scored.reduce((sum, hole) => sum + (hole.points ?? 0), 0) : null;
}

function playerResult(
  game: StablefordGameDefinition, tee: TeeProfile, player: RoundPlayerSnapshot,
  cards: readonly Scorecard[],
): GamePlayerResult {
  const layout = [...tee.holes].sort((left, right) => left.number - right.number);
  const card = cards.find((candidate) => candidate.playerId === player.playerId);
  if (!card || layout.some((hole) => !card.holes.some((score) => score.number === hole.number))) {
    return unavailable(player, layout, 'missing-score-data');
  }
  let handicap: number | null = null;
  if (game.basis === 'net') {
    if (player.handicapIndex == null) return unavailable(player, layout, 'missing-handicap-index');
    const result = calculatePlayingHandicap(player.handicapIndex.value, tee, game.handicapAllowancePercent);
    if (typeof result === 'string') return unavailable(player, layout, result);
    handicap = result;
  }
  const minimum = Math.min(game.points.betterScorePoints, game.points.worseScorePoints,
    ...game.points.rows.map((row) => row.points));
  const holes = layout.map((hole) => {
    const score = card.holes.find((candidate) => candidate.number === hole.number)?.score;
    const strokesReceived = handicap === null ? 0 : handicapStrokesForHole(handicap, hole.allocation, layout.length);
    const points = !score || score.kind === 'unplayed' ? null
      : score.kind === 'strokes' ? stablefordScorePoints(game.points, score.strokes - strokesReceived - hole.par) : minimum;
    return { number: hole.number, points, strokesReceived };
  });
  const holesScored = holes.filter((hole) => hole.points !== null).length;
  return {
    playerId: player.playerId, displayName: player.displayName, playingHandicap: handicap,
    status: holesScored === holes.length ? 'complete' : 'in-progress',
    holes, holesScored, totalHoles: holes.length,
    frontPoints: sumPoints(holes.filter((hole) => hole.number <= 9)),
    backPoints: sumPoints(holes.filter((hole) => hole.number > 9)),
    totalPoints: sumPoints(holes),
  };
}

export function calculateGameResults(
  games: readonly RoundGameDefinition[], round: RoundSnapshot, cards: readonly Scorecard[],
): readonly RoundGameResult[] {
  const layout = [...round.teeProfile.holes].sort((left, right) => left.number - right.number);
  return games.map((game) => {
    if (!isStablefordGame(game)) return calculateStrokeGameResults(game, round.players.map((player) => {
      const tee = playerTee(round, player.playerId);
      return { playerId: player.playerId, displayName: player.displayName, layout: tee.holes,
        handicap: game.basis === 'gross' ? null : player.handicapIndex == null ? 'missing-handicap-index'
          : calculatePlayingHandicap(player.handicapIndex.value, tee, 100) };
    }), cards);
    const players = round.players.map((player) => playerResult(game, playerTee(round, player.playerId), player, cards));
    return {
      gameId: game.id, players,
      ...(isTeamGameDefinition(game)
        ? gameTeamsMatchRoster(game, round.players.map((player) => player.playerId))
          ? { teams: aggregateTeamGameResults(game, players, layout.map((hole) => hole.number)) }
          : { teams: [], teamSetupRequired: true as const }
        : {}),
    };
  });
}
