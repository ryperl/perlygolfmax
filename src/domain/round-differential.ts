import type { TeeProfile } from './catalog.js';
import { handicapStrokesForHole } from './handicap-strokes.js';
import { maximumExactHoleStrokes } from './scoring.js';
import type { Scorecard } from './scoring.js';
import type { RoundPlayerSnapshot, RoundSnapshot } from './setup.js';
import { calculateCourseHandicap } from './stableford.js';
import { compatibleTeeLayouts, hasStrokeAllocation, playerTee } from './tees.js';

export type RoundDifferentialUnavailableReason =
  | 'unsupported-hole-count'
  | 'invalid-tee-layout'
  | 'missing-tee-ratings'
  | 'uncaptured-handicap-index'
  | 'missing-handicap-index'
  | 'invalid-handicap-index'
  | 'missing-stroke-index'
  | 'non-numeric-score'
  | 'invalid-score-data'
  | 'arithmetic-range';

interface DifferentialMethod {
  readonly playerId: string;
  readonly method: 'estimated-18-hole';
  readonly pcc: 0;
}

/** Public result only: never includes captured observations, audit actors or scoring inputs. */
export type RoundDifferential = DifferentialMethod & (
  | {
    readonly status: 'available';
    readonly differentialTenths: number;
    readonly adjustedGross: number;
  }
  | {
    readonly status: 'pending';
    readonly differentialTenths: null;
    readonly adjustedGross: null;
    readonly reason: 'incomplete-card';
  }
  | {
    readonly status: 'unavailable';
    readonly differentialTenths: null;
    readonly adjustedGross: null;
    readonly reason: RoundDifferentialUnavailableReason;
  }
);

function unavailable(playerId: string, reason: RoundDifferentialUnavailableReason): RoundDifferential {
  return { playerId, method: 'estimated-18-hole', pcc: 0, status: 'unavailable',
    differentialTenths: null, adjustedGross: null, reason };
}

function pending(playerId: string): RoundDifferential {
  return { playerId, method: 'estimated-18-hole', pcc: 0, status: 'pending',
    differentialTenths: null, adjustedGross: null, reason: 'incomplete-card' };
}

function validLayout(tee: TeeProfile): boolean {
  return tee.holes.length === 18
    && new Set(tee.holes.map((hole) => hole.number)).size === 18
    && tee.holes.every((hole) => Number.isSafeInteger(hole.number) && hole.number >= 1 && hole.number <= 18
      && Number.isSafeInteger(hole.par) && hole.par >= 1 && hole.par <= 10);
}

function decimal(value: number): { readonly numerator: bigint; readonly denominator: bigint } {
  const [mantissa = '', exponent = '0'] = String(value).split('e');
  const [whole = '', fractional = ''] = mantissa.split('.');
  const scale = fractional.length - Number(exponent);
  const numerator = BigInt(`${whole}${fractional}`);
  return scale >= 0 ? { numerator, denominator: 10n ** BigInt(scale) }
    : { numerator: numerator * 10n ** BigInt(-scale), denominator: 1n };
}

/**
 * USGA 5.1a: (113 / slope) * (adjusted gross - rating - PCC), nearest tenth.
 * 5.1c: -1.54 -> -1.5, -1.55 -> -1.5, -1.56 -> -1.6.
 * Exact decimal rational arithmetic avoids binary half-tie and negative-zero errors.
 * https://rulesworkshops.usga.org/content/usga/home-page/handicapping/roh/Content/rules/5%201c%20Calculation%20of%20a%20Score%20DifferentialRoundingMinus.htm
 */
function differentialTenths(adjustedGross: bigint, course: number, slope: number): number | null {
  const rating = decimal(course);
  const numerator = 1130n * (adjustedGross * rating.denominator - rating.numerator);
  const denominator = BigInt(slope) * rating.denominator;
  const shifted = 2n * numerator + denominator;
  const divisor = 2n * denominator;
  const truncated = shifted / divisor;
  const rounded = shifted < 0n && shifted % divisor !== 0n ? truncated - 1n : truncated;
  return rounded > BigInt(Number.MAX_SAFE_INTEGER) || rounded < -BigInt(Number.MAX_SAFE_INTEGER)
    ? null : Number(rounded);
}

function playerDifferential(
  snapshot: RoundSnapshot, player: RoundPlayerSnapshot, cards: readonly Scorecard[],
): RoundDifferential {
  const id = player.playerId;
  const tee = playerTee(snapshot, id);
  if (snapshot.teeProfile.holeCount !== 18 || tee.holeCount !== 18) return unavailable(id, 'unsupported-hole-count');
  if (!validLayout(snapshot.teeProfile) || !validLayout(tee)
    || !compatibleTeeLayouts(snapshot.teeProfile, tee)
    || (snapshot.playerTees?.filter((entry) => entry.playerId === id).length ?? 0) > 1) {
    return unavailable(id, 'invalid-tee-layout');
  }
  const matches = cards.filter((card) => card.playerId === id);
  if (matches.length > 1) return unavailable(id, 'invalid-score-data');
  const card = matches[0];
  if (!card) return pending(id);
  const scores = new Map(card.holes.map((hole) => [hole.number, hole.score]));
  if (scores.size !== card.holes.length || card.holes.some((hole) =>
    !Number.isSafeInteger(hole.number) || hole.number < 1 || hole.number > 18)) {
    return unavailable(id, 'invalid-score-data');
  }
  if (card.holes.some((hole) => hole.score.kind === 'picked-up' || hole.score.kind === 'did-not-finish')) {
    return unavailable(id, 'non-numeric-score');
  }
  if (card.holes.some((hole) => hole.score.kind === 'strokes'
    && (!Number.isSafeInteger(hole.score.strokes) || hole.score.strokes < 1
      || hole.score.strokes > maximumExactHoleStrokes))) return unavailable(id, 'arithmetic-range');
  if (tee.holes.some((hole) => !scores.has(hole.number) || scores.get(hole.number)?.kind === 'unplayed')) return pending(id);

  const ratings = tee.ratings.filter((rating) => rating.type === 'Total');
  const rating = ratings[0];
  if (ratings.length !== 1 || !rating || !Number.isFinite(rating.course) || rating.course <= 0 || rating.course > 150
    || !Number.isSafeInteger(rating.slope) || rating.slope <= 0 || rating.slope > 300) {
    return unavailable(id, 'missing-tee-ratings');
  }
  const index = player.handicapIndex === undefined ? player.handicapIndexValue : player.handicapIndex?.value ?? null;
  if (index === undefined) return unavailable(id, 'uncaptured-handicap-index');
  if (index === null) return unavailable(id, 'missing-handicap-index');
  const handicap = calculateCourseHandicap(index, tee);
  if (typeof handicap === 'string') return unavailable(id, handicap);
  if (!Number.isSafeInteger(handicap)) return unavailable(id, 'arithmetic-range');
  if (!hasStrokeAllocation(tee)) return unavailable(id, 'missing-stroke-index');

  let adjustedGross = 0n;
  for (const hole of tee.holes) {
    const score = scores.get(hole.number);
    if (score?.kind !== 'strokes') return unavailable(id, 'invalid-score-data');
    const received = handicapStrokesForHole(handicap, hole.allocation, 18);
    // USGA 3.1b uses unrestricted CH, not a game's Playing Handicap. Above CH 54,
    // four or more received strokes still cap at par + 5. Plus CH gives strokes back.
    // https://rulesworkshops.usga.org/content/usga/home-page/handicapping/roh/Content/rules/3%201b%20After%20a%20Handicap%20Index%20Has%20Been%20Established.htm
    const cap = hole.par + 2 + (handicap > 54 && received >= 4 ? 3 : received);
    if (!Number.isSafeInteger(cap) || cap < 1) return unavailable(id, 'arithmetic-range');
    adjustedGross += BigInt(Math.min(score.strokes, cap));
  }
  const tenths = differentialTenths(adjustedGross, rating.course, rating.slope);
  if (adjustedGross > BigInt(Number.MAX_SAFE_INTEGER) || tenths === null) return unavailable(id, 'arithmetic-range');
  return { playerId: id, method: 'estimated-18-hole', pcc: 0, status: 'available',
    adjustedGross: Number(adjustedGross), differentialTenths: tenths };
}

/**
 * Server-side estimate from saved numeric cards and captured round inputs only.
 * PCC is explicitly assumed zero; this does not post a score or update an Index.
 * Nine-hole expected-score components and official incomplete-round substitutions
 * are deliberately unsupported. Missing holes stay pending; pickups/DNF are not numbers.
 * https://rulesworkshops.usga.org/content/usga/home-page/handicapping/roh/Content/rules/5%201a%20Calculation%20of%20a%20Score%20Differential18Hole.htm
 * https://rulesworkshops.usga.org/content/usga/home-page/handicapping/world-handicap-system/2024-revision/2024-treatment-of-9-hole-scores-FAQ.html
 */
export function calculateRoundDifferentials(
  snapshot: RoundSnapshot, cards: readonly Scorecard[],
): readonly RoundDifferential[] {
  return snapshot.players.map((player) => playerDifferential(snapshot, player, cards));
}
