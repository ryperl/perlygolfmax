import { isRoundGameDefinition, isRoundGameDefinitions } from '../../contracts/games';
import { isNassauDefinition } from '../../contracts/nassau';
import { isWolfDefinition } from '../../contracts/wolf';
import type { GameTeam, RoundGameDefinition, StablefordPreset, CompetitionTeamFormat } from '../../domain/games';
import { defaultHandicapAllowancePercent, defaultTeamHandicapAllowancePercent, gameTeamsMatchRoster, isStablefordGame, isTeamGameDefinition, maximumPointsRows, teamSize } from '../../domain/games';
import { stablefordPoints } from '../../domain/stableford';
import type { NassauSide, NassauVariant } from '../../domain/nassau';
import type { DotsGameDefinition, DotsSpecialSelection } from '../../domain/dots';
import { isDotsDefinition } from '../../contracts/dots';
import { moneyText, parseMoney } from '../../domain/money';

export interface GameDraft {
  readonly kind?: 'stableford' | 'ball-drop' | 'skins' | 'churchy' | 'stroke-play' | 'wolf' | 'nassau' | 'dots';
  readonly wolfVersion?: 1 | 2;
  readonly stake?: string;
  readonly dotsMode?: DotsGameDefinition['mode'];
  readonly dotsPlayers?: readonly string[];
  readonly dotsPlayerIds?: readonly string[];
  readonly dotsSpecials?: readonly DotsSpecialSelection[];
  readonly linkedGameId?: string;
  readonly groupNumber?: number;
  readonly wolfPlayers?: readonly string[];
  readonly allowPig?: boolean;
  readonly nassauVariant?: NassauVariant;
  readonly nassauSides?: readonly NassauSide[];
  readonly nassauStakes?: readonly string[];
  readonly automaticPresses?: boolean;
  readonly churchyGroup?: number;
  readonly churchyPlayers?: readonly string[];
  readonly amountPerDotMinor?: string;
  readonly carryovers?: boolean;
  readonly id: string;
  readonly name: string;
  readonly preset: StablefordPreset;
  readonly basis: 'gross' | 'net';
  readonly allowance: string;
  readonly rows: readonly { readonly scoreToPar: number; readonly points: string }[];
  readonly better: string;
  readonly worse: string;
  readonly format?: CompetitionTeamFormat;
  readonly teams?: readonly GameTeam[] | undefined;
  readonly allowanceConfigured?: boolean;
  readonly assignmentsCleared?: boolean;
}

export function draftFromGame(game: RoundGameDefinition): GameDraft {
  if (game.kind === 'dots') return { ...newGameDraft(), id: game.id, name: game.name, kind: 'dots',
    groupNumber: game.groupNumber, dotsMode: game.mode, dotsPlayers: game.mode === 'fixed' ? game.partnerIds : game.playerIds, dotsPlayerIds: game.playerIds,
    dotsSpecials: game.specials, ...(game.mode === 'linked' ? { linkedGameId: game.linkedGameId }
      : { stake: game.stakeMinor === null ? '' : moneyText(game.stakeMinor) }) };
  if (game.kind === 'wolf') return { ...newGameDraft(), id: game.id, name: game.name, kind: game.kind,
    basis: game.basis, groupNumber: game.groupNumber, wolfPlayers: game.playerIds, allowPig: game.allowPig,
    wolfVersion: game.version, stake: game.stakeMinor == null ? '' : moneyText(game.stakeMinor) };
  if (game.kind === 'nassau') return { ...newGameDraft(), id: game.id, name: game.name, kind: game.kind,
    basis: game.basis, groupNumber: game.groupNumber, nassauVariant: game.variant, nassauSides: game.sides,
    nassauStakes: [moneyText(game.stakes.frontMinor), moneyText(game.stakes.backMinor), moneyText(game.stakes.overallMinor)],
    automaticPresses: game.automaticPresses };
  if (game.kind === 'churchy') return { ...newGameDraft(), id: game.id, name: game.name, kind: 'churchy', basis: 'net',
    churchyGroup: game.groupNumber, churchyPlayers: game.playerIds, amountPerDotMinor: moneyText(game.amountPerDotMinor) };
  if (!isStablefordGame(game)) return {
    ...newGameDraft(), id: game.id, name: game.name, kind: game.kind, basis: game.basis,
    allowance: '100', allowanceConfigured: true,
    ...(game.kind === 'skins' ? { carryovers: game.carryovers } : game.kind === 'ball-drop' ? { format: game.format, teams: game.teams } : {}),
  };
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

function emptyTeams(format: CompetitionTeamFormat, rosterCount: number): readonly GameTeam[] {
  return Array.from({ length: rosterCount % teamSize(format) === 0 ? rosterCount / teamSize(format) : 0 }, (_, index) => ({
    id: crypto.randomUUID(), name: `Team ${String(index + 1)}`,
    playerIds: Array.from({ length: teamSize(format) }, () => ''),
  }));
}

export function resetTeamAssignments(draft: GameDraft, rosterCount: number): GameDraft {
  return draft.format ? { ...draft, teams: emptyTeams(draft.format, rosterCount), assignmentsCleared: false } : draft;
}

export function setFormat(draft: GameDraft, format: CompetitionTeamFormat | undefined, rosterCount: number): GameDraft {
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
    basis: format === 'ball-drop-two-gross' ? 'gross' : format === undefined ? draft.basis : 'net',
    allowance: draft.allowanceConfigured === false
      ? String(format === undefined ? defaultHandicapAllowancePercent : defaultTeamHandicapAllowancePercent) : draft.allowance,
    assignmentsCleared: changedSize,
  };
}

export function setGameKind(draft: GameDraft, kind: NonNullable<GameDraft['kind']>, rosterCount: number): GameDraft {
  if ((draft.kind ?? 'stableford') === kind) return draft;
  const reset = setFormat(draft, undefined, rosterCount);
  if (kind === 'wolf') return { ...reset, kind, name: 'Wolf', basis: 'net', wolfPlayers: [], allowPig: false, wolfVersion: 2, stake: '' };
  if (kind === 'dots') return { ...reset, kind, name: 'Dots', dotsMode: 'individual', dotsPlayers: [], dotsSpecials: [], stake: '' };
  if (kind === 'nassau') return setNassauVariant({ ...reset, kind, name: 'Nassau', basis: 'net',
    nassauStakes: ['', '', ''], automaticPresses: false }, 'singles');
  if (kind === 'churchy') return { ...reset, kind, name: 'Churchy Game', basis: 'net', amountPerDotMinor: '',
    churchyPlayers: [] };
  return kind === 'ball-drop'
    ? { ...setFormat(reset, 'ball-drop-net-gross', rosterCount), kind, name: 'Ball Drop', allowance: '100' }
    : { ...reset, kind, name: kind === 'skins' ? 'Skins' : kind === 'stroke-play' ? 'Stroke Play' : 'Standard Stableford',
      ...(kind === 'skins' ? { carryovers: false, allowance: '100' } : {}) };
}

export function setNassauVariant(draft: GameDraft, variant: NassauVariant): GameDraft {
  const sizes = variant === 'singles' ? [1, 1] : variant === 'three-way' ? [1, 1, 1]
    : variant === 'one-v-two' ? [1, 2] : [2, 2];
  return { ...draft, nassauVariant: variant, nassauSides: sizes.map((size, index) => ({
    id: crypto.randomUUID(), name: `Side ${String.fromCharCode(65 + index)}`, playerIds: Array.from({ length: size }, () => ''),
  })) };
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
  if (draft.kind === 'dots') {
    const stake = draft.stake?.trim() ? parseMoney(draft.stake) : null;
    if (draft.stake?.trim() && stake === null) return null;
    const common = { id: draft.id, name: draft.name.trim(), kind: 'dots', version: 1,
      groupNumber: draft.groupNumber, playerIds: draft.dotsPlayerIds ?? draft.dotsPlayers, specials: draft.dotsSpecials ?? [] };
    const game = draft.dotsMode === 'linked' ? { ...common, mode: 'linked', linkedGameId: draft.linkedGameId }
      : draft.dotsMode === 'fixed' ? { ...common, mode: 'fixed', partnerIds: draft.dotsPlayers, stakeMinor: stake }
        : { ...common, mode: 'individual', stakeMinor: stake };
    return isDotsDefinition(game) && game.playerIds.every((id) => playerIds.includes(id)) ? game : null;
  }
  if (draft.kind === 'wolf' || draft.kind === 'nassau') {
    const stake = draft.stake?.trim() ? parseMoney(draft.stake) : null;
    if (draft.kind === 'wolf' && draft.wolfVersion === 2 && draft.stake?.trim() && stake === null) return null;
    const game = draft.kind === 'wolf'
      ? { id: draft.id, name: draft.name.trim(), kind: draft.kind, version: draft.wolfVersion ?? 1, basis: draft.basis,
        ...(draft.wolfVersion === 2 ? { stakeMinor: stake } : {}),
        groupNumber: draft.groupNumber, playerIds: draft.wolfPlayers, allowPig: draft.allowPig ?? false }
      : { id: draft.id, name: draft.name.trim(), kind: draft.kind, version: 1, basis: draft.basis,
        groupNumber: draft.groupNumber, variant: draft.nassauVariant, sides: draft.nassauSides,
        stakes: { currency: 'USD', frontMinor: parseMoney(draft.nassauStakes?.[0] ?? ''),
          backMinor: parseMoney(draft.nassauStakes?.[1] ?? ''), overallMinor: parseMoney(draft.nassauStakes?.[2] ?? '') },
        automaticPresses: draft.automaticPresses ?? false };
    if (game.kind === 'wolf') return isWolfDefinition(game) && game.playerIds.every((id) => playerIds.includes(id)) ? game : null;
    return isNassauDefinition(game) && game.sides.flatMap((side) => side.playerIds).every((id) => playerIds.includes(id)) ? game : null;
  }
  if (draft.kind === 'stroke-play') {
    const game = { id: draft.id, name: draft.name.trim(), kind: draft.kind, version: 1, basis: draft.basis };
    return isRoundGameDefinition(game) ? game : null;
  }
  if (draft.kind === 'churchy') {
    const game = { id: draft.id, name: 'Churchy Game', kind: 'churchy', version: 1, basis: 'net',
      groupNumber: draft.churchyGroup, playerIds: draft.churchyPlayers, currency: 'USD',
      amountPerDotMinor: parseMoney(draft.amountPerDotMinor ?? '') };
    return isRoundGameDefinition(game)
      && game.playerIds.every((id) => playerIds.includes(id)) ? game : null;
  }
  if (draft.kind === 'ball-drop' || draft.kind === 'skins') {
    const game = draft.kind === 'skins'
      ? { id: draft.id, name: draft.name.trim(), kind: draft.kind, version: 1, basis: draft.basis, carryovers: draft.carryovers ?? false }
      : { id: draft.id, name: draft.name.trim(), kind: draft.kind, version: 1,
        basis: draft.format === 'ball-drop-two-gross' ? 'gross' : 'net', format: draft.format,
        teams: (draft.teams ?? []).map((team) => ({ ...team, name: team.name.trim() })) };
    return isRoundGameDefinition(game) && gameTeamsMatchRoster(game, playerIds) ? game : null;
  }
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
