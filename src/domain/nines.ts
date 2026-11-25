/**
 * Nines (the 9-point game) for a saved playing group of exactly three golfers.
 *
 * Every hole awards 9 points: 5 for the best score, 3 for second and 1 for the worst. Golfers who
 * tie share the points of the places they occupy, so a hole always totals 9 (4/4/1, 5/2/2, 3/3/3).
 * A pickup, X7 or DNF ranks below every numeric score. A hole scores only once all three golfers
 * have saved a disposition for it.
 */
import type { CourseHole } from './catalog.js';
import type { RoundGameScoringContext } from './game-declarations.js';
import type { CapturedGameHandicap, GameHandicapSettings } from './game-handicaps.js';
import { gameHandicap } from './game-handicaps.js';
import type { GamePlayerResult, GameScoreBasis, GameUnavailableReason, RoundGameResult } from './games.js';
import { calculateDotSettlement } from './dot-settlement.js';
import type { InternalGameSettlement } from './dot-settlement.js';
import { handicapStrokesForHole } from './handicap-strokes.js';
import type { HoleScore, Scorecard } from './scoring.js';
import type { RoundGroup } from './setup.js';
import { hasStrokeAllocation } from './tees.js';

export const ninesPlayerCount = 3;

/** Points for 1st, 2nd and 3rd place on a hole. */
const placePoints = [5, 3, 1] as const;

export interface NinesGameDefinition extends GameHandicapSettings {
  readonly id: string;
  readonly name: string;
  readonly kind: 'nines';
  readonly version: 1;
  readonly basis: GameScoreBasis;
  readonly groupNumber: number;
  /** The saved group's three golfers. */
  readonly playerIds: readonly string[];
  /** Exact US cents per point; null or 0 plays for points only. */
  readonly stakeMinor: number | null;
  readonly format?: never;
  readonly teams?: never;
  readonly preset?: never;
  readonly points?: never;
  readonly handicapAllowancePercent?: never;
}

export interface NinesHolePoints {
  readonly playerId: string;
  readonly points: number;
}

export interface NinesHole {
  readonly number: number;
  readonly status: 'complete' | 'pending' | 'unavailable';
  /** One entry per golfer once the hole is complete; empty otherwise. */
  readonly points: readonly NinesHolePoints[];
}

export interface NinesResults {
  readonly version: 1;
  readonly groupNumber: number;
  /** `stale-group` means the saved group no longer matches the game's three golfers. */
  readonly status: 'ready' | 'stale-group';
  readonly holes: readonly NinesHole[];
}

export interface NinesPlayer {
  readonly playerId: string;
  readonly displayName: string;
  /** The golfer's personal (or default) tee layout. */
  readonly layout: readonly CourseHole[];
  /** Game handicap for net play; null for gross; a reason when it cannot be known. */
  readonly handicap: number | null | GameUnavailableReason;
}

/** The parts of a golfer's tee that Nines needs. */
export interface NinesTee {
  readonly holes: readonly CourseHole[];
  readonly strokeAllocation: boolean;
}

/** How one golfer's hole compares: a score to rank, a pickup that ranks last, or not known yet. */
type HoleOutcome =
  | { readonly kind: 'score'; readonly value: number }
  | { readonly kind: 'worst' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'unavailable' };

interface RankedEntry {
  readonly playerId: string;
  /** Lower is better; null means a pickup/X7/DNF, which ranks below every score. */
  readonly value: number | null;
}

function ranksBefore(left: RankedEntry, right: RankedEntry): number {
  if (left.value === null && right.value === null) return 0;
  if (left.value === null) return 1;
  if (right.value === null) return -1;
  return left.value - right.value;
}

/**
 * Shares the 5/3/1 place points between three golfers. Tied golfers split the points of every place
 * they occupy equally, which is always a whole number for three golfers.
 */
export function pointsForPlaces(entries: readonly RankedEntry[]): readonly NinesHolePoints[] {
  if (entries.length !== ninesPlayerCount) throw new Error('Nines ranks exactly three golfers.');
  const ordered = [...entries].sort(ranksBefore);
  const awarded: NinesHolePoints[] = [];
  let place = 0;
  while (place < ordered.length) {
    const first = ordered[place];
    if (!first) break;
    const tied = ordered.filter((entry, index) => index >= place && ranksBefore(entry, first) === 0);
    const shared = placePoints.slice(place, place + tied.length).reduce((sum, points) => sum + points, 0);
    for (const entry of tied) awarded.push({ playerId: entry.playerId, points: shared / tied.length });
    place += tied.length;
  }
  return entries.map((entry) => awarded.find((award) => award.playerId === entry.playerId) ?? { playerId: entry.playerId, points: 0 });
}

function holeOutcome(score: HoleScore | undefined, hole: CourseHole | undefined, handicap: number | null,
  basis: GameScoreBasis, layoutLength: number): HoleOutcome {
  if (!hole) return { kind: 'unavailable' };
  if (!score || score.kind === 'unplayed') return { kind: 'pending' };
  if (score.kind !== 'strokes') return { kind: 'worst' };
  if (basis === 'gross') return { kind: 'score', value: score.strokes };
  if (handicap === null) return { kind: 'unavailable' };
  const received = handicapStrokesForHole(handicap, hole.allocation, layoutLength);
  return { kind: 'score', value: score.strokes - received };
}

function scoreHole(number: number, outcomes: readonly { playerId: string; outcome: HoleOutcome }[]): NinesHole {
  if (outcomes.some((entry) => entry.outcome.kind === 'unavailable')) return { number, status: 'unavailable', points: [] };
  if (outcomes.some((entry) => entry.outcome.kind === 'pending')) return { number, status: 'pending', points: [] };
  const ranked = outcomes.map((entry): RankedEntry => ({
    playerId: entry.playerId,
    value: entry.outcome.kind === 'score' ? entry.outcome.value : null,
  }));
  return { number, status: 'complete', points: pointsForPlaces(ranked) };
}

/** True when two Nines definitions are identical in every setting that affects scoring or money. */
export function sameNinesDefinition(left: NinesGameDefinition, right: NinesGameDefinition): boolean {
  const samePlayers = left.playerIds.length === right.playerIds.length
    && left.playerIds.every((id, index) => id === right.playerIds[index]);
  return left.id === right.id && left.name === right.name
    && left.basis === right.basis && left.handicapRule === right.handicapRule
    && left.groupNumber === right.groupNumber && left.stakeMinor === right.stakeMinor && samePlayers;
}

/** True when the saved group still holds exactly the game's three golfers. */
export function ninesGroupMatches(game: NinesGameDefinition, groups: readonly RoundGroup[]): boolean {
  const group = groups.find((entry) => entry.number === game.groupNumber);
  if (!group || group.playerIds.length !== ninesPlayerCount || game.playerIds.length !== ninesPlayerCount) return false;
  return new Set(game.playerIds).size === ninesPlayerCount && group.playerIds.every((id) => game.playerIds.includes(id));
}

function sumPoints(holes: readonly { readonly points: number | null }[]): number | null {
  const scored = holes.filter((hole) => hole.points !== null);
  if (!scored.length) return null;
  return scored.reduce((sum, hole) => sum + (hole.points ?? 0), 0);
}

function playerResult(player: NinesPlayer, holes: readonly NinesHole[], reason: GameUnavailableReason | undefined,
  handicap: number | null): GamePlayerResult {
  const holeResults = holes.map((hole) => {
    const tee = player.layout.find((entry) => entry.number === hole.number);
    const strokesReceived = handicap !== null && tee ? handicapStrokesForHole(handicap, tee.allocation, player.layout.length) : null;
    const points = hole.points.find((entry) => entry.playerId === player.playerId)?.points ?? null;
    return { number: hole.number, points, strokesReceived };
  });
  const holesScored = holes.filter((hole) => hole.status === 'complete').length;
  let status: GamePlayerResult['status'] = 'in-progress';
  if (reason || holes.some((hole) => hole.status === 'unavailable')) status = 'unavailable';
  else if (holesScored === holes.length) status = 'complete';
  return {
    playerId: player.playerId, displayName: player.displayName, playingHandicap: reason ? null : handicap,
    status, ...(reason ? { unavailableReason: reason } : {}),
    holes: holeResults, holesScored, totalHoles: holes.length,
    frontPoints: sumPoints(holeResults.filter((hole) => hole.number <= 9)),
    backPoints: sumPoints(holeResults.filter((hole) => hole.number > 9)),
    totalPoints: sumPoints(holeResults),
  };
}

/** Calculates a Nines game from saved scorecards. Never reads drafts or rewrites scores. */
export function calculateNines(game: NinesGameDefinition, players: readonly NinesPlayer[], cards: readonly Scorecard[],
  groups: readonly RoundGroup[]): RoundGameResult {
  const golfers = game.playerIds.flatMap((id) => players.filter((player) => player.playerId === id));
  const ready = ninesGroupMatches(game, groups) && golfers.length === ninesPlayerCount;
  const numbers = [...(golfers[0]?.layout ?? [])].map((hole) => hole.number).sort((left, right) => left - right);
  const prepared = golfers.map((player) => {
    const card = cards.find((entry) => entry.playerId === player.playerId);
    let reason: GameUnavailableReason | undefined;
    if (typeof player.handicap === 'string') reason = player.handicap;
    else if (!card) reason = 'missing-score-data';
    const handicap = typeof player.handicap === 'number' ? player.handicap : null;
    return { player, card, reason, handicap };
  });
  const holes = numbers.map((number) => {
    if (!ready) return { number, status: 'unavailable' as const, points: [] };
    return scoreHole(number, prepared.map(({ player, card, reason, handicap }) => {
      if (reason) return { playerId: player.playerId, outcome: { kind: 'unavailable' as const } };
      const score = card?.holes.find((entry) => entry.number === number)?.score;
      const hole = player.layout.find((entry) => entry.number === number);
      return { playerId: player.playerId, outcome: holeOutcome(score, hole, handicap, game.basis, player.layout.length) };
    }));
  });
  const nines: NinesResults = { version: 1, groupNumber: game.groupNumber, status: ready ? 'ready' : 'stale-group', holes };
  return {
    gameId: game.id, kind: 'nines', version: 1, nines,
    players: prepared.map(({ player, reason, handicap }) => playerResult(player, holes, reason, handicap)),
  };
}

/** The game handicap for one golfer: none for gross, otherwise the shared full-CH or strokes-off rule. */
export function ninesHandicap(game: NinesGameDefinition, playerId: string, tee: NinesTee,
  captured: readonly CapturedGameHandicap[], groups: readonly RoundGroup[]): NinesPlayer['handicap'] {
  if (game.basis === 'gross') return null;
  if (!hasStrokeAllocation(tee)) return 'missing-stroke-index';
  return gameHandicap(game.handicapRule ?? 'full-course-v1', playerId, captured, groups);
}

/**
 * Recalculates Nines from a published round, so the browser can confirm the server's result
 * exactly. Display names come from the server's own result, because catalog renames are resolved
 * there and are not a scoring input.
 */
export function calculateNinesFromScores(game: NinesGameDefinition, round: RoundGameScoringContext,
  displayNames: ReadonlyMap<string, string> = new Map()): RoundGameResult {
  const captured = (round.courseHandicaps ?? []).map((entry): CapturedGameHandicap => ({
    playerId: entry.playerId, handicap: entry.courseHandicap ?? entry.unavailableReason ?? null,
  }));
  const players = round.cards.map((card): NinesPlayer => {
    const personal = round.playerTees?.find((entry) => entry.playerId === card.playerId)?.profile;
    const tee: NinesTee = personal ?? { holes: round.layout, strokeAllocation: round.teeStrokeAllocation === true };
    return {
      playerId: card.playerId, displayName: displayNames.get(card.playerId) ?? card.displayName, layout: tee.holes,
      handicap: ninesHandicap(game, card.playerId, tee, captured, round.groups),
    };
  });
  return calculateNines(game, players, round.cards, round.groups);
}

/**
 * Settles a Nines stake once for the group, with the shared exact-cents formula
 * `(3 * points - total points) * stake`. Blank or zero stake plays for points only.
 */
export function calculateNinesSettlement(game: NinesGameDefinition, result: RoundGameResult | undefined,
  displayName: (playerId: string) => string): InternalGameSettlement {
  const players = game.playerIds.map((playerId) => ({
    playerId,
    displayName: displayName(playerId),
    baseDots: result?.players.find((player) => player.playerId === playerId)?.totalPoints ?? null,
    specialDots: 0,
  }));
  const unavailable = !result || result.nines?.status !== 'ready'
    || result.players.some((player) => player.status === 'unavailable');
  const complete = !unavailable && result.players.every((player) => player.status === 'complete');
  return calculateDotSettlement({ groupNumber: game.groupNumber, gameIds: [game.id], stakeMinor: game.stakeMinor,
    complete, unavailable, players });
}
