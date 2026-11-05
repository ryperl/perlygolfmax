import { isRoundGameDefinition, isRoundGameDefinitions } from '../../contracts/games';
import type { GameTeam, RoundGameDefinition, StablefordPreset, TeamGameFormat } from '../../domain/games';
import { defaultHandicapAllowancePercent, defaultTeamHandicapAllowancePercent, gameTeamsMatchRoster, isTeamGameDefinition, maximumPointsRows, teamSize } from '../../domain/games';
import { stablefordPoints } from '../../domain/stableford';

export interface GameDraft {
  readonly id: string;
  readonly name: string;
  readonly preset: StablefordPreset;
  readonly basis: 'gross' | 'net';
  readonly allowance: string;
  readonly rows: readonly { readonly scoreToPar: number; readonly points: string }[];
  readonly better: string;
  readonly worse: string;
  readonly format?: TeamGameFormat;
  readonly teams?: readonly GameTeam[] | undefined;
  readonly allowanceConfigured?: boolean;
  readonly assignmentsCleared?: boolean;
}

export function draftFromGame(game: RoundGameDefinition): GameDraft {
  return {
    id: game.id, name: game.name, preset: game.preset, basis: game.basis,
    allowance: String(game.handicapAllowancePercent),
    rows: game.points.rows.map((row) => ({ ...row, points: String(row.points) })),
    better: String(game.points.betterScorePoints), worse: String(game.points.worseScorePoints),
    allowanceConfigured: true,
    ...(isTeamGameDefinition(game) ? { format: game.format, teams: game.teams } : {}),
  };
}

export function newGameDraft(): GameDraft {
  return { ...draftFromGame({
    id: crypto.randomUUID(), name: 'Standard Stableford', preset: 'standard', basis: 'gross',
    handicapAllowancePercent: defaultHandicapAllowancePercent, points: stablefordPoints('standard'),
  }), allowanceConfigured: false };
}

function emptyTeams(format: TeamGameFormat, rosterCount: number): readonly GameTeam[] {
  return Array.from({ length: rosterCount % teamSize(format) === 0 ? rosterCount / teamSize(format) : 0 }, (_, index) => ({
    id: crypto.randomUUID(), name: `Team ${String(index + 1)}`,
    playerIds: Array.from({ length: teamSize(format) }, () => ''),
  }));
}

export function resetTeamAssignments(draft: GameDraft, rosterCount: number): GameDraft {
  return draft.format ? { ...draft, teams: emptyTeams(draft.format, rosterCount), assignmentsCleared: false } : draft;
}

export function setFormat(draft: GameDraft, format: TeamGameFormat | undefined, rosterCount: number): GameDraft {
  const changedSize = draft.format !== undefined && format !== undefined && teamSize(draft.format) !== teamSize(format);
  const teams = format === undefined ? undefined
    : draft.format !== undefined && !changedSize ? draft.teams
      : emptyTeams(format, rosterCount);
  const { format: previousFormat, teams: previousTeams, ...rest } = draft;
  // These properties belong only to team drafts; switching back keeps the individual wire shape.
  void previousFormat;
  void previousTeams;
  return {
    ...rest, ...(format === undefined ? {} : { format, teams: teams ?? [] }),
    basis: format === undefined ? draft.basis : 'net',
    allowance: draft.allowanceConfigured === false
      ? String(format === undefined ? defaultHandicapAllowancePercent : defaultTeamHandicapAllowancePercent) : draft.allowance,
    assignmentsCleared: changedSize,
  };
}

export function teamDraftFeedback(draft: GameDraft, playerIds: readonly string[]): string | null {
  if (!draft.format) return null;
  const size = teamSize(draft.format);
  if (playerIds.length < size || playerIds.length % size !== 0) {
    return `${String(playerIds.length)} golfers cannot form full ${String(size)}-person teams. Choose a compatible format or update the round roster.`;
  }
  const assigned = (draft.teams ?? []).flatMap((team) => team.playerIds);
  if (assigned.some((id) => id !== '' && !playerIds.includes(id))) return 'A selected golfer is no longer in this round. Replace that assignment.';
  if (new Set(assigned.filter(Boolean)).size !== assigned.filter(Boolean).length) return 'A golfer is assigned more than once. Assign each golfer exactly once.';
  if (assigned.length !== playerIds.length || assigned.some((id) => !id)
    || (draft.teams ?? []).some((team) => team.playerIds.length !== size)) return 'Assign every round golfer exactly once in full teams. Empty member slots are not saved.';
  if ((draft.teams ?? []).some((team) => !team.name.trim())) return 'Give every team a name.';
  return null;
}

export function setPreset(draft: GameDraft, preset: StablefordPreset): GameDraft {
  const points = stablefordPoints(preset);
  return {
    ...draft, preset,
    name: ['Standard Stableford', 'Modified Stableford'].includes(draft.name)
      ? preset === 'standard' ? 'Standard Stableford' : 'Modified Stableford' : draft.name,
    rows: points.rows.map((row) => ({ ...row, points: String(row.points) })),
    better: String(points.betterScorePoints), worse: String(points.worseScorePoints),
  };
}

function integer(text: string): number | undefined {
  if (!/^-?\d+$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : undefined;
}

export function buildGame(draft: GameDraft, playerIds: readonly string[] = []): RoundGameDefinition | null {
  const parsedAllowance = integer(draft.allowance);
  const allowance = draft.basis === 'gross'
    && (parsedAllowance === undefined || parsedAllowance < 1 || parsedAllowance > 100)
    ? defaultHandicapAllowancePercent : parsedAllowance;
  const better = integer(draft.better);
  const worse = integer(draft.worse);
  if (allowance === undefined || better === undefined || worse === undefined) return null;
  const rows = [];
  for (const row of draft.rows) {
    const points = integer(row.points);
    if (points === undefined) return null;
    rows.push({ scoreToPar: row.scoreToPar, points });
  }
  const common = {
    id: draft.id, name: draft.name.trim(), preset: draft.preset, basis: draft.basis,
    handicapAllowancePercent: allowance,
    points: { rows, betterScorePoints: better, worseScorePoints: worse },
  };
  const game = draft.format ? {
    ...common, basis: 'net', format: draft.format,
    teams: (draft.teams ?? []).map((team) => ({ ...team, name: team.name.trim() })),
  } : common;
  if (draft.format && teamDraftFeedback(draft, playerIds)) return null;
  return isRoundGameDefinition(game) && gameTeamsMatchRoster(game, playerIds) ? game : null;
}

export function replaceGame(
  base: readonly RoundGameDefinition[], game: RoundGameDefinition,
): readonly RoundGameDefinition[] | null {
  const games = base.some((candidate) => candidate.id === game.id)
    ? base.map((candidate) => candidate.id === game.id ? game : candidate)
    : [...base, game];
  return isRoundGameDefinitions(games) ? games : null;
}

export function addBand(draft: GameDraft, side: 'better' | 'worse'): GameDraft {
  if (draft.rows.length >= maximumPointsRows) return draft;
  const edge = side === 'better' ? draft.rows[0] : draft.rows.at(-1);
  if (!edge) return draft;
  const scoreToPar = edge.scoreToPar + (side === 'better' ? -1 : 1);
  if (!Number.isSafeInteger(scoreToPar)) return draft;
  const row = { scoreToPar, points: side === 'better' ? draft.better : draft.worse };
  return { ...draft, rows: side === 'better' ? [row, ...draft.rows] : [...draft.rows, row] };
}
