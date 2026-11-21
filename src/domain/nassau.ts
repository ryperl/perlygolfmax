import type { PlayerCourseHandicap, Scorecard } from './scoring.js';
import type { TeeProfile } from './catalog.js';
import type { RoundSnapshot } from './setup.js';
import { publishedCourseHandicaps } from './playing-handicaps.js';
import { handicapStrokesForHole } from './stableford.js';
import { compatibleTeeLayouts, hasStrokeAllocation } from './tees.js';
import { gameHandicap } from './game-handicaps.js';
import type { GameHandicapSettings } from './game-handicaps.js';

export type NassauVariant = 'singles' | 'three-way' | 'one-v-two' | 'two-v-two-best-ball' | 'two-v-two-aggregate';
export type NassauSideKey = 'a' | 'b';
export type NassauSegment = 'front' | 'back' | 'overall';
export type NassauOutcome = 'scores' | 'side-a' | 'side-b' | 'halved';

export interface NassauSide {
  readonly id: string;
  readonly name: string;
  readonly playerIds: readonly string[];
}

interface MatchGameDefinition extends GameHandicapSettings {
  readonly playOrder?: 'shared-group-v1';
  readonly id: string;
  readonly name: string;
  readonly kind: 'nassau' | 'match-play';
  readonly version: 1;
  readonly basis: 'gross' | 'net';
  readonly groupNumber: number;
  readonly variant: NassauVariant;
  readonly sides: readonly NassauSide[];
  readonly stakes: {
    readonly frontMinor: number;
    readonly backMinor: number;
    readonly overallMinor: number;
    readonly currency: 'USD';
  };
  readonly automaticPresses: boolean;
  readonly format?: never;
  readonly teams?: never;
  readonly preset?: never;
  readonly points?: never;
  readonly handicapAllowancePercent?: never;
}

export interface NassauGameDefinition extends MatchGameDefinition {
  readonly kind: 'nassau';
}

export interface MatchPlayGameDefinition extends MatchGameDefinition {
  readonly kind: 'match-play';
}

export type PressMatchGameDefinition = NassauGameDefinition | MatchPlayGameDefinition;

export interface NassauManualPress {
  readonly id: string;
  readonly parentBetId: string;
  readonly matchId: string;
  readonly startHole: number;
  readonly declaredAfterHole: number;
  readonly pressingSide: NassauSideKey;
  readonly proof: string;
}

export interface NassauHoleRecord {
  /** Press declarations live on their starting hole's canonical card. */
  readonly number: number;
  readonly gameId: string;
  readonly gameEtag: string;
  readonly outcomes: readonly { readonly matchId: string; readonly outcome: NassauOutcome }[];
  readonly presses: readonly NassauManualPress[];
}

/** Public projections may supply full captured CH without reconstructing private HI observations. */
export interface NassauHandicapInputs {
  readonly courseHandicaps: readonly PlayerCourseHandicap[];
}

export interface NassauRoundContext {
  readonly id: string;
  readonly inputRevision?: string;
  readonly courseVersionId: string;
  readonly teeProfile: Pick<TeeProfile, 'id' | 'holeCount' | 'holes' | 'strokeAllocation'>;
  readonly playerTees?: readonly {
    readonly playerId: string;
    readonly profile: NassauRoundContext['teeProfile'];
  }[];
  readonly groups: RoundSnapshot['groups'];
  readonly players: readonly { readonly playerId: string; readonly displayName: string }[];
}

export interface NassauHoleResult {
  readonly number: number;
  readonly status: 'complete' | 'pending' | 'unavailable';
  readonly outcome: Exclude<NassauOutcome, 'scores'> | null;
  readonly source: 'scores' | 'override';
  readonly sideAScore: number | null;
  readonly sideBScore: number | null;
}

export interface NassauPlayerSettlement {
  readonly playerId: string;
  readonly netMinor: number | null;
  readonly paysMinor: number | null;
  readonly collectsMinor: number | null;
}

export interface NassauBetSettlement {
  readonly status: 'complete' | 'pending' | 'unavailable';
  readonly players: readonly NassauPlayerSettlement[];
  readonly unallocatedMinor: number | null;
}

export interface NassauBetResult {
  readonly id: string;
  readonly matchId: string;
  readonly segment: NassauSegment;
  readonly origin: 'primary' | 'automatic' | 'manual';
  readonly parentBetId: string | null;
  readonly manualPress: NassauManualPress | null;
  readonly startHole: number;
  readonly endHole: number;
  readonly stakeMinor: number | null;
  /** Positive means side A leads; this includes known holes beyond a pending gap. */
  readonly currentPosition: number | null;
  readonly holesResolved: number;
  readonly remainingHoles: number;
  readonly status: 'won' | 'push' | 'pending' | 'unavailable' | 'stale';
  readonly winner: NassauSideKey | null;
  readonly settlement: NassauBetSettlement;
}

export interface NassauPressOption {
  readonly parentBetId: string;
  readonly matchId: string;
  readonly startHole: number;
  readonly declaredAfterHole: number;
  readonly pressingSide: NassauSideKey;
  readonly proof: string;
}

export interface NassauMatchResult {
  readonly id: string;
  readonly sideA: NassauSide;
  readonly sideB: NassauSide;
  readonly holes: readonly NassauHoleResult[];
  readonly bets: readonly NassauBetResult[];
}

export interface NassauIssue {
  readonly code: 'invalid-definition' | 'invalid-layout' | 'invalid-group' | 'invalid-record'
    | 'unknown-match' | 'stale-press' | 'arithmetic-range';
  readonly number?: number;
  readonly pressId?: string;
}

export interface NassauResults {
  readonly gameId: string;
  readonly kind: 'nassau' | 'match-play';
  readonly version: 1;
  readonly status: 'complete' | 'in-progress' | 'unavailable';
  readonly matches: readonly NassauMatchResult[];
  /** Invalid/orphaned declarations stay visible even when their match no longer exists. */
  readonly stalePresses: readonly NassauManualPress[];
  readonly pressOptions: readonly NassauPressOption[];
  readonly issues: readonly NassauIssue[];
  readonly settlement: {
    readonly currency: 'USD';
    readonly status: 'complete' | 'partial' | 'pending' | 'unavailable';
    readonly resolvedBetCount: number;
    readonly pendingBetCount: number;
    readonly players: readonly NassauPlayerSettlement[];
    readonly unallocatedMinor: number | null;
  };
}

export type NassauPressValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: 'duplicate-id' | 'ineligible-or-stale' };

const segments: readonly { readonly segment: NassauSegment; readonly start: number; readonly end: number }[] = [
  { segment: 'front', start: 1, end: 9 }, { segment: 'back', start: 10, end: 18 },
  { segment: 'overall', start: 1, end: 18 },
];

export function nassauMatchId(gameId: string, sideAIndex: number, sideBIndex: number): string {
  return `${gameId}:match:${String(sideAIndex)}:${String(sideBIndex)}`;
}

export function nassauManualBetId(gameId: string, pressId: string): string {
  return `${gameId}:manual:${pressId}`;
}

function selectedTee(round: NassauRoundContext, playerId: string): NassauRoundContext['teeProfile'] {
  return round.playerTees?.find((entry) => entry.playerId === playerId)?.profile ?? round.teeProfile;
}

export function nassauConfigurationIssues(game: PressMatchGameDefinition, round: NassauRoundContext): readonly NassauIssue[] {
  const issues: NassauIssue[] = [];
  const sizes = game.sides.map((side) => side.playerIds.length).sort((a, b) => a - b).join(',');
  const expected = game.variant === 'singles' ? '1,1' : game.variant === 'three-way' ? '1,1,1'
    : game.variant === 'one-v-two' ? '1,2' : '2,2';
  const ids = game.sides.flatMap((side) => side.playerIds);
  if (sizes !== expected
    || !['gross', 'net'].includes(game.basis) || typeof game.automaticPresses !== 'boolean'
    || new Set(ids).size !== ids.length || new Set(game.sides.map((side) => side.id)).size !== game.sides.length
    || ![game.stakes.frontMinor, game.stakes.backMinor, game.stakes.overallMinor]
      .every((amount) => Number.isSafeInteger(amount) && amount >= 0)) issues.push({ code: 'invalid-definition' });
  const group = round.groups.filter((entry) => entry.number === game.groupNumber);
  if (!Number.isSafeInteger(game.groupNumber) || game.groupNumber < 1 || group.length !== 1
    || ids.some((id) => !group[0]?.playerIds.includes(id) || round.players.filter((p) => p.playerId === id).length !== 1)) {
    issues.push({ code: 'invalid-group' });
  }
  const tee = round.teeProfile;
  const count = tee.holes.length;
  const start = group[0]?.startingHole ?? tee.holes[0]?.number;
  if ((game.kind === 'nassau' ? count !== 18 : count !== 9 && count !== 18)
    || tee.holeCount !== count || new Set(tee.holes.map((hole) => hole.number)).size !== count
    || tee.holes.some((hole) => !Number.isInteger(hole.number) || hole.number < 1 || hole.number > 18)
    || count === 9 && !tee.holes.every((hole) => hole.number <= 9) && !tee.holes.every((hole) => hole.number >= 10)
    || (game.kind === 'match-play' || game.playOrder !== undefined) && !tee.holes.some((hole) => hole.number === start)
    || ids.some((id) => !compatibleTeeLayouts(tee, selectedTee(round, id))
      || (round.playerTees?.filter((entry) => entry.playerId === id).length ?? 0) > 1)) issues.push({ code: 'invalid-layout' });
  if (game.kind === 'match-play' && (game.stakes.frontMinor !== 0 || game.stakes.backMinor !== 0)) {
    issues.push({ code: 'invalid-definition' });
  }
  return issues;
}

function playingNumbers(game: PressMatchGameDefinition, round: NassauRoundContext): readonly number[] {
  const numbers = [...round.teeProfile.holes].sort((a, b) => a.number - b.number).map((hole) => hole.number);
  if (game.kind === 'nassau' && game.playOrder === undefined) return Array.from({ length: 18 }, (_, index) => index + 1);
  const start = round.groups.find((group) => group.number === game.groupNumber)?.startingHole ?? round.teeProfile.holes[0]?.number;
  const index = numbers.indexOf(start ?? 0);
  return index < 0 ? numbers : [...numbers.slice(index), ...numbers.slice(0, index)];
}

function exact(value: bigint): number | null {
  return value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER) ? null : Number(value);
}

function playerSettlement(playerId: string, amount: number | null): NassauPlayerSettlement {
  return { playerId, netMinor: amount, paysMinor: amount === null ? null : Math.max(0, -amount),
    collectsMinor: amount === null ? null : Math.max(0, amount) };
}

function settleBet(
  sides: readonly NassauSide[], stake: number | null, winner: NassauSideKey | null,
  status: NassauBetResult['status'],
): NassauBetSettlement {
  const ids = sides.flatMap((side) => side.playerIds);
  const unavailable = status === 'unavailable' || status === 'stale' || stake === null;
  if (unavailable || status === 'pending') return { status: unavailable ? 'unavailable' : 'pending',
    players: ids.map((id) => playerSettlement(id, null)), unallocatedMinor: null };
  if (status === 'push') return { status: 'complete', players: ids.map((id) => playerSettlement(id, 0)), unallocatedMinor: 0 };
  const [a, b] = sides;
  if (!a || !b || !a.playerIds.length || !b.playerIds.length) {
    return { status: 'unavailable', players: ids.map((id) => playerSettlement(id, null)), unallocatedMinor: null };
  }
  const gcd = (x: number, y: number): number => y === 0 ? x : gcd(y, x % y);
  const multiple = a.playerIds.length / gcd(a.playerIds.length, b.playerIds.length) * b.playerIds.length;
  const payable = BigInt(stake) / BigInt(multiple) * BigInt(multiple);
  return { status: 'complete', unallocatedMinor: Number(BigInt(stake) - payable),
    players: [a, b].flatMap((side, index) => side.playerIds.map((id) => playerSettlement(id,
      Number(payable / BigInt(side.playerIds.length)) * (winner === (index === 0 ? 'a' : 'b') ? 1 : -1)))) };
}

function holeResults(
  game: PressMatchGameDefinition, round: NassauRoundContext, cards: readonly Scorecard[],
  records: readonly NassauHoleRecord[], matchId: string, a: NassauSide, b: NassauSide, invalid: boolean,
  published: NassauHandicapInputs,
): readonly NassauHoleResult[] {
  const ids = [...a.playerIds, ...b.playerIds];
  const handicaps = published.courseHandicaps;
  const values = ids.map((id) => {
    const entries = handicaps.filter((entry) => entry.playerId === id);
    return entries.length === 1 && entries[0]?.unavailableReason === undefined ? entries[0]?.courseHandicap : null;
  });
  const netValid = values.every((value) => typeof value === 'number' && Number.isSafeInteger(value))
    && ids.every((id) => hasStrokeAllocation(selectedTee(round, id)));
  const lowest = netValid ? Math.min(...values.flatMap((value) => typeof value === 'number' ? [value] : [])) : null;
  const inputs = handicaps.map((entry) => ({ playerId: entry.playerId,
    handicap: entry.courseHandicap ?? entry.unavailableReason ?? null }));
  const relative = new Map(ids.map((id) => [id, game.handicapRule
    ? gameHandicap(game.handicapRule, id, inputs, round.groups)
    : (() => {
      const handicap = handicaps.find((entry) => entry.playerId === id)?.courseHandicap;
      return typeof handicap === 'number' && lowest !== null ? exact(BigInt(handicap) - BigInt(lowest)) : null;
    })()]));
  const relativeValid = netValid && [...relative.values()].every((value) => typeof value === 'number');
  return playingNumbers(game, round).map((number): NassauHoleResult => {
    const matching = records.filter((record) => record.number === number);
    const overrides = matching.flatMap((record) => record.outcomes.filter((entry) => entry.matchId === matchId));
    const base = { number, source: 'scores' as const, sideAScore: null, sideBScore: null };
    if (invalid || matching.length > 1 || overrides.length > 1) return { ...base, status: 'unavailable', outcome: null };
    const override = overrides[0]?.outcome;
    if (override && override !== 'scores') return { ...base, source: 'override', status: 'complete', outcome: override };
    const scores = ids.map((id) => {
      const selected = cards.filter((card) => card.playerId === id);
      const holes = selected[0]?.holes.filter((hole) => hole.number === number) ?? [];
      return { id, ambiguous: selected.length > 1 || holes.length > 1, score: holes[0]?.score };
    });
    if (scores.some((entry) => entry.ambiguous)) return { ...base, status: 'unavailable', outcome: null };
    if (scores.some((entry) => !entry.score || entry.score.kind === 'unplayed')) return { ...base, status: 'pending', outcome: null };
    if (scores.some(({ score }) => score?.kind === 'strokes' && (!Number.isSafeInteger(score.strokes) || score.strokes < 1))
      || game.basis === 'net' && !relativeValid) return { ...base, status: 'unavailable', outcome: null };
    const numeric = new Map(scores.map(({ id, score }) => {
      if (score?.kind !== 'strokes' || !Number.isSafeInteger(score.strokes) || score.strokes < 1) return [id, null];
      const tee = selectedTee(round, id);
      const handicap = relative.get(id);
      const allocation = tee.holes.find((hole) => hole.number === number)?.allocation;
      const received = game.basis === 'gross' ? 0 : typeof handicap === 'number' && allocation !== undefined
        ? handicapStrokesForHole(handicap, allocation, tee.holes.length) : null;
      return [id, received === null || !Number.isSafeInteger(received) ? null : exact(BigInt(score.strokes) - BigInt(received))];
    }));
    const sideScore = (side: NassauSide): number | null => {
      const balls = side.playerIds.map((id) => numeric.get(id) ?? null);
      if (game.variant === 'two-v-two-aggregate') return balls.some((ball) => ball === null) ? null
        : exact(balls.reduce<bigint>((sum, ball) => sum + BigInt(ball ?? 0), 0n));
      const eligible = balls.flatMap((ball) => ball === null ? [] : [ball]);
      return eligible.length ? Math.min(...eligible) : null;
    };
    const sideAScore = sideScore(a);
    const sideBScore = sideScore(b);
    if (sideAScore === null || sideBScore === null) return { ...base, sideAScore, sideBScore, status: 'unavailable', outcome: null };
    return { ...base, sideAScore, sideBScore, status: 'complete',
      outcome: sideAScore === sideBScore ? 'halved' : sideAScore < sideBScore ? 'side-a' : 'side-b' };
  });
}

function delta(hole: NassauHoleResult): number {
  return hole.outcome === 'side-a' ? 1 : hole.outcome === 'side-b' ? -1 : 0;
}

type BetInput = Pick<NassauBetResult,
  'id' | 'matchId' | 'segment' | 'origin' | 'parentBetId' | 'manualPress' | 'startHole' | 'endHole' | 'stakeMinor'>;

function betHoles(holes: readonly NassauHoleResult[], bet: Pick<BetInput, 'startHole' | 'endHole' | 'segment'>): readonly NassauHoleResult[] {
  const segment = holes.filter((hole) => bet.segment === 'front' ? hole.number <= 9 : bet.segment === 'back' ? hole.number > 9 : true);
  const first = segment.findIndex((hole) => hole.number === bet.startHole);
  const last = segment.findIndex((hole) => hole.number === bet.endHole);
  return first < 0 || last < first ? [] : segment.slice(first, last + 1);
}

function betResult(
  input: BetInput, holes: readonly NassauHoleResult[], sides: readonly NassauSide[], stale = false, blocked = false,
): NassauBetResult {
  const window = betHoles(holes, input);
  const known = window.filter((hole) => hole.status === 'complete');
  const remainingHoles = window.length - known.length;
  const lead = known.reduce((position, hole) => position + delta(hole), 0);
  const blockedInputs = blocked || input.stakeMinor === null || window.length === 0;
  const unavailable = blockedInputs || window.some((hole) => hole.status === 'unavailable') && Math.abs(lead) <= remainingHoles;
  const status = stale ? 'stale' : unavailable ? 'unavailable'
    : Math.abs(lead) > remainingHoles ? 'won' : remainingHoles === 0 ? 'push' : 'pending';
  const winner = status === 'won' ? lead > 0 ? 'a' : 'b' : null;
  return { ...input, currentPosition: stale || unavailable ? null : lead, holesResolved: known.length,
    remainingHoles, status, winner, settlement: settleBet(sides, input.stakeMinor, winner, status) };
}

function prefixAt(holes: readonly NassauHoleResult[], bet: NassauBetResult, after: number): number | null {
  const window = betHoles(holes, bet);
  const index = window.findIndex((hole) => hole.number === after);
  if (index < 0 || index === window.length - 1) return null;
  const prefix = window.slice(0, index + 1);
  return prefix.some((hole) => hole.status !== 'complete')
    ? null : prefix.reduce((position, hole) => position + delta(hole), 0);
}

function proofFor(
  game: PressMatchGameDefinition, round: NassauRoundContext, match: NassauMatchResult, bet: NassauBetResult, after: number, lead: number,
  published: NassauHandicapInputs,
): string {
  const publicHandicaps = published.courseHandicaps;
  const ids = [...match.sideA.playerIds, ...match.sideB.playerIds];
  // Lossless semantic receipt, not a credential/hash. No HI observations, actor IDs or shared config etags.
  const window = game.playOrder === 'shared-group-v1' ? betHoles(match.holes, bet) : match.holes;
  const next = window[window.findIndex((hole) => hole.number === after) + 1]?.number;
  const group = round.groups.find((entry) => entry.number === game.groupNumber);
  return `${game.kind === 'match-play' ? 'match-play-v1' : 'nassau-v1'}:${JSON.stringify([
    [game.id, game.basis, game.variant, game.groupNumber, game.sides.map((side) => [side.id, side.playerIds]),
      game.stakes.frontMinor, game.stakes.backMinor, game.stakes.overallMinor, game.automaticPresses],
    [round.id, round.inputRevision ?? null, round.courseVersionId, ids.map((id) => {
      const tee = selectedTee(round, id);
      const handicap = publicHandicaps.find((entry) => entry.playerId === id);
      return [id, handicap?.courseHandicap ?? null, handicap?.unavailableReason ?? null, tee.id,
        tee.strokeAllocation, [...tee.holes].sort((a, b) => a.number - b.number).map((hole) => [hole.number, hole.allocation])];
    })],
    [match.id, bet.id, bet.parentBetId, bet.startHole, bet.endHole, bet.stakeMinor, lead, next],
    betHoles(match.holes, { startHole: bet.startHole, endHole: after, segment: bet.segment })
      .map((hole) => [hole.number, hole.outcome, hole.source]),
    ...(game.handicapRule || game.playOrder ? [[game.handicapRule ?? null, game.playOrder ?? null,
      group?.startingHole ?? round.teeProfile.holes[0]?.number,
      game.handicapRule === 'group-low-v1' ? group?.playerIds.map((id) => {
        const handicap = publicHandicaps.find((entry) => entry.playerId === id);
        return [id, handicap?.courseHandicap ?? null, handicap?.unavailableReason ?? null];
      }) ?? [] : []]] : []),
  ])}`;
}

function optionAt(
  game: PressMatchGameDefinition, round: NassauRoundContext, match: NassauMatchResult, bet: NassauBetResult, after: number,
  published: NassauHandicapInputs,
): NassauPressOption | null {
  if (bet.status === 'stale' || bet.stakeMinor === null) return null;
  const lead = prefixAt(match.holes, bet, after);
  if (lead === null || Math.abs(lead) < 2) return null;
  const window = betHoles(match.holes, bet);
  const next = window[window.findIndex((hole) => hole.number === after) + 1]?.number;
  if (next === undefined) return null;
  return { parentBetId: bet.id, matchId: match.id, declaredAfterHole: after, startHole: next,
    pressingSide: lead > 0 ? 'b' : 'a', proof: proofFor(game, round, match, bet, after, lead, published) };
}

function sameOption(press: NassauManualPress, option: NassauPressOption | null): boolean {
  return option !== null && press.parentBetId === option.parentBetId && press.matchId === option.matchId
    && press.startHole === option.startHole && press.declaredAfterHole === option.declaredAfterHole
    && press.pressingSide === option.pressingSide && press.proof === option.proof;
}

export function calculateNassau(
  game: PressMatchGameDefinition, round: RoundSnapshot, cards: readonly Scorecard[], records: readonly NassauHoleRecord[] = [],
  published?: NassauHandicapInputs,
): NassauResults {
  return calculateNassauFromHandicaps(game, round, cards, records,
    published ?? { courseHandicaps: publishedCourseHandicaps(round) });
}

/** Recomputes public results from captured layouts and full CH, without private HI or fabricated tee metadata. */
export function calculateNassauFromHandicaps(
  game: PressMatchGameDefinition, round: NassauRoundContext, cards: readonly Scorecard[], records: readonly NassauHoleRecord[],
  published: NassauHandicapInputs,
): NassauResults {
  const issues: NassauIssue[] = [...nassauConfigurationIssues(game, round)];
  const invalidConfiguration = issues.length > 0;
  const ownRecords = records.filter((record) => record.gameId === game.id);
  const pairs = game.variant === 'three-way' ? [[0, 1], [0, 2], [1, 2]] : [[0, 1]];
  const matches: NassauMatchResult[] = pairs.flatMap(([ai, bi]) => {
    const a = ai === undefined ? undefined : game.sides[ai];
    const b = bi === undefined ? undefined : game.sides[bi];
    if (!a || !b || ai === undefined || bi === undefined) return [];
    const id = nassauMatchId(game.id, ai, bi);
    return [{ id, sideA: a, sideB: b, holes: holeResults(game, round, cards, ownRecords, id, a, b, invalidConfiguration, published), bets: [] }];
  });
  const matchIds = new Set(matches.map((match) => match.id));
  for (const record of ownRecords) {
    if (!Number.isInteger(record.number) || !round.teeProfile.holes.some((hole) => hole.number === record.number)
      || ownRecords.filter((entry) => entry.number === record.number).length !== 1
      || new Set(record.outcomes.map((entry) => entry.matchId)).size !== record.outcomes.length
      || record.outcomes.some((entry) => !['scores', 'side-a', 'side-b', 'halved'].includes(entry.outcome))) {
      issues.push({ code: 'invalid-record', number: record.number });
    }
    if (record.outcomes.some((entry) => !matchIds.has(entry.matchId))) issues.push({ code: 'unknown-match', number: record.number });
  }
  const manual = ownRecords.flatMap((record) => record.presses.map((press) => ({ press, number: record.number })));
  const stalePresses: NassauManualPress[] = [];
  const pressOptions: NassauPressOption[] = [];
  const allBets: NassauBetResult[] = [];
  const recordInvalid = issues.some((issue) => issue.code === 'invalid-record' || issue.code === 'unknown-match');
  for (const match of matches) {
    const bets: NassauBetResult[] = [];
    const sides = [match.sideA, match.sideB];
    const add = (input: BetInput, stale = false) => {
      let next: BetInput | null = input;
      while (next !== null) {
        const bet = betResult(next, match.holes, sides, stale, invalidConfiguration || recordInvalid);
        bets.push(bet);
        next = null;
        if (!game.automaticPresses || bet.status === 'stale' || invalidConfiguration || recordInvalid) continue;
        const window = betHoles(match.holes, bet);
        for (const [index, hole] of window.slice(0, -1).entries()) {
          const after = hole.number;
          const lead = prefixAt(match.holes, bet, after);
          if (lead === null) break;
          if (Math.abs(lead) >= 2) {
            const startHole = window[index + 1]?.number;
            if (startHole === undefined) break;
            next = { id: `${bet.id}:auto:${String(startHole)}`, matchId: match.id, segment: bet.segment,
              origin: 'automatic', parentBetId: bet.id, manualPress: null, startHole,
              endHole: bet.endHole, stakeMinor: bet.stakeMinor };
            break;
          }
        }
      }
    };
    const first = match.holes[0]?.number, last = match.holes.at(-1)?.number;
    const primary = game.kind === 'match-play'
      ? first === undefined || last === undefined ? [] : [{ segment: 'overall' as const, start: first, end: last }]
      : game.playOrder === 'shared-group-v1' ? segments.flatMap(({ segment }) => {
        const holes = match.holes.filter((hole) => segment === 'front' ? hole.number <= 9 : segment === 'back' ? hole.number > 9 : true);
        const start = holes[0]?.number, end = holes.at(-1)?.number;
        return start === undefined || end === undefined ? [] : [{ segment, start, end }];
      }) : segments;
    for (const { segment, start, end } of primary) add({
      id: `${match.id}:${segment}`, matchId: match.id, segment, origin: 'primary', parentBetId: null,
      manualPress: null, startHole: start, endHole: end,
      stakeMinor: segment === 'front' ? game.stakes.frontMinor : segment === 'back' ? game.stakes.backMinor : game.stakes.overallMinor,
    });
    for (const { press, number } of [...manual].sort((a, b) =>
      match.holes.findIndex((hole) => hole.number === a.press.startHole) - match.holes.findIndex((hole) => hole.number === b.press.startHole)
      || (a.press.id < b.press.id ? -1 : a.press.id > b.press.id ? 1 : 0))) {
      if (press.matchId !== match.id) continue;
      const parent = bets.find((bet) => bet.id === press.parentBetId);
      const valid = parent !== undefined && number === press.startHole
        && manual.filter((entry) => entry.press.id === press.id).length === 1
        && sameOption(press, optionAt(game, round, match, parent, press.declaredAfterHole, published));
      if (!valid) { stalePresses.push(press); issues.push({ code: 'stale-press', pressId: press.id }); }
      if (!parent) continue;
      add({ id: nassauManualBetId(game.id, press.id), matchId: match.id, segment: parent.segment, origin: 'manual',
        parentBetId: press.parentBetId, manualPress: press, startHole: press.startHole, endHole: parent.endHole,
        stakeMinor: parent.stakeMinor }, !valid);
    }
    for (const bet of bets) {
      if (bet.status === 'stale') continue;
      let after = bet.startHole - 1;
      for (const hole of betHoles(match.holes, bet)) {
        if (hole.status !== 'complete') break;
        after = hole.number;
      }
      const option = optionAt(game, round, match, bet, after, published);
      if (option && match.holes.find((hole) => hole.number === option.startHole)?.status === 'pending') pressOptions.push(option);
    }
    allBets.push(...bets);
    // Replace the immutable public receipt rather than mutating its readonly arrays.
    matches[matches.indexOf(match)] = { ...match, bets };
  }
  for (const { press } of manual.filter((entry) => !matchIds.has(entry.press.matchId))) {
    stalePresses.push(press); issues.push({ code: 'stale-press', pressId: press.id });
  }
  const resolved = allBets.filter((bet) => bet.settlement.status === 'complete');
  const pending = allBets.filter((bet) => bet.status === 'pending').length;
  const ids = [...new Set(game.sides.flatMap((side) => side.playerIds))];
  const rawBalances = ids.map((id) => resolved.reduce((sum, bet) =>
    sum + BigInt(bet.settlement.players.find((player) => player.playerId === id)?.netMinor ?? 0), 0n));
  const remainder = resolved.reduce((sum, bet) => sum + BigInt(bet.settlement.unallocatedMinor ?? 0), 0n);
  if (rawBalances.some((balance) => exact(balance) === null) || exact(remainder) === null) issues.push({ code: 'arithmetic-range' });
  const unavailable = issues.length > 0 || allBets.some((bet) => bet.status === 'unavailable' || bet.status === 'stale');
  const status = unavailable ? 'unavailable' : pending > 0 ? 'in-progress' : 'complete';
  const settlementStatus = unavailable ? 'unavailable' : pending > 0 ? resolved.length ? 'partial' : 'pending' : 'complete';
  return { gameId: game.id, kind: game.kind, version: 1, status, matches, stalePresses, issues,
    pressOptions: issues.length ? [] : pressOptions,
    settlement: { currency: 'USD', status: settlementStatus, resolvedBetCount: resolved.length, pendingBetCount: pending,
      players: ids.map((id, index) => playerSettlement(id, unavailable || !resolved.length ? null : exact(rawBalances[index] ?? 0n))),
      unallocatedMinor: unavailable || !resolved.length ? null : exact(remainder) } };
}

/** Validate a new declaration against the current saved position, not a client-authored lead. */
export function validateNassauManualPress(
  game: PressMatchGameDefinition, round: RoundSnapshot, cards: readonly Scorecard[],
  records: readonly NassauHoleRecord[], press: NassauManualPress, published?: NassauHandicapInputs,
): NassauPressValidation {
  if (records.some((record) => record.gameId === game.id && record.presses.some((entry) => entry.id === press.id))) {
    return { valid: false, reason: 'duplicate-id' };
  }
  return calculateNassau(game, round, cards, records, published).pressOptions.some((option) => sameOption(press, option))
    ? { valid: true } : { valid: false, reason: 'ineligible-or-stale' };
}

/** Replay an existing receipt at its historical declaration hole, including already-played child holes. */
export function revalidateNassauManualPress(
  game: PressMatchGameDefinition, round: RoundSnapshot, cards: readonly Scorecard[],
  records: readonly NassauHoleRecord[], press: NassauManualPress, published?: NassauHandicapInputs,
): NassauPressValidation {
  const result = calculateNassau(game, round, cards, records, published);
  const stored = records.flatMap((record) => record.gameId === game.id ? record.presses : []).filter((entry) => entry.id === press.id);
  const bet = result.matches.flatMap((match) => match.bets).find((entry) => entry.id === nassauManualBetId(game.id, press.id));
  return stored.length === 1 && sameOption(stored[0] ?? press, press) && bet && bet.status !== 'stale'
    ? { valid: true } : { valid: false, reason: 'ineligible-or-stale' };
}
