import type { Scorecard } from '../../domain/scoring';
import type { DotAward } from '../../domain/dot-context';
import type { RoundGameResult } from '../../domain/games';
import type { WolfGameDefinition } from '../../domain/wolf';
import type { DotsGameDefinition } from '../../domain/dots';
import type { ScorecardGame } from './scorecard-presentation';
import { dotsSpecialCatalog } from '../../domain/dots';

type BreakdownStatus = 'complete' | 'pending' | 'unavailable';
type BreakdownLane = 'base' | 'specials';
type WolfMode = 'partner' | 'blind' | 'pig';
type Players = readonly Pick<Scorecard, 'playerId' | 'displayName'>[];

/** One awarded line in a hole breakdown, with the golfer who earned it when the award is shared. */
export interface DotHoleBreakdownEntry {
  readonly label: string;
  readonly dots: number;
  readonly source: string | null;
  readonly lane: BreakdownLane;
}

/**
 * A saved per-hole dot breakdown for one golfer, built only from already-loaded results.
 * Base, specials and total are null unless every input is saved and the parts add up to the total.
 */
export interface DotHoleBreakdown {
  readonly status: BreakdownStatus;
  readonly base: number | null;
  readonly specials: number | null;
  readonly total: number | null;
  readonly entries: readonly DotHoleBreakdownEntry[];
  readonly context: string;
}

interface Draft {
  status: BreakdownStatus;
  total: number | null;
  context: string;
  readonly entries: DotHoleBreakdownEntry[];
}

interface HoleTarget {
  readonly playerId: string;
  readonly number: number;
  readonly players: Players;
}

const awardLabels: Readonly<Record<string, string>> = {
  'wolf-high': 'High',
  'wolf-low': 'Low',
  'wolf-solo': 'Solo Wolf',
  'wolf-sweep': 'High/Low Sweep',
  high: 'Net High',
  low: 'Net Low',
  'high-low-sweep': 'High/Low Sweep',
  'category-sweep': 'Category Sweep',
};

/** Sums with BigInt so an overflowing total becomes unavailable instead of an imprecise number. */
function exactSum(values: readonly number[]): number | null {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  const inRange = total >= BigInt(Number.MIN_SAFE_INTEGER) && total <= BigInt(Number.MAX_SAFE_INTEGER);
  return inRange ? Number(total) : null;
}

function awardLabel(kind: string, mode?: WolfMode): string {
  // A solo Wolf's low-ball award is the Blind Wolf or PIG declaration, not an ordinary Low.
  if (kind === 'wolf-low' && mode === 'pig') return 'PIG';
  if (kind === 'wolf-low' && mode === 'blind') return 'Blind Wolf';
  const named = awardLabels[kind];
  if (named) return named;
  return dotsSpecialCatalog.find((special) => special.kind === kind)?.label ?? kind;
}

function golferName(players: Players, playerId: string): string {
  return players.find((player) => player.playerId === playerId)?.displayName ?? 'Golfer unavailable';
}

function toStatus(status: string | undefined): BreakdownStatus {
  if (status === 'complete') return 'complete';
  if (status === 'pending') return 'pending';
  return 'unavailable';
}

/** Wolf holes report a settled outcome such as won or tied; anything not pending or unavailable is complete. */
function wolfHoleStatus(status: string | undefined): BreakdownStatus {
  if (status === undefined || status === 'unavailable') return 'unavailable';
  if (status === 'pending') return 'pending';
  return 'complete';
}

/** The weakest of two statuses: unavailable beats pending, pending beats complete. */
function weakerStatus(a: BreakdownStatus, b: BreakdownStatus): BreakdownStatus {
  if (a === 'unavailable' || b === 'unavailable') return 'unavailable';
  if (a === 'pending' || b === 'pending') return 'pending';
  return 'complete';
}

function addAwards(draft: Draft, target: HoleTarget, awards: readonly DotAward[], lane: BreakdownLane, mode?: WolfMode) {
  for (const award of awards) {
    if (award.number !== target.number || !award.recipientIds.includes(target.playerId)) continue;
    const missedCall = award.reason.includes('call: failure') ? ' · missed call' : '';
    const source = award.earnedBy ? golferName(target.players, award.earnedBy) : null;
    draft.entries.push({ label: `${awardLabel(award.kind, mode)}${missedCall}`, dots: award.dots, source, lane });
  }
}

/** A linked Dots game shows its base only from a version-2 Wolf; other links have no per-hole base dots. */
function addLinkedWolfBase(draft: Draft, target: HoleTarget, game: ScorecardGame) {
  const base = game.linkedBase;
  if (base?.definition.kind !== 'wolf' || base.definition.version !== 2) {
    draft.status = 'unavailable';
    draft.total = null;
    draft.context = 'Linked base results unavailable';
    return;
  }
  const wolf = base.result?.wolf;
  const baseHole = wolf?.holes.find((hole) => hole.number === target.number);
  addAwards(draft, target, wolf?.awards ?? [], 'base', baseHole?.mode ?? undefined);
  draft.status = weakerStatus(draft.status, wolfHoleStatus(baseHole?.status));
  const baseDots = baseHole?.transfers.find((point) => point.playerId === target.playerId)?.dots;
  draft.total = draft.total !== null && baseDots !== undefined ? exactSum([draft.total, baseDots]) : null;
  draft.context = `${base.definition.name} + ${game.definition.name} · Cell shows specials; breakdown includes linked base`;
}

/**
 * Rotating Sixes and Modified Sixes may score net High/Low beside the specials. The scorecard cell shows
 * both together, so the breakdown counts High/Low (and its automatic Sweep) as the base lane.
 */
function addRotatingHighLowBase(draft: Draft, target: HoleTarget, result: RoundGameResult | undefined) {
  const highLow = result?.dotsHighLow;
  if (!highLow) {
    draft.status = 'unavailable';
    draft.total = null;
    return;
  }
  const baseHole = highLow.holes.find((hole) => hole.number === target.number);
  addAwards(draft, target, highLow.awards, 'base');
  draft.status = baseHole ? weakerStatus(draft.status, toStatus(baseHole.status)) : 'unavailable';
  const basePlayer = highLow.players.find((player) => player.playerId === target.playerId);
  const baseDots = basePlayer?.holes.find((hole) => hole.number === target.number)?.points ?? null;
  draft.total = draft.total !== null && baseDots !== null ? exactSum([draft.total, baseDots]) : null;
}

function addDots(draft: Draft, target: HoleTarget, game: ScorecardGame, definition: DotsGameDefinition) {
  const result = game.result;
  const hole = result?.dots?.holes.find((entry) => entry.number === target.number);
  draft.status = toStatus(hole?.status);
  draft.total = hole?.points.find((point) => point.playerId === target.playerId)?.dots ?? null;
  addAwards(draft, target, hole?.awards ?? [], 'specials');
  if (definition.mode === 'rotating' && definition.highLow !== undefined) {
    addRotatingHighLowBase(draft, target, result);
    draft.context = `${definition.name} · Net High/Low + specials`;
    return;
  }
  if (definition.mode === 'linked' && game.linkedBase?.definition.kind === 'nines') {
    // Nines points are settled with these dots, but the cell and this breakdown show the Dots specials only.
    draft.context = `${definition.name} · Specials only; Nines points are in the Nines game`;
    return;
  }
  if (definition.mode === 'linked') {
    addLinkedWolfBase(draft, target, game);
    return;
  }
  draft.context = `${definition.name} · Specials-only game`;
}

function addWolf(draft: Draft, target: HoleTarget, definition: WolfGameDefinition,
  result?: RoundGameResult) {
  const hole = result?.wolf?.holes.find((entry) => entry.number === target.number);
  draft.status = wolfHoleStatus(hole?.status);
  draft.total = hole?.transfers.find((point) => point.playerId === target.playerId)?.dots ?? null;
  if (definition.version === 2) {
    addAwards(draft, target, result?.wolf?.awards ?? [], 'base', hole?.mode ?? undefined);
    return;
  }
  // Legacy Wolf version 1 stores signed transfers, not earned awards, so show the balance as one line.
  draft.context += ' · Legacy signed dot balance';
  if (draft.total !== null) {
    draft.entries.push({ label: 'Wolf transfer balance', dots: draft.total, lane: 'base', source: null });
  }
}

function addChurchy(draft: Draft, target: HoleTarget, result?: RoundGameResult) {
  const hole = result?.churchy?.holes.find((entry) => entry.number === target.number);
  // Churchie reports a partly decided hole as partial; until every input is saved it is still pending.
  draft.status = toStatus(hole?.dotStatus === 'partial' ? 'pending' : hole?.dotStatus);
  draft.total = hole?.awards.find((point) => point.playerId === target.playerId)?.dots ?? null;
  if (!hole) return;
  for (const lane of ['high', 'low'] as const) {
    const contest = hole[lane];
    if (contest.dots === null || !contest.winners.includes(target.playerId)) continue;
    draft.entries.push({ label: lane === 'high' ? 'High' : 'Low', dots: contest.dots, lane: 'base', source: null });
  }
  for (const award of hole.specials) {
    if (!award.winners.includes(target.playerId) || award.dots === 0) continue;
    const missedCall = award.outcome === 'missed' ? ' · missed call' : '';
    const source = award.playerId ? golferName(target.players, award.playerId) : null;
    draft.entries.push({ label: `${award.special}${missedCall}`, dots: award.dots, lane: 'specials', source });
  }
}

function laneTotal(entries: readonly DotHoleBreakdownEntry[], lane: BreakdownLane): number | null {
  return exactSum(entries.filter((entry) => entry.lane === lane).map((entry) => entry.dots));
}

/** Only a complete hole whose listed parts add up to the saved total publishes numbers. */
function finish(draft: Draft): DotHoleBreakdown {
  const unknown = { base: null, specials: null, total: null, entries: draft.entries, context: draft.context };
  if (draft.status !== 'complete') return { status: draft.status, ...unknown };
  const base = laneTotal(draft.entries, 'base');
  const specials = laneTotal(draft.entries, 'specials');
  if (base === null || specials === null || draft.total === null) return { status: 'unavailable', ...unknown };
  if (exactSum([base, specials]) !== draft.total) return { status: 'unavailable', ...unknown };
  return { status: 'complete', base, specials, total: draft.total, entries: draft.entries, context: draft.context };
}

/** Explains one golfer's saved dots on one hole for Dots, Wolf and Churchie, without any extra reads. */
export function dotHoleBreakdown(game: ScorecardGame, playerId: string, number: number, players: Players): DotHoleBreakdown {
  const target: HoleTarget = { playerId, number, players };
  const draft: Draft = { status: 'unavailable', total: null, context: game.definition.name, entries: [] };
  const definition = game.definition;
  if (definition.kind === 'dots') addDots(draft, target, game, definition);
  else if (definition.kind === 'wolf') addWolf(draft, target, definition, game.result);
  else if (definition.kind === 'churchy') addChurchy(draft, target, game.result);
  return finish(draft);
}
