import { isRoundGameDefinition, isRoundGameDefinitions } from '../../contracts/games';
import { isPressMatchDefinition } from '../../contracts/nassau';
import { isWolfDefinition } from '../../contracts/wolf';
import type { GameTeam, RoundGameDefinition, StablefordPreset, CompetitionTeamFormat } from '../../domain/games';
import { defaultHandicapAllowancePercent, defaultTeamHandicapAllowancePercent, gameTeamsMatchRoster, isStablefordGame, isTeamGameDefinition, maximumPointsRows, teamSize } from '../../domain/games';
import { stablefordPoints } from '../../domain/stableford';
import type { NassauSide, NassauVariant } from '../../domain/nassau';
import type { DotsGameDefinition, DotsSpecialKind, DotsSpecialSelection } from '../../domain/dots';
import { isDotsDefinition } from '../../contracts/dots';
import { moneyText, parseMoney } from '../../domain/money';
import type { ChurchySpecialKey } from '../../domain/churchy';
import { defaultChurchySpecials, defaultChurchySpecialSelections } from '../../domain/churchy';
import type { RoundGroup } from '../../domain/setup';
import type { GameHandicapRule } from '../../domain/game-handicaps';

export interface GameDraft {
  readonly handicapRule?: GameHandicapRule;
  readonly carryOrder?: 'shared-group-v1';
  readonly playOrder?: 'shared-group-v1';
  readonly kind?: 'stableford' | 'ball-drop' | 'skins' | 'churchy' | 'stroke-play' | 'wolf' | 'nassau' | 'match-play' | 'dots';
  readonly wolfVersion?: 1 | 2;
  readonly stake?: string;
  readonly dotsMode?: DotsGameDefinition['mode'];
  readonly dotsVersion?: 1 | 2 | 3;
  readonly dotsOrderMode?: 'tee-flip' | 'approach';
  readonly dotsRotationHoles?: 3 | 6;
  readonly dotsHighLow?: boolean;
  readonly dotsHighLowHandicapRule?: GameHandicapRule;
  readonly dotsPlayers?: readonly string[];
  readonly dotsPlayerIds?: readonly string[];
  readonly dotsSpecials?: readonly DotsSpecialSelection[];
  readonly dotsSweepRule?: 'manual-v1';
  readonly dotsLegacySweep?: boolean;
  readonly wolfHighLowSweep?: boolean;
  readonly linkedGameId?: string;
  readonly groupNumber?: number;
  readonly wolfPlayers?: readonly string[];
  readonly wolfOrderMode?: 'first-tee-v1';
  readonly allowPig?: boolean;
  readonly nassauVariant?: NassauVariant;
  readonly nassauSides?: readonly NassauSide[];
  readonly nassauStakes?: readonly string[];
  readonly automaticPresses?: boolean;
  readonly churchyGroup?: number;
  readonly churchyPlayers?: readonly string[];
  readonly churchyVersion?: 1 | 2 | 3;
  readonly churchySpecials?: readonly ChurchySpecialKey[];
  readonly churchyOrderMode?: 'tee' | 'approach';
  readonly churchySpecialSelections?: readonly DotsSpecialSelection[];
  readonly amountPerDotMinor?: string;
  readonly carryovers?: boolean;
  readonly id: string;
  readonly name: string;
  readonly preserveName?: boolean;
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
  return { ...draftFromDefinition(game), preserveName: true,
    ...('handicapRule' in game ? { handicapRule: game.handicapRule } : {}),
    ...(game.kind === 'skins' && game.carryOrder ? { carryOrder: game.carryOrder } : {}),
    ...(game.kind === 'nassau' && game.playOrder ? { playOrder: game.playOrder } : {}) };
}

function draftFromDefinition(game: RoundGameDefinition): GameDraft {
  if (game.kind === 'dots') return { ...newGameDraft(), id: game.id, name: game.name, kind: 'dots',
    dotsVersion: game.version, ...(game.mode === 'rotating' ? { dotsRotationHoles: game.rotationHoles,
      ...(game.version === 3 ? { dotsOrderMode: game.orderMode } : {}),
      ...(game.highLow ? { dotsHighLow: true, dotsHighLowHandicapRule: game.highLow.handicapRule } : {}) } : {}),
    groupNumber: game.groupNumber, dotsMode: game.mode, dotsPlayers: game.mode === 'fixed' ? game.partnerIds : game.playerIds, dotsPlayerIds: game.playerIds,
    dotsSpecials: game.specials, ...(game.sweepRule ? { dotsSweepRule: game.sweepRule } : {}),
    dotsLegacySweep: game.sweepRule === undefined && game.specials.some((special) => special.kind === 'sweep'),
    ...(game.mode === 'linked' ? { linkedGameId: game.linkedGameId }
      : { stake: game.stakeMinor === null ? '' : moneyText(game.stakeMinor) }) };
  if (game.kind === 'wolf') return { ...newGameDraft(), id: game.id, name: game.name, kind: game.kind,
    basis: game.basis, groupNumber: game.groupNumber, wolfPlayers: game.playerIds, allowPig: game.allowPig,
    wolfVersion: game.version, wolfHighLowSweep: game.version === 2 && game.highLowSweep === true,
    ...(game.orderMode ? { wolfOrderMode: game.orderMode } : {}),
    stake: game.stakeMinor == null ? '' : moneyText(game.stakeMinor) };
  if (game.kind === 'nassau' || game.kind === 'match-play') return { ...newGameDraft(), id: game.id, name: game.name, kind: game.kind,
    basis: game.basis, groupNumber: game.groupNumber, nassauVariant: game.variant, nassauSides: game.sides,
    nassauStakes: [moneyText(game.stakes.frontMinor), moneyText(game.stakes.backMinor), moneyText(game.stakes.overallMinor)],
    automaticPresses: game.automaticPresses };
  if (game.kind === 'churchy') return { ...newGameDraft(), id: game.id, name: game.name, kind: 'churchy', basis: 'net',
    churchyGroup: game.groupNumber, churchyPlayers: game.playerIds, amountPerDotMinor: moneyText(game.amountPerDotMinor),
    churchyVersion: game.version, ...(game.version === 2 ? { churchySpecials: game.enabledSpecials }
      : game.version === 3 ? { churchyOrderMode: game.orderMode, churchySpecialSelections: game.specials.map((special) => ({ ...special })) } : {}) };
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

export function newGameDraft(explicitRules = false): GameDraft {
  return { ...draftFromGame({
    id: crypto.randomUUID(), name: 'Stableford', preset: 'standard', basis: 'gross',
    handicapAllowancePercent: defaultHandicapAllowancePercent, points: stablefordPoints('standard'),
  }), allowanceConfigured: false, preserveName: false,
    ...(explicitRules ? { handicapRule: 'full-course-v1' as const } : {}) };
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
    ...(format === 'ball-drop-two-gross' && draft.handicapRule === 'group-low-v1'
      ? { handicapRule: 'full-course-v1' as const } : {}),
    allowance: draft.allowanceConfigured === false
      ? String(format === undefined ? defaultHandicapAllowancePercent : defaultTeamHandicapAllowancePercent) : draft.allowance,
    assignmentsCleared: changedSize,
  };
}

export function setGameKind(draft: GameDraft, kind: NonNullable<GameDraft['kind']>, rosterCount: number): GameDraft {
  if ((draft.kind ?? 'stableford') === kind) return draft;
  const names = { stableford: 'Stableford', 'ball-drop': 'Ball Drop', skins: 'Skins', 'stroke-play': 'Stroke Play',
    wolf: 'Wolf', dots: 'Dots', nassau: 'Nassau', 'match-play': 'Match Play', churchy: 'Churchie' };
  const name = draft.preserveName || draft.name !== names[draft.kind ?? 'stableford'] ? draft.name : names[kind];
  const reset = { ...setFormat(draft, undefined, rosterCount), name };
  if (kind === 'wolf') return { ...reset, kind, basis: 'net', wolfPlayers: [], allowPig: false, wolfVersion: 2, wolfHighLowSweep: false, wolfOrderMode: 'first-tee-v1', stake: '' };
  if (kind === 'dots') {
    const { dotsSweepRule, dotsLegacySweep, dotsHighLow, dotsHighLowHandicapRule, dotsVersion, dotsOrderMode, ...fresh } = reset;
    void dotsSweepRule; void dotsLegacySweep; void dotsHighLow; void dotsHighLowHandicapRule; void dotsVersion; void dotsOrderMode;
    return { ...fresh, kind, dotsMode: 'individual', dotsPlayers: [], dotsSpecials: [], stake: '' };
  }
  if (kind === 'nassau') return setNassauVariant({ ...reset, kind, basis: 'net',
    ...(draft.handicapRule ? { playOrder: 'shared-group-v1' as const } : {}),
    nassauStakes: ['', '', ''], automaticPresses: false }, 'singles');
  if (kind === 'match-play') return setNassauVariant({ ...reset, kind, basis: 'net',
    nassauStakes: ['0', '0', ''], automaticPresses: false }, 'singles');
  if (kind === 'churchy') return { ...reset, kind, basis: 'net', amountPerDotMinor: '',
    churchyPlayers: [], churchyVersion: 3, churchyOrderMode: 'approach',
    churchySpecialSelections: defaultChurchySpecialSelections.map((special) => ({ ...special })) };
  return kind === 'ball-drop'
    ? { ...setFormat(reset, 'ball-drop-net-gross', rosterCount), kind, allowance: '100' }
    : { ...reset, kind,
      ...(kind === 'skins' ? { carryovers: false, allowance: '100',
        ...(draft.handicapRule ? { carryOrder: 'shared-group-v1' as const } : {}) } : {}) };
}

export function defaultGameGroup(
  draft: GameDraft, groups: readonly RoundGroup[], dotsPlayerCounts: readonly number[] = [4],
  preferredGroupNumber = draft.kind === 'churchy' ? draft.churchyGroup ?? draft.groupNumber : draft.groupNumber ?? draft.churchyGroup,
): GameDraft {
  if (draft.kind !== 'churchy' && draft.kind !== 'wolf' && draft.kind !== 'dots'
    && draft.kind !== 'nassau' && draft.kind !== 'match-play') return draft;
  const eligible = groups.filter((group) => draft.kind === 'churchy' || draft.kind === 'wolf'
    ? group.playerIds.length === 4 : draft.kind === 'dots'
      ? group.playerIds.length >= 1 && group.playerIds.length <= 4 && dotsPlayerCounts.includes(group.playerIds.length)
      : group.playerIds.length >= 2);
  const group = eligible.find((group) => group.number === preferredGroupNumber) ?? eligible[0];
  if (!group) return draft;
  if (draft.kind === 'churchy') return { ...draft, churchyGroup: group.number, churchyPlayers: group.playerIds };
  if (draft.kind === 'wolf') return { ...draft, groupNumber: group.number, wolfPlayers: group.playerIds };
  if (draft.kind === 'dots') return { ...draft, groupNumber: group.number, dotsPlayers: group.playerIds, dotsPlayerIds: group.playerIds };
  return { ...draft, groupNumber: group.number };
}

export function upgradeChurchyDraft(draft: GameDraft, startingHole = 1): GameDraft {
  if (draft.kind !== 'churchy' || draft.churchyVersion !== 2) return draft;
  const enabled = new Set<DotsSpecialKind>((draft.churchySpecials ?? defaultChurchySpecials)
    .map((kind) => kind === 'sticky' ? 'dime' : kind));
  const [a, b, c, d] = draft.churchyPlayers ?? [];
  const block = Math.floor((startingHole - 1) / 3) % 3;
  const order = a && b && c && d ? block === 0 ? [a, d, c, b] : block === 1 ? [a, b, d, c] : [a, c, b, d]
    : draft.churchyPlayers ?? [];
  return { ...draft, churchyVersion: 3, churchyOrderMode: 'tee',
    churchyPlayers: order,
    churchySpecialSelections: defaultChurchySpecialSelections.filter((special) => special.kind === 'other'
      || enabled.has(special.kind)).map((special) => ({ ...special })) };
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
  const rule = draft.handicapRule ? { handicapRule: draft.handicapRule } : {};
  if (draft.kind === 'dots') {
    const stake = draft.stake?.trim() ? parseMoney(draft.stake) : null;
    if (draft.stake?.trim() && stake === null) return null;
    if (draft.dotsVersion === 1 && draft.dotsMode === 'rotating' || (draft.dotsVersion === 2 || draft.dotsVersion === 3) && draft.dotsMode !== 'rotating') return null;
    const version = draft.dotsMode === 'rotating' ? draft.dotsVersion ?? 2 : 1;
    const common = { id: draft.id, name: draft.name.trim(), kind: 'dots', version,
      groupNumber: draft.groupNumber, playerIds: draft.dotsPlayerIds ?? draft.dotsPlayers, specials: draft.dotsSpecials ?? [],
      ...(draft.dotsSweepRule === 'manual-v1' && draft.dotsSpecials?.some((special) => special.kind === 'sweep')
        ? { sweepRule: 'manual-v1' } : {}) };
    if (draft.dotsHighLow && (draft.dotsMode !== 'rotating' || version !== 3 && (draft.dotsRotationHoles ?? 3) !== 3)) return null;
    const game = draft.dotsMode === 'rotating' ? { ...common, mode: 'rotating', rotationHoles: draft.dotsRotationHoles ?? 3, stakeMinor: stake,
      ...(version === 3 ? { orderMode: draft.dotsOrderMode ?? 'tee-flip' } : {}),
      ...(draft.dotsHighLow ? { highLow: { version: version === 3 ? 2 : 1, handicapRule: draft.dotsHighLowHandicapRule ?? 'full-course-v1' } } : {}) }
      : draft.dotsMode === 'linked' ? { ...common, mode: 'linked', linkedGameId: draft.linkedGameId }
      : draft.dotsMode === 'fixed' ? { ...common, mode: 'fixed', partnerIds: draft.dotsPlayers, stakeMinor: stake }
        : { ...common, mode: 'individual', stakeMinor: stake };
    return isDotsDefinition(game) && game.playerIds.every((id) => playerIds.includes(id)) ? game : null;
  }
  if (draft.kind === 'wolf' || draft.kind === 'nassau' || draft.kind === 'match-play') {
    if (draft.kind === 'wolf' && draft.wolfHighLowSweep && draft.wolfVersion !== 2) return null;
    const stake = draft.stake?.trim() ? parseMoney(draft.stake) : null;
    if (draft.kind === 'wolf' && draft.wolfVersion === 2 && draft.stake?.trim() && stake === null) return null;
    const game = draft.kind === 'wolf'
      ? { ...rule, id: draft.id, name: draft.name.trim(), kind: draft.kind, version: draft.wolfVersion ?? 1, basis: draft.basis,
        ...(draft.wolfOrderMode ? { orderMode: draft.wolfOrderMode } : {}),
        ...(draft.wolfVersion === 2 ? { stakeMinor: stake, ...(draft.wolfHighLowSweep ? { highLowSweep: true } : {}) } : {}),
        groupNumber: draft.groupNumber, playerIds: draft.wolfPlayers, allowPig: draft.allowPig ?? false }
      : { ...rule, id: draft.id, name: draft.name.trim(), kind: draft.kind, version: 1, basis: draft.basis,
        ...(draft.kind === 'nassau' && draft.playOrder ? { playOrder: draft.playOrder } : {}),
        groupNumber: draft.groupNumber, variant: draft.nassauVariant, sides: draft.nassauSides,
        stakes: { currency: 'USD', frontMinor: parseMoney(draft.nassauStakes?.[0] ?? ''),
          backMinor: parseMoney(draft.nassauStakes?.[1] ?? ''), overallMinor: parseMoney(draft.nassauStakes?.[2] ?? '') },
        automaticPresses: draft.automaticPresses ?? false };
    if (game.kind === 'wolf') return isWolfDefinition(game) && game.playerIds.every((id) => playerIds.includes(id)) ? game : null;
    return isPressMatchDefinition(game) && game.sides.flatMap((side) => side.playerIds).every((id) => playerIds.includes(id)) ? game : null;
  }
  if (draft.kind === 'stroke-play') {
    const game = { ...rule, id: draft.id, name: draft.name.trim(), kind: draft.kind, version: 1, basis: draft.basis };
    return isRoundGameDefinition(game) ? game : null;
  }
  if (draft.kind === 'churchy') {
    const game = { ...rule, id: draft.id, name: draft.name.trim(), kind: 'churchy', version: draft.churchyVersion ?? 1, basis: 'net',
      groupNumber: draft.churchyGroup, playerIds: draft.churchyPlayers, currency: 'USD',
      amountPerDotMinor: draft.churchyVersion === 3 && !draft.amountPerDotMinor?.trim() ? 0 : parseMoney(draft.amountPerDotMinor ?? ''),
      ...(draft.churchyVersion === 2 ? { enabledSpecials: draft.churchySpecials ?? defaultChurchySpecials }
        : draft.churchyVersion === 3 ? { orderMode: draft.churchyOrderMode ?? 'approach',
          specials: draft.churchySpecialSelections ?? defaultChurchySpecialSelections } : {}) };
    return isRoundGameDefinition(game) && game.kind === 'churchy'
      && game.playerIds.every((id) => playerIds.includes(id)) ? game : null;
  }
  if (draft.kind === 'ball-drop' || draft.kind === 'skins') {
    const game = draft.kind === 'skins'
      ? { ...rule, id: draft.id, name: draft.name.trim(), kind: draft.kind, version: 1, basis: draft.basis, carryovers: draft.carryovers ?? false,
        ...(draft.carryOrder ? { carryOrder: draft.carryOrder } : {}) }
      : { ...rule, id: draft.id, name: draft.name.trim(), kind: draft.kind, version: 1,
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
    ...rule, id: draft.id, name: draft.name.trim(), preset: draft.preset, basis: draft.basis,
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

/**
 * Explains why `buildGame` rejects a Dots draft, in the order a scorer would fix it.
 * Returns null when no specific reason is known; callers then keep their general guidance.
 */
export function dotsDraftProblem(draft: GameDraft, playerIds: readonly string[]): string | null {
  if (draft.kind !== 'dots') return null;
  const name = draft.name.trim();
  if (!name) return 'Enter a game name.';
  if (draft.name.length > 256) return 'Use a game name of 256 characters or fewer.';
  const mode = draft.dotsMode ?? 'individual';
  const members = draft.dotsPlayerIds ?? draft.dotsPlayers ?? [];
  if (draft.groupNumber === undefined || members.length === 0) return 'Choose a saved playing group.';
  if (members.some((id) => !playerIds.includes(id)) || new Set(members).size !== members.length) {
    return 'This playing group no longer matches the round. Choose the saved playing group again.';
  }
  if (mode !== 'individual' && members.length !== 4) return 'Partner and rotating Dots need a saved foursome. Choose Individual for smaller groups.';
  if (draft.dotsVersion === 1 && mode === 'rotating' || (draft.dotsVersion === 2 || draft.dotsVersion === 3) && mode !== 'rotating') {
    return 'Saved Dots rules cannot change mode. Keep the saved mode, or create a separate Dots game before scoring.';
  }
  const specials = draft.dotsSpecials ?? [];
  if (specials.some((special) => !Number.isSafeInteger(special.units) || special.units < 1)) {
    return 'Give each selected special a whole number of dots, 1 or more.';
  }
  if (new Set(specials.map((special) => special.kind)).size !== specials.length) return 'Each special can be selected only once.';
  if (mode === 'individual' && specials.some((special) => special.kind === 'assassin')) {
    return 'Assassin needs partners. Remove it, or choose a partner or rotating mode.';
  }
  if (mode !== 'linked' && specials.some((special) => special.kind === 'sweep') && draft.dotsSweepRule !== 'manual-v1') {
    return 'This Sweep needs a linked Wolf game. Use manual Sweep, or remove it.';
  }
  if (draft.dotsHighLow && mode === 'rotating' && draft.dotsVersion !== 3 && (draft.dotsRotationHoles ?? 3) !== 3) {
    return 'Under these saved rules, Net High/Low is available only for Modified Sixes (three-hole partners).';
  }
  if (mode === 'linked') return draft.linkedGameId ? null : 'Choose the earned Wolf game to link.';
  const stake = draft.stake?.trim() ?? '';
  const rate = stake ? parseMoney(stake) : null;
  if (stake && rate === null) return 'Enter the USD rate as dollars and cents, like 1 or .50, or leave it blank for points only.';
  if (mode === 'individual' && members.length === 1 && rate !== null && rate !== 0) return 'Solo Dots is stats only. Clear the USD rate.';
  if (mode === 'fixed') {
    const partners = draft.dotsPlayers ?? [];
    if (partners.length !== 4 || new Set(partners).size !== 4 || partners.some((id) => !members.includes(id))) {
      return 'Place all four golfers on the two fixed teams.';
    }
  }
  return null;
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
