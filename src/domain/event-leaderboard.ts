import type { GamePlayerResult, GameTeamResult, GameUnavailableReason } from './games.js';
import { gameTeamsMatchRoster, isStablefordGame, isTeamGameDefinition } from './games.js';
import type { RoundScores } from './scoring.js';
import type { EventWorkspace, OverallCompetition, RoundSnapshot } from './setup.js';
import { calculatePlayingHandicap, handicapStrokesForHole } from './stableford.js';
import { playerTee } from './tees.js';

export type EventStandingStatus = 'complete' | 'in-progress' | 'awaiting-scores' | 'not-configured' | 'unavailable';
export type EventStandingReason = GameUnavailableReason | 'not-configured' | 'missing-game' | 'missing-round'
  | 'team-setup-required' | 'invalid-stroke-score' | 'arithmetic-range' | 'round-context-mismatch' | 'stale-round-binding';

export interface EventStandingRound {
  readonly roundId: string;
  readonly roundName: string;
  readonly totalHoles: number;
  readonly gameId: string | null;
}

export interface EventStandingCell {
  readonly roundId: string;
  readonly status: EventStandingStatus;
  readonly reason?: EventStandingReason;
  readonly holesScored: number;
  readonly totalHoles: number;
  readonly subtotal: number | null;
  readonly relativeToPar: number | null;
}

export interface EventStandingPlayer {
  readonly playerId: string;
  readonly displayName: string;
  readonly status: EventStandingStatus;
  readonly reason?: EventStandingReason;
  readonly holesScored: number;
  readonly totalHoles: number;
  readonly subtotal: number | null;
  readonly relativeToPar: number | null;
  readonly rank: number | null;
  readonly rankLabel: string | null;
  readonly cells: readonly EventStandingCell[];
}

export interface EventStandings {
  readonly status: 'disabled' | 'complete' | 'provisional' | 'unavailable';
  readonly rounds: readonly EventStandingRound[];
  readonly players: readonly EventStandingPlayer[];
  readonly staleRoundIds: readonly string[];
}

export interface EventLeaderboardView {
  readonly workspace: EventWorkspace;
  readonly roundScores: readonly RoundScores[];
  readonly standings: EventStandings;
}

function exact(value: bigint): number | null {
  return value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
}

function knownSum(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? exact(known.reduce((sum, value) => sum + BigInt(value), 0n)) : null;
}

function emptyCell(round: RoundSnapshot, reason: EventStandingReason): EventStandingCell {
  return {
    roundId: round.id, status: reason === 'not-configured' ? 'not-configured' : 'unavailable', reason,
    holesScored: 0, totalHoles: round.teeProfile.holes.length, subtotal: null, relativeToPar: null,
  };
}

function pointCell(round: RoundSnapshot, result: GamePlayerResult | GameTeamResult): EventStandingCell {
  const subtotal = knownSum(result.holes.map((hole) => hole.points));
  const arithmeticRange = subtotal === null && result.holes.some((hole) => hole.points !== null);
  const reason = arithmeticRange ? 'arithmetic-range'
    : result.status === 'unavailable' ? result.unavailableReason ?? 'missing-score-data' : undefined;
  return {
    roundId: round.id,
    status: reason !== undefined ? 'unavailable' : result.holesScored === 0 ? 'awaiting-scores' : result.status,
    ...(reason === undefined ? {} : { reason }),
    holesScored: result.holesScored, totalHoles: round.teeProfile.holes.length, subtotal, relativeToPar: null,
  };
}

function stablefordCell(
  competition: Extract<OverallCompetition, { readonly kind: 'stableford' }>,
  round: RoundSnapshot, source: RoundScores, playerId: string,
): EventStandingCell {
  const binding = competition.roundGames.find((entry) => entry.roundId === round.id);
  if (!binding) return emptyCell(round, 'not-configured');
  const game = source.games?.configuration.games.find((entry) => entry.id === binding.gameId);
  const result = source.games?.results.find((entry) => entry.gameId === binding.gameId);
  if (!game || !result || !isStablefordGame(game)) return emptyCell(round, 'missing-game');
  const individual = result.players.find((entry) => entry.playerId === playerId);
  if (isTeamGameDefinition(game)) {
    if (result.teamSetupRequired || !gameTeamsMatchRoster(game, round.players.map((player) => player.playerId))) {
      return { ...(competition.credit === 'individual' && individual
        ? pointCell(round, individual) : emptyCell(round, 'team-setup-required')),
        status: 'unavailable', reason: 'team-setup-required' };
    }
    if (competition.credit === 'team') {
      const team = result.teams?.find((entry) => entry.playerIds.includes(playerId));
      return team ? pointCell(round, team) : emptyCell(round, 'missing-score-data');
    }
  }
  return individual ? pointCell(round, individual) : emptyCell(round, 'missing-score-data');
}

function strokeCell(
  competition: Extract<OverallCompetition, { readonly kind: 'stroke-play' }>,
  round: RoundSnapshot, source: RoundScores, playerId: string,
): EventStandingCell {
  const tee = playerTee(round, playerId);
  const card = source.cards.find((entry) => entry.playerId === playerId);
  if (!card || card.holes.length !== tee.holes.length
    || tee.holes.some((hole) => !card.holes.some((entry) => entry.number === hole.number))) {
    return emptyCell(round, 'missing-score-data');
  }
  const numeric = card.holes.filter((hole) => hole.score.kind === 'strokes').length;
  let handicap = 0;
  if (competition.basis === 'net') {
    const player = round.players.find((entry) => entry.playerId === playerId);
    const published = source.overallHandicaps?.allowancePercent === competition.handicapAllowancePercent
      ? source.overallHandicaps.players.find((entry) => entry.playerId === playerId) : undefined;
    const result = player?.handicapIndex != null
      ? calculatePlayingHandicap(player.handicapIndex.value, tee, competition.handicapAllowancePercent)
      : published?.playingHandicap ?? published?.unavailableReason ?? 'missing-handicap-index';
    if (typeof result === 'string') return { ...emptyCell(round, result), holesScored: numeric };
    handicap = result;
  }
  let strokes = 0n;
  let relative = 0n;
  for (const hole of tee.holes) {
    const score = card.holes.find((entry) => entry.number === hole.number)?.score;
    if (score?.kind !== 'strokes') continue;
    const received = competition.basis === 'gross' ? 0
      : handicapStrokesForHole(handicap, hole.allocation, tee.holes.length);
    const net = BigInt(score.strokes) - BigInt(received);
    strokes += net;
    relative += net - BigInt(hole.par);
  }
  const subtotal = numeric ? exact(strokes) : null;
  const relativeToPar = numeric ? exact(relative) : null;
  const reason = numeric > 0 && (subtotal === null || relativeToPar === null) ? 'arithmetic-range'
    : card.holes.some((hole) => hole.score.kind === 'picked-up' || hole.score.kind === 'did-not-finish')
      ? 'invalid-stroke-score' : undefined;
  return {
    roundId: round.id,
    status: reason !== undefined ? 'unavailable' : numeric === 0 ? 'awaiting-scores'
      : numeric === tee.holes.length ? 'complete' : 'in-progress',
    ...(reason === undefined ? {} : { reason }),
    holesScored: numeric, totalHoles: round.teeProfile.holes.length, subtotal, relativeToPar,
  };
}

export function calculateEventStandings(workspace: EventWorkspace, roundScores: readonly RoundScores[]): EventStandings {
  const competition = workspace.overallCompetition;
  if (!competition) return { status: 'disabled', rounds: [], players: [], staleRoundIds: [] };
  const staleRoundIds = competition.kind === 'stableford'
    ? competition.roundGames.filter((binding) => !workspace.rounds.some((round) => round.id === binding.roundId))
      .map((binding) => binding.roundId) : [];
  const rounds = workspace.rounds.map((round): EventStandingRound => ({
    roundId: round.id, roundName: round.name, totalHoles: round.teeProfile.holes.length,
    gameId: competition.kind === 'stableford'
      ? competition.roundGames.find((binding) => binding.roundId === round.id)?.gameId ?? null : null,
  }));
  const players = workspace.roster.map((player): EventStandingPlayer => {
    const cells = workspace.rounds.map((round) => {
      const sources = roundScores.filter((source) => source.roundId === round.id);
      const source = sources[0];
      if (!source) return emptyCell(round, 'missing-round');
      if (sources.length !== 1 || source.eventId !== workspace.event.id) return emptyCell(round, 'round-context-mismatch');
      return competition.kind === 'stableford'
        ? stablefordCell(competition, round, source, player.playerId)
        : strokeCell(competition, round, source, player.playerId);
    });
    const subtotal = knownSum(cells.map((cell) => cell.subtotal));
    const relativeToPar = knownSum(cells.map((cell) => cell.relativeToPar));
    const arithmeticRange = subtotal === null && cells.some((cell) => cell.subtotal !== null)
      || competition.kind === 'stroke-play' && relativeToPar === null && cells.some((cell) => cell.relativeToPar !== null);
    const blocked = cells.find((cell) => cell.status === 'not-configured' || cell.status === 'unavailable');
    const reason = arithmeticRange ? 'arithmetic-range' : staleRoundIds.length ? 'stale-round-binding' : blocked?.reason;
    const holesScored = cells.reduce((sum, cell) => sum + cell.holesScored, 0);
    return {
      playerId: player.playerId, displayName: player.displayName, cells, subtotal, relativeToPar, holesScored,
      totalHoles: cells.reduce((sum, cell) => sum + cell.totalHoles, 0),
      status: reason !== undefined ? reason === 'not-configured' ? 'not-configured' : 'unavailable'
        : holesScored === 0 ? 'awaiting-scores' : cells.every((cell) => cell.status === 'complete') ? 'complete' : 'in-progress',
      ...(reason === undefined ? {} : { reason }), rank: null, rankLabel: null,
    };
  });
  const score = (player: EventStandingPlayer) => competition.kind === 'stableford' ? player.subtotal : player.relativeToPar;
  const ranked = players.filter((player) => (player.status === 'complete' || player.status === 'in-progress') && score(player) !== null)
    .sort((left, right) => {
      const a = score(left);
      const b = score(right);
      if (a === null || b === null || a === b) return 0;
      return (a < b ? -1 : 1) * (competition.kind === 'stableford' ? -1 : 1);
    });
  const ranks = new Map<string, { readonly rank: number; readonly rankLabel: string }>();
  const counts = new Map<number, number>();
  for (const player of ranked) {
    const value = score(player);
    if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let previous: number | null = null;
  let rank = 0;
  for (const [index, player] of ranked.entries()) {
    const value = score(player);
    if (value === null) continue;
    if (value !== previous) rank = index + 1;
    previous = value;
    const tied = (counts.get(value) ?? 0) > 1;
    ranks.set(player.playerId, { rank, rankLabel: `${tied ? 'T' : ''}${String(rank)}` });
  }
  const ordered = [...ranked, ...players.filter((player) => !ranks.has(player.playerId))];
  return {
    status: players.some((player) => player.status === 'unavailable' || player.status === 'not-configured') ? 'unavailable'
      : players.length > 0 && workspace.rounds.length > 0 && players.every((player) => player.status === 'complete')
        ? 'complete' : 'provisional',
    rounds, staleRoundIds, players: ordered.map((player) => ({ ...player, ...ranks.get(player.playerId) })),
  };
}
