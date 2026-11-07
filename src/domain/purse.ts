import { calculateEventStandings } from './event-leaderboard.js';
import { gameResultDirection, gameResultTotal, isTeamGameDefinition, teamSize } from './games.js';
import type { RoundGameDefinition } from './games.js';
import type { RoundScores } from './scoring.js';
import type { EventWorkspace } from './setup.js';

export const purseCurrencies = ['USD', 'CAD', 'EUR', 'GBP', 'AUD'] as const;
export type PurseCurrency = typeof purseCurrencies[number];
export type PurseFunding =
  | { readonly kind: 'fixed'; readonly budgetMinor: number }
  | { readonly kind: 'buy-in'; readonly buyInMinor: number };
export type PurseRankedSource =
  | { readonly kind: 'overall' }
  | { readonly kind: 'round-game'; readonly roundId: string; readonly gameId: string };
export interface PursePlacePrize {
  readonly place: number;
  readonly amountMinor: number;
}
interface CommonPool {
  readonly id: string;
  readonly name: string;
}
export interface PurseRankedPool extends CommonPool {
  readonly source: PurseRankedSource;
  /** Per-golfer team prizes multiply each place amount by the team's member count. */
  readonly awardUnit: 'per-golfer' | 'per-team';
  readonly prizes: readonly PursePlacePrize[];
  readonly tiePolicy: 'pooled' | 'organizer';
}
export interface PurseManualPool extends CommonPool {
  readonly source: { readonly kind: 'manual' };
  readonly awardUnit: 'pot';
  readonly amountMinor: number;
  /** Empty recipients reserve the entire pot; otherwise shares are equal. */
  readonly recipientIds: readonly string[];
}
export type PursePool = PurseRankedPool | PurseManualPool;
export interface PursePlan {
  readonly eventId: string;
  readonly currency: PurseCurrency;
  readonly funding: PurseFunding;
  readonly pools: readonly PursePool[];
}
export interface PurseTieResolution {
  readonly poolId: string;
  readonly rank: number;
  /** Exactly the current tied entrant set, ordered only for this award pool. */
  readonly orderedEntrantIds: readonly string[];
}
export type PurseIssueCode = 'invalid-plan' | 'event-context-mismatch' | 'roster-context-mismatch'
  | 'missing-round' | 'missing-game' | 'invalid-award-unit' | 'team-setup-required'
  | 'missing-score-data' | 'source-unavailable' | 'overall-not-configured'
  | 'arithmetic-range' | 'invalid-resolution' | 'budget-exceeded';
export interface PurseIssue {
  readonly code: PurseIssueCode;
  readonly poolId?: string;
  readonly detail?: string;
}
export interface PurseShare {
  readonly playerId: string;
  readonly entrantId: string;
  readonly rank: number | null;
  readonly amountMinor: number;
}
export interface PursePoolResult {
  readonly poolId: string;
  readonly status: 'calculated' | 'projected' | 'unavailable';
  readonly issues: readonly PurseIssue[];
  readonly reasons: readonly ('awaiting-scores' | 'in-progress' | 'unresolved-tie' | 'recipients-unassigned' | 'unoccupied-places')[];
  readonly shares: readonly PurseShare[];
  readonly scheduledMinor: number | null;
  readonly allocatedMinor: number | null;
  readonly projectedMinor: number | null;
  readonly reservedMinor: number | null;
  readonly tieRemainderMinor: number | null;
  readonly memberRemainderMinor: number | null;
  readonly unallocatedMinor: number | null;
}
export interface PursePlayerWinnings {
  readonly playerId: string;
  /** Known shares only; unavailable pools are identified by the result's status/issues. */
  readonly allocatedMinor: number | null;
  readonly projectedMinor: number | null;
  /** Null if any pool is unavailable; the fields above retain known partial shares. */
  readonly totalMinor: number | null;
}
export interface PurseCalculation {
  readonly status: 'calculated' | 'projected' | 'unavailable';
  readonly issues: readonly PurseIssue[];
  readonly plannedBudgetMinor: number | null;
  readonly scheduledMinor: number | null;
  readonly allocatedMinor: number | null;
  readonly projectedMinor: number | null;
  readonly reservedMinor: number | null;
  readonly tieRemainderMinor: number | null;
  readonly memberRemainderMinor: number | null;
  /** Scheduled funds not assigned to individuals: reserves plus both rounding remainders. */
  readonly unallocatedMinor: number | null;
  /** Unscheduled budget, never negative. Overcommitment is separate, never auto-scaled. */
  readonly remainingMinor: number | null;
  readonly overBudgetMinor: number | null;
  readonly pools: readonly PursePoolResult[];
  readonly players: readonly PursePlayerWinnings[];
}
export interface PurseView {
  readonly plan: PursePlan;
  readonly resolutions: readonly PurseTieResolution[];
  readonly calculation: PurseCalculation;
}

interface Entrant {
  readonly id: string;
  readonly playerIds: readonly string[];
  readonly rank: number | null;
}
interface Source {
  readonly entrants: readonly Entrant[];
  readonly complete: boolean;
  readonly issues: readonly PurseIssue[];
}
const money = (value: number) => Number.isSafeInteger(value) && value >= 0;
const uuid = (value: string) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const unique = (values: readonly string[]) => new Set(values.map((value) => value.toLowerCase())).size === values.length;
const sameSet = (left: readonly string[], right: readonly string[]) =>
  unique(left) && unique(right) && left.length === right.length && left.every((id) => right.includes(id));
const exact = (value: bigint): number | null =>
  value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
const issue = (code: PurseIssueCode, poolId?: string, detail?: string): PurseIssue => ({
  code, ...(poolId === undefined ? {} : { poolId }), ...(detail === undefined ? {} : { detail }),
});
const manual = (pool: PursePool): pool is PurseManualPool => pool.source.kind === 'manual';

function samePool(left: PursePool, right: PursePool): boolean {
  if (left.id !== right.id || left.name !== right.name || left.awardUnit !== right.awardUnit) return false;
  if (manual(left)) return manual(right) && left.amountMinor === right.amountMinor
    && sameSet(left.recipientIds, right.recipientIds);
  if (manual(right) || left.tiePolicy !== right.tiePolicy || left.source.kind !== right.source.kind) return false;
  if (left.source.kind === 'round-game' && (right.source.kind !== 'round-game'
    || left.source.roundId !== right.source.roundId || left.source.gameId !== right.source.gameId)) return false;
  return left.prizes.length === right.prizes.length
    && new Set(left.prizes.map((prize) => prize.place)).size === left.prizes.length
    && new Set(right.prizes.map((prize) => prize.place)).size === right.prizes.length
    && left.prizes.every((prize) => right.prizes.some((other) =>
      prize.place === other.place && prize.amountMinor === other.amountMinor));
}

/**
 * Semantic equality for validated save acknowledgments. Pool/prize/recipient order is immaterial;
 * null and undefined both mean no plan. This compares values, never serialized object key order.
 */
export function samePursePlan(left?: PursePlan | null, right?: PursePlan | null): boolean {
  if (left == null || right == null) return left == null && right == null;
  if (left.eventId !== right.eventId || left.currency !== right.currency || left.funding.kind !== right.funding.kind) return false;
  if (left.funding.kind === 'fixed') {
    if (right.funding.kind !== 'fixed' || left.funding.budgetMinor !== right.funding.budgetMinor) return false;
  } else if (right.funding.kind !== 'buy-in' || left.funding.buyInMinor !== right.funding.buyInMinor) return false;
  return left.pools.length === right.pools.length && unique(left.pools.map((pool) => pool.id))
    && unique(right.pools.map((pool) => pool.id))
    && left.pools.every((pool) => {
      const other = right.pools.find((entry) => entry.id === pool.id);
      return other !== undefined && samePool(pool, other);
    });
}

/** Decision-list order is immaterial; the ordering of entrants inside a decision is significant. */
export function samePurseTieResolutions(
  left: readonly PurseTieResolution[], right: readonly PurseTieResolution[],
): boolean {
  const key = (entry: PurseTieResolution) => `${entry.poolId}:${String(entry.rank)}`;
  return left.length === right.length && unique(left.map(key)) && unique(right.map(key))
    && left.every((entry) => {
      const other = right.find((candidate) => candidate.poolId === entry.poolId && candidate.rank === entry.rank);
      return other !== undefined && entry.orderedEntrantIds.length === other.orderedEntrantIds.length
        && entry.orderedEntrantIds.every((id, index) => id === other.orderedEntrantIds[index]);
    });
}

function validTeamConfiguration(game: RoundGameDefinition, roster: readonly string[]): boolean {
  return !isTeamGameDefinition(game) || game.teams.length > 0
    && unique(game.teams.map((team) => team.id)) && game.teams.every((team) => uuid(team.id))
    && sameSet(game.teams.flatMap((team) => team.playerIds), roster)
    && game.teams.every((team) => team.playerIds.length === teamSize(game.format));
}

/** Configuration/context checks do not require scores, so a valid plan can be saved before play. */
export function validatePursePlanContext(
  plan: PursePlan, workspace: EventWorkspace, roundScores?: readonly RoundScores[],
): readonly PurseIssue[] {
  const issues: PurseIssue[] = [];
  const ids = workspace.roster.map((player) => player.playerId);
  if (!uuid(plan.eventId) || !purseCurrencies.includes(plan.currency)
    || !unique(plan.pools.map((pool) => pool.id.toLowerCase()))
    || (plan.funding.kind === 'fixed' ? !money(plan.funding.budgetMinor)
      : !money(plan.funding.buyInMinor))) issues.push(issue('invalid-plan'));
  if (plan.eventId !== workspace.event.id) issues.push(issue('event-context-mismatch'));
  if (!unique(ids) || !ids.every(uuid) || !unique(workspace.rounds.map((round) => round.id))) {
    issues.push(issue('roster-context-mismatch'));
  }
  for (const pool of plan.pools) {
    if (!uuid(pool.id) || !pool.name.trim() || pool.name !== pool.name.trim() || pool.name.length > 100) {
      issues.push(issue('invalid-plan', pool.id));
    }
    if (manual(pool)) {
      if (!money(pool.amountMinor) || !unique(pool.recipientIds)
        || !pool.recipientIds.every((id) => ids.includes(id))) issues.push(issue('invalid-plan', pool.id));
      continue;
    }
    if (!['per-team', 'per-golfer'].includes(pool.awardUnit) || !['pooled', 'organizer'].includes(pool.tiePolicy)
      || pool.prizes.some((prize) => !money(prize.amountMinor) || !Number.isSafeInteger(prize.place) || prize.place < 1)
      || new Set(pool.prizes.map((prize) => prize.place)).size !== pool.prizes.length) {
      issues.push(issue('invalid-plan', pool.id));
    }
    if (pool.source.kind === 'overall') {
      if (!workspace.overallCompetition) issues.push(issue('overall-not-configured', pool.id));
      if (pool.awardUnit !== 'per-golfer') issues.push(issue('invalid-award-unit', pool.id));
      const competition = workspace.overallCompetition;
      if (competition?.kind === 'stableford') {
        if (!sameSet(competition.roundGames.map((binding) => binding.roundId), workspace.rounds.map((round) => round.id))) {
          issues.push(issue('missing-round', pool.id));
        }
        if (roundScores !== undefined) {
          for (const binding of competition.roundGames) {
            const configurations = roundScores.filter((round) => round.roundId === binding.roundId);
            const games = configurations[0]?.games?.configuration.games.filter((game) => game.id === binding.gameId) ?? [];
            if (configurations.length !== 1 || games.length !== 1) issues.push(issue('missing-game', pool.id));
            const configuration = configurations[0];
            if (configuration && (configuration.eventId !== workspace.event.id
              || configuration.games && (configuration.games.configuration.eventId !== workspace.event.id
                || configuration.games.configuration.roundId !== binding.roundId))) issues.push(issue('event-context-mismatch', pool.id));
            const game = games[0];
            if (game && !validTeamConfiguration(game, ids)) issues.push(issue('team-setup-required', pool.id));
          }
        }
      }
    } else {
      const source = pool.source;
      if (!uuid(source.roundId) || !uuid(source.gameId)) issues.push(issue('invalid-plan', pool.id));
      const snapshot = workspace.rounds.find((entry) => entry.id === source.roundId);
      if (!snapshot) issues.push(issue('missing-round', pool.id));
      else if (!sameSet(snapshot.players.map((player) => player.playerId), ids)) issues.push(issue('roster-context-mismatch', pool.id));
      if (roundScores !== undefined) {
        const saved = roundScores.filter((round) => round.roundId === source.roundId);
        const games = saved[0]?.games?.configuration.games.filter((game) => game.id === source.gameId) ?? [];
        if (saved.length !== 1 || games.length !== 1) issues.push(issue('missing-game', pool.id));
        const game = games[0];
        const savedRound = saved[0];
        if (savedRound && (savedRound.eventId !== workspace.event.id
          || savedRound.games && (savedRound.games.configuration.eventId !== workspace.event.id
            || savedRound.games.configuration.roundId !== source.roundId))) issues.push(issue('event-context-mismatch', pool.id));
        if (game && !validTeamConfiguration(game, ids)) issues.push(issue('team-setup-required', pool.id));
        if (game && !isTeamGameDefinition(game) && pool.awardUnit !== 'per-golfer') {
          issues.push(issue('invalid-award-unit', pool.id));
        }
      }
    }
  }
  const budget = plan.funding.kind === 'fixed' ? plan.funding.budgetMinor : plan.funding.buyInMinor;
  if (money(budget) && exact(BigInt(budget) * (plan.funding.kind === 'buy-in' ? BigInt(ids.length) : 1n)) === null) {
    issues.push(issue('arithmetic-range'));
  }
  if (roundScores !== undefined && issues.length === 0) {
    const amounts = plan.pools.map((pool) => scheduled(pool, workspace, roundScores));
    if (amounts.some((amount) => amount === null)
      || exact(amounts.reduce<bigint>((sum, amount) => sum + BigInt(amount ?? 0), 0n)) === null) {
      issues.push(issue('arithmetic-range'));
    }
  }
  return issues;
}

function sourceFor(pool: PurseRankedPool, workspace: EventWorkspace, rounds: readonly RoundScores[]): Source {
  const blocked = (code: PurseIssueCode, detail?: string): Source => ({
    entrants: [], complete: false, issues: [issue(code, pool.id, detail)],
  });
  if (pool.source.kind === 'overall') {
    const competition = workspace.overallCompetition;
    if (competition?.kind === 'stableford') {
      for (const binding of competition.roundGames) {
        const source = sourceFor({ ...pool, source: { kind: 'round-game', ...binding } }, workspace, rounds);
        if (source.issues.length) return source;
      }
    }
    const standings = calculateEventStandings(workspace, rounds);
    if (standings.status === 'disabled') return blocked('overall-not-configured');
    if (standings.status === 'unavailable') return blocked('source-unavailable',
      standings.players.find((player) => player.reason !== undefined)?.reason);
    return {
      complete: standings.status === 'complete', issues: [],
      entrants: standings.players.map((player) => ({ id: player.playerId, playerIds: [player.playerId], rank: player.rank })),
    };
  }
  const source = pool.source;
  const snapshot = workspace.rounds.find((round) => round.id === source.roundId);
  if (!snapshot) return blocked('missing-round');
  const matches = rounds.filter((round) => round.roundId === source.roundId);
  const saved = matches[0];
  if (!saved) return blocked('missing-score-data');
  if (matches.length !== 1 || saved.eventId !== workspace.event.id
    || saved.games && (saved.games.configuration.eventId !== workspace.event.id
      || saved.games.configuration.roundId !== snapshot.id)) return blocked('event-context-mismatch');
  const definitions = saved.games?.configuration.games.filter((game) => game.id === source.gameId) ?? [];
  const results = saved.games?.results.filter((result) => result.gameId === source.gameId) ?? [];
  const game = definitions[0];
  const result = results[0];
  if (!game || !result || definitions.length !== 1 || results.length !== 1) return blocked('missing-game');
  const roster = snapshot.players.map((player) => player.playerId);
  if (!sameSet(roster, workspace.roster.map((player) => player.playerId))
    || !sameSet(result.players.map((player) => player.playerId), roster)) return blocked('roster-context-mismatch');
  if (isTeamGameDefinition(game)) {
    if (result.teamSetupRequired || !validTeamConfiguration(game, roster)
      || !sameSet(result.teams?.map((team) => team.teamId) ?? [], game.teams.map((team) => team.id))
      || result.teams?.some((team) => {
        const definition = game.teams.find((entry) => entry.id === team.teamId);
        return !definition || !sameSet(team.playerIds, definition.playerIds);
      })) return blocked('team-setup-required');
  } else {
    if (pool.awardUnit !== 'per-golfer') return blocked('invalid-award-unit');
    if (result.teamSetupRequired || result.teams && result.teams.length > 0) return blocked('team-setup-required');
  }
  const entries = isTeamGameDefinition(game) ? result.teams ?? [] : result.players;
  if (entries.some((entry) => entry.status === 'unavailable')) {
    const unavailable = entries.find((entry) => entry.status === 'unavailable');
    return blocked('source-unavailable', unavailable?.strokeGame?.unavailableReason ?? unavailable?.unavailableReason);
  }
  if (entries.some((entry) => gameResultTotal(entry) !== null && !Number.isSafeInteger(gameResultTotal(entry)))) return blocked('arithmetic-range');
  if (entries.some((entry) => gameResultTotal(entry) === null && (entry.status === 'complete' || entry.holesScored > 0)
    || entry.status === 'complete' && (entry.totalHoles < 1 || entry.holesScored !== entry.totalHoles))) {
    return blocked('missing-score-data');
  }
  // Saved totals are the ranking authority; no strokes, points tables or tee math are reconstructed here.
  const ranked = entries.filter((entry) => entry.holesScored > 0 && gameResultTotal(entry) !== null)
    .sort((a, b) => {
      const left = gameResultTotal(a);
      const right = gameResultTotal(b);
      return left === null || right === null || left === right ? 0 : (left < right ? -1 : 1) * gameResultDirection(game);
    });
  return {
    complete: entries.length > 0 && entries.every((entry) => entry.status === 'complete'), issues: [],
    entrants: entries.map((entry) => {
      const index = gameResultTotal(entry) === null || entry.holesScored === 0 ? -1
        : ranked.findIndex((other) => gameResultTotal(other) === gameResultTotal(entry));
      return {
        id: 'teamId' in entry ? entry.teamId : entry.playerId,
        playerIds: 'playerIds' in entry ? entry.playerIds : [entry.playerId],
        rank: index === -1 ? null : index + 1,
      };
    }),
  };
}

function scheduled(pool: PursePool, workspace: EventWorkspace, rounds: readonly RoundScores[]): number | null {
  if (manual(pool)) return money(pool.amountMinor) ? pool.amountMinor : null;
  let multiplier = 1n;
  if (pool.source.kind === 'round-game' && pool.awardUnit === 'per-golfer') {
    const target = pool.source;
    const game = rounds.find((round) => round.roundId === target.roundId)?.games?.configuration.games
      .find((entry) => entry.id === target.gameId);
    if (!game) return null;
    if (isTeamGameDefinition(game)) multiplier = BigInt(teamSize(game.format));
  }
  if (pool.source.kind === 'overall' && !workspace.overallCompetition) return null;
  if (pool.prizes.some((prize) => !money(prize.amountMinor))) return null;
  return exact(pool.prizes.reduce((sum, prize) => sum + BigInt(prize.amountMinor) * multiplier, 0n));
}

function poolResult(
  pool: PursePool, source: Source, schedule: number | null, resolutions: readonly PurseTieResolution[],
  issues: readonly PurseIssue[],
): PursePoolResult {
  const unavailable = (errors: readonly PurseIssue[]): PursePoolResult => ({
    poolId: pool.id, status: 'unavailable', issues: errors, reasons: [], shares: [], scheduledMinor: schedule,
    allocatedMinor: 0, projectedMinor: 0, reservedMinor: schedule,
    tieRemainderMinor: 0, memberRemainderMinor: 0, unallocatedMinor: schedule,
  });
  if (issues.length) return unavailable(issues);
  if (schedule === null) return unavailable([issue('arithmetic-range', pool.id)]);
  const shares: PurseShare[] = [];
  let tieRemainder = 0n;
  let memberRemainder = 0n;
  let assigned = 0n;
  const award = (entrants: readonly Entrant[], pot: bigint, rank: number | null) => {
    const perEntrant = pot / BigInt(entrants.length);
    tieRemainder += pot % BigInt(entrants.length);
    for (const entrant of entrants) {
      const perMember = perEntrant / BigInt(entrant.playerIds.length);
      memberRemainder += perEntrant % BigInt(entrant.playerIds.length);
      for (const playerId of entrant.playerIds) {
        shares.push({ playerId, entrantId: entrant.id, rank, amountMinor: Number(perMember) });
        assigned += perMember;
      }
    }
  };
  if (manual(pool)) {
    if (pool.recipientIds.length) award([{ id: pool.id, playerIds: pool.recipientIds, rank: null }], BigInt(schedule), null);
  } else {
    const ranks = new Set(source.entrants.flatMap((entrant) => entrant.rank === null ? [] : [entrant.rank]));
    for (const rank of ranks) {
      const tied = source.entrants.filter((entrant) => entrant.rank === rank);
      const multiplier = pool.awardUnit === 'per-golfer' ? BigInt(tied[0]?.playerIds.length ?? 1) : 1n;
      const prizes = pool.prizes.filter((prize) => prize.place >= rank && prize.place < rank + tied.length);
      if (pool.tiePolicy === 'organizer' && tied.length > 1) {
        const resolution = resolutions.find((entry) => entry.poolId === pool.id && entry.rank === rank);
        if (!resolution) continue;
        for (const [offset, id] of resolution.orderedEntrantIds.entries()) {
          const entrant = tied.find((entry) => entry.id === id);
          const prize = prizes.find((entry) => entry.place === rank + offset);
          if (entrant && prize) award([entrant], BigInt(prize.amountMinor) * multiplier, rank);
        }
      } else {
        const pot = prizes.reduce((sum, prize) => sum + BigInt(prize.amountMinor) * multiplier, 0n);
        if (prizes.length) award(tied, pot, rank);
      }
    }
  }
  const reserved = BigInt(schedule) - assigned - tieRemainder - memberRemainder;
  const unresolved = !manual(pool) && pool.tiePolicy === 'organizer' && source.entrants.some((entrant) =>
    entrant.rank !== null && source.entrants.filter((entry) => entry.rank === entrant.rank).length > 1
    && pool.prizes.some((prize) => prize.place >= (entrant.rank ?? 0)
      && prize.place < (entrant.rank ?? 0) + source.entrants.filter((entry) => entry.rank === entrant.rank).length)
    && !resolutions.some((entry) => entry.poolId === pool.id && entry.rank === entrant.rank));
  const complete = source.complete && !unresolved && (!manual(pool) || pool.recipientIds.length > 0);
  const reasons: PursePoolResult['reasons'][number][] = [];
  if (!source.complete) reasons.push(source.entrants.every((entrant) => entrant.rank === null) ? 'awaiting-scores' : 'in-progress');
  if (unresolved) reasons.push('unresolved-tie');
  if (manual(pool) && pool.recipientIds.length === 0) reasons.push('recipients-unassigned');
  if (reserved > 0n && !unresolved && !manual(pool)) reasons.push('unoccupied-places');
  return {
    poolId: pool.id, status: complete ? 'calculated' : 'projected',
    issues: [], reasons, shares, scheduledMinor: schedule, allocatedMinor: complete ? Number(assigned) : 0,
    projectedMinor: complete ? 0 : Number(assigned), reservedMinor: Number(reserved),
    tieRemainderMinor: Number(tieRemainder), memberRemainderMinor: Number(memberRemainder),
    unallocatedMinor: Number(reserved + tieRemainder + memberRemainder),
  };
}

/** Caller supplies authoritative saved results, never local score drafts. No input is mutated. */
export function calculatePurse(
  plan: PursePlan, workspace: EventWorkspace, roundScores: readonly RoundScores[],
  resolutions: readonly PurseTieResolution[] = [],
): PurseCalculation {
  const issues = [...validatePursePlanContext(plan, workspace)];
  const sources = plan.pools.map((pool): Source => manual(pool)
    ? { entrants: [], complete: true, issues: [] } : sourceFor(pool, workspace, roundScores));
  const seen = new Set<string>();
  for (const resolution of resolutions) {
    const index = plan.pools.findIndex((pool) => pool.id === resolution.poolId);
    const pool = plan.pools[index];
    const source = sources[index];
    const key = `${resolution.poolId}:${String(resolution.rank)}`;
    const tied = source?.entrants.filter((entrant) => entrant.rank === resolution.rank) ?? [];
    if (!pool || manual(pool) || pool.tiePolicy !== 'organizer' || seen.has(key)
      || !Number.isSafeInteger(resolution.rank) || resolution.rank < 1 || tied.length < 2
      || !sameSet(resolution.orderedEntrantIds, tied.map((entrant) => entrant.id))) {
      issues.push(issue('invalid-resolution', resolution.poolId));
    }
    seen.add(key);
  }
  const invalidResolutions = issues.some((entry) => entry.code === 'invalid-resolution');
  const pools = plan.pools.map((pool, index) => {
    const source = sources[index] ?? { entrants: [], complete: false, issues: [issue('missing-score-data', pool.id)] };
    const errors = [...issues.filter((entry) => entry.poolId === undefined || entry.poolId === pool.id), ...source.issues];
    if (invalidResolutions && !errors.some((entry) => entry.code === 'invalid-resolution')) errors.push(issue('invalid-resolution', pool.id));
    return poolResult(pool, source, scheduled(pool, workspace, roundScores), resolutions, errors);
  });
  const sum = (field: 'scheduledMinor' | 'allocatedMinor' | 'projectedMinor' | 'reservedMinor'
    | 'tieRemainderMinor' | 'memberRemainderMinor' | 'unallocatedMinor'): number | null => {
    let total = 0n;
    for (const pool of pools) {
      const value = pool[field];
      if (value === null) return null;
      total += BigInt(value);
    }
    return exact(total);
  };
  const budgetValue = plan.funding.kind === 'fixed' ? plan.funding.budgetMinor : plan.funding.buyInMinor;
  const plannedBudgetMinor = money(budgetValue)
    ? exact(BigInt(budgetValue) * (plan.funding.kind === 'buy-in' ? BigInt(workspace.roster.length) : 1n)) : null;
  const scheduledMinor = sum('scheduledMinor');
  const allocatedMinor = sum('allocatedMinor');
  const projectedMinor = sum('projectedMinor');
  const reservedMinor = sum('reservedMinor');
  const tieRemainderMinor = sum('tieRemainderMinor');
  const memberRemainderMinor = sum('memberRemainderMinor');
  const unallocatedMinor = sum('unallocatedMinor');
  const remainingMinor = plannedBudgetMinor === null || scheduledMinor === null ? null
    : exact(BigInt(plannedBudgetMinor) > BigInt(scheduledMinor) ? BigInt(plannedBudgetMinor) - BigInt(scheduledMinor) : 0n);
  const overBudgetMinor = plannedBudgetMinor === null || scheduledMinor === null ? null
    : exact(BigInt(scheduledMinor) > BigInt(plannedBudgetMinor) ? BigInt(scheduledMinor) - BigInt(plannedBudgetMinor) : 0n);
  const allIssues = [...issues, ...pools.flatMap((pool) => pool.issues)];
  if (money(budgetValue) && plannedBudgetMinor === null
    || (['scheduledMinor', 'allocatedMinor', 'projectedMinor', 'reservedMinor', 'tieRemainderMinor',
      'memberRemainderMinor', 'unallocatedMinor'] as const).some((field) =>
        sum(field) === null && pools.every((pool) => pool[field] !== null))) allIssues.push(issue('arithmetic-range'));
  if (overBudgetMinor !== null && overBudgetMinor > 0) allIssues.push(issue('budget-exceeded'));
  const unavailablePools = pools.some((pool) => pool.status === 'unavailable');
  const players = workspace.roster.map((player): PursePlayerWinnings => {
    let allocated = 0n;
    let projected = 0n;
    for (const pool of pools) {
      const amount = pool.shares.filter((share) => share.playerId === player.playerId)
        .reduce((total, share) => total + BigInt(share.amountMinor), 0n);
      if (pool.status === 'calculated') allocated += amount;
      if (pool.status === 'projected') projected += amount;
    }
    return { playerId: player.playerId, allocatedMinor: exact(allocated), projectedMinor: exact(projected),
      totalMinor: unavailablePools ? null : exact(allocated + projected) };
  });
  if (!unavailablePools && players.some((player) => player.totalMinor === null)) allIssues.push(issue('arithmetic-range'));
  return {
    status: allIssues.length ? 'unavailable' : pools.some((pool) => pool.status === 'projected') ? 'projected' : 'calculated',
    issues: allIssues.filter((entry, index) => allIssues.findIndex((other) =>
      other.code === entry.code && other.poolId === entry.poolId && other.detail === entry.detail) === index),
    plannedBudgetMinor, scheduledMinor, allocatedMinor, projectedMinor, reservedMinor, tieRemainderMinor,
    memberRemainderMinor, unallocatedMinor, remainingMinor, overBudgetMinor, pools, players,
  };
}
