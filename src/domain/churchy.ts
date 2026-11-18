import type { CourseHole } from './catalog.js';
import type { GamePlayerResult, GameUnavailableReason, RoundGameResult } from './games.js';
import type { Scorecard } from './scoring.js';
import { handicapStrokesForHole } from './stableford.js';
import { calculateDotSettlement } from './dot-settlement.js';
import type { InternalGameSettlement } from './dot-settlement.js';
import type { DotsHoleRecord, DotsSpecialSelection, DotsRotationStart } from './dots.js';
import type { DotAward } from './dot-context.js';
import type { RoundGroup } from './setup.js';
import { calculateChurchyV3Results } from './churchy-v3.js';
import { sameDotsRecords } from './game-declarations.js';
export { churchyDotsDefinition, churchyV3Context, churchyV3Records, churchyV3RecordsMatchGame } from './churchy-v3.js';

interface CommonChurchyGameDefinition {
  readonly id: string;
  readonly name: string;
  readonly kind: 'churchy';
  readonly basis: 'net';
  readonly groupNumber: number;
  readonly playerIds: readonly string[];
  readonly amountPerDotMinor: number;
  readonly currency: 'USD';
  readonly format?: never;
  readonly teams?: never;
  readonly preset?: never;
  readonly points?: never;
  readonly handicapAllowancePercent?: never;
}

export type ChurchySpecialKey = 'paree' | 'murphy' | 'sandy' | 'pully' | 'birdie' | 'eagle' | 'sticky' | 'sweep';
export const defaultChurchySpecials: readonly ChurchySpecialKey[] = [
  'paree', 'murphy', 'sandy', 'pully', 'birdie', 'eagle', 'sticky', 'sweep',
];
export interface ChurchyGameDefinitionV1 extends CommonChurchyGameDefinition {
  readonly version: 1;
  readonly enabledSpecials?: never;
}
export interface ChurchyGameDefinitionV2 extends CommonChurchyGameDefinition {
  readonly version: 2;
  readonly enabledSpecials: readonly ChurchySpecialKey[];
}
export interface ChurchyGameDefinitionV3 extends CommonChurchyGameDefinition {
  readonly version: 3;
  readonly orderMode: 'tee' | 'approach';
  readonly specials: readonly DotsSpecialSelection[];
  readonly enabledSpecials?: never;
}
export const defaultChurchySpecialSelections: readonly DotsSpecialSelection[] = [
  { kind: 'paree', units: 1 }, { kind: 'murphy', units: 1 }, { kind: 'sandy', units: 1 },
  { kind: 'pully', units: 1 }, { kind: 'birdie', units: 2 }, { kind: 'eagle', units: 4 },
  { kind: 'dime', units: 1 }, { kind: 'sweep', units: 1 }, { kind: 'other', units: 1 },
];
export type ChurchyGameDefinition = ChurchyGameDefinitionV1 | ChurchyGameDefinitionV2 | ChurchyGameDefinitionV3;

/** The revision binds a special edit to the saved game/order, not an award supplied by a client. */
interface CommonChurchySpecials {
  readonly gameId: string;
  readonly gameEtag: string;
  readonly paree: boolean;
  readonly murphy: boolean;
  readonly murphyPresses: 0 | 1 | 2;
  readonly pully: boolean;
}
export interface ChurchySpecialsV1 extends CommonChurchySpecials {
  readonly version?: never;
  readonly sandy: boolean;
}
export interface ChurchySpecialsV2 extends CommonChurchySpecials {
  readonly version: 2;
  readonly sandyCount: number;
  readonly sticky: boolean;
  readonly otherDots: number;
}
export interface ChurchySpecialsV3 extends DotsHoleRecord { readonly version: 3 }
export type ChurchySpecials = ChurchySpecialsV1 | ChurchySpecialsV2 | ChurchySpecialsV3;

export function emptyChurchySpecials(game: ChurchyGameDefinition, gameEtag: string): ChurchySpecials {
  if (game.version === 3) return { version: 3, gameId: game.id, gameEtag, number: 1, players: [], contests: [] };
  const common = { gameId: game.id, gameEtag, paree: false, murphy: false, murphyPresses: 0 as const, pully: false };
  return game.version === 2 ? { ...common, version: 2, sandyCount: 0, sticky: false, otherDots: 0 }
    : { ...common, sandy: false };
}

export function churchySpecialsMatchGame(value: ChurchySpecials, game: ChurchyGameDefinition): boolean {
  if (value.version === 3 || game.version === 3) return value.version === 3 && game.version === 3
    && value.gameId === game.id && (game.orderMode !== 'tee' || value.rotation === undefined)
    && (!value.rotation || value.rotation.playerIds.length === 4 && new Set(value.rotation.playerIds).size === 4
      && value.rotation.playerIds.every((id) => game.playerIds.includes(id)))
    && new Set(value.players.map((player) => player.playerId)).size === value.players.length
    && value.players.every((player) => game.playerIds.includes(player.playerId)
      && Object.entries(player.counts).every(([kind, count]) => Number.isSafeInteger(count) && count >= 0
        && game.specials.some((special) => special.kind === kind))
      && player.calls.every((call) => game.specials.some((special) => special.kind === call.kind)))
    && value.contests.every((contest) => (!contest.winnerId || game.playerIds.includes(contest.winnerId))
      && (!contest.secondId || game.playerIds.includes(contest.secondId)));
  if (value.gameId !== game.id || (value.version === 2) !== (game.version === 2)
    || ![0, 1, 2].includes(value.murphyPresses) || !value.murphy && value.murphyPresses !== 0) return false;
  if (value.version !== 2 || game.version !== 2) return true;
  return Number.isSafeInteger(value.sandyCount) && value.sandyCount >= 0
    && Number.isSafeInteger(value.otherDots) && value.otherDots >= 0
    && (!value.paree || game.enabledSpecials.includes('paree'))
    && (!value.murphy || game.enabledSpecials.includes('murphy'))
    && (!value.pully || game.enabledSpecials.includes('pully'))
    && (!value.sandyCount || game.enabledSpecials.includes('sandy'))
    && (!value.sticky || game.enabledSpecials.includes('sticky'));
}

export type ChurchyPair = readonly [string, string];
export type ChurchyLaneStatus = 'won' | 'tied' | 'pending' | 'unavailable';
export interface ChurchyLane {
  readonly status: ChurchyLaneStatus;
  readonly winners: readonly string[];
  readonly dots: number | null;
  readonly carry: number | null;
}
export interface ChurchyAward {
  readonly special: string;
  readonly playerId: string | null;
  readonly outcome: 'made' | 'missed' | 'ineligible';
  readonly winners: readonly string[];
  readonly dots: number;
}
export interface ChurchyHoleReceipt {
  readonly number: number;
  readonly stake: number;
  readonly pairs: readonly ChurchyPair[];
  readonly high: ChurchyLane;
  readonly low: ChurchyLane;
  readonly specials: readonly ChurchyAward[];
  readonly specialStatus: 'complete' | 'pending' | 'unavailable';
  readonly dotStatus: 'complete' | 'partial' | 'pending' | 'unavailable';
  readonly awards: readonly { readonly playerId: string; readonly dots: number | null }[];
}
export interface ChurchyResults {
  readonly awards?: readonly DotAward[];
  readonly order?: DotsRotationStart;
  readonly internalSettlement?: InternalGameSettlement;
  readonly holes: readonly ChurchyHoleReceipt[];
  readonly status: 'complete' | 'in-progress' | 'unavailable';
  readonly unawardedHigh: number | null;
  readonly unawardedLow: number | null;
  readonly settlement: readonly {
    readonly playerId: string;
    readonly paysMinor: number | null;
    readonly collectsMinor: number | null;
  }[];
}
export interface ChurchyPlayerInput {
  readonly playerId: string;
  readonly displayName: string;
  readonly layout: readonly CourseHole[];
  readonly handicap: number | null | GameUnavailableReason;
}

export function churchyPairs(ids: readonly string[], number: number): readonly [ChurchyPair, ChurchyPair] | null {
  const [a, b, c, d] = ids;
  if (!a || !b || !c || !d || ids.length !== 4 || new Set(ids).size !== 4) return null;
  switch (Math.floor((number - 1) / 3) % 3) {
    case 0: return [[a, b], [c, d]];
    case 1: return [[a, c], [b, d]];
    default: return [[a, d], [b, c]];
  }
}

export function sameChurchySpecials(a: ChurchySpecials | undefined, b: ChurchySpecials | undefined): boolean {
  if (a?.version === 3 || b?.version === 3) return a?.version === 3 && b?.version === 3
    && sameDotsRecords([a], [b]);
  return a === undefined || b === undefined ? a === b
    : a.gameId === b.gameId && a.gameEtag === b.gameEtag && a.paree === b.paree
      && a.murphy === b.murphy && a.murphyPresses === b.murphyPresses && a.pully === b.pully
      && (a.version === 2 ? b.version === 2 && a.sandyCount === b.sandyCount && a.sticky === b.sticky
        && a.otherDots === b.otherDots : b.version !== 2 && a.sandy === b.sandy);
}

function exactSum(values: readonly number[]): number | null {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
}

export function calculateChurchyInternalSettlement(game: ChurchyGameDefinitionV2 | ChurchyGameDefinitionV3,
  players: readonly GamePlayerResult[], holes: readonly ChurchyHoleReceipt[], status: ChurchyResults['status']): InternalGameSettlement {
  return calculateDotSettlement({
    groupNumber: game.groupNumber, gameIds: [game.id], stakeMinor: game.amountPerDotMinor,
    complete: status === 'complete', unavailable: status === 'unavailable',
    players: players.map((player) => {
      const known = holes.filter((hole) => hole.awards.find((award) => award.playerId === player.playerId)?.dots != null
        || hole.specials.some((award) => award.winners.includes(player.playerId) && award.dots > 0));
      return { playerId: player.playerId, displayName: player.displayName,
        baseDots: known.length ? exactSum(known.flatMap((hole) => [
          hole.high.winners.includes(player.playerId) ? hole.high.dots ?? 0 : 0,
          hole.low.winners.includes(player.playerId) ? hole.low.dots ?? 0 : 0])) : null,
        specialDots: known.length ? exactSum(known.flatMap((hole) =>
          hole.specials.filter((award) => award.winners.includes(player.playerId)).map((award) => award.dots))) : null };
    }),
  });
}

export function churchySettlement(totals: readonly (number | null)[], amount: number): readonly (number | null)[] {
  if (totals.length !== 4 || !Number.isSafeInteger(amount) || amount < 0
    || totals.some((total) => total === null || !Number.isSafeInteger(total) || total < 0)) return totals.map(() => null);
  const values = totals.map((value) => BigInt(value ?? 0));
  const sum = values.reduce((a, b) => a + b, 0n);
  if (sum % 2n !== 0n) return totals.map(() => null);
  const balances = values.map((value) => {
    const net = (2n * value - sum / 2n) * BigInt(amount);
    return net > BigInt(Number.MAX_SAFE_INTEGER) || net < BigInt(Number.MIN_SAFE_INTEGER) ? null : Number(net);
  });
  return balances.some((value) => value === null) ? totals.map(() => null) : balances;
}

export function calculateChurchyResults(game: ChurchyGameDefinition, inputs: readonly ChurchyPlayerInput[],
  cards: readonly Scorecard[], groupValid = true, groups: readonly RoundGroup[] = [],
  defaultLayout: readonly CourseHole[] = []): RoundGameResult {
  if (game.version === 3) return calculateChurchyV3Results(game, inputs, cards, groups, defaultLayout, groupValid);
  const selected = game.playerIds.map((id) => inputs.find((entry) => entry.playerId === id));
  const known = selected.flatMap((entry) => entry ? [entry] : []);
  const validHandicaps = selected.length === 4 && selected.every((entry) =>
    entry && typeof entry.handicap === 'number' && Number.isSafeInteger(entry.handicap)
    && entry.layout.length > 0 && new Set(entry.layout.map((hole) => hole.allocation)).size === entry.layout.length
    && entry.layout.every((hole) => Number.isSafeInteger(hole.allocation) && hole.allocation >= 1 && hole.allocation <= entry.layout.length));
  const handicaps = known.flatMap((entry) => typeof entry.handicap === 'number' ? [entry.handicap] : []);
  const lowest = validHandicaps ? Math.min(...handicaps) : null;
  const relative = new Map(known.map((entry) => [entry.playerId,
    lowest !== null && typeof entry.handicap === 'number' && Number.isSafeInteger(entry.handicap - lowest) ? entry.handicap - lowest : null]));
  const numbers = [...(known[0]?.layout ?? inputs[0]?.layout ?? [])].sort((a, b) => a.number - b.number).map((hole) => hole.number);
  let highCarry: number | null = 0;
  let lowCarry: number | null = 0;
  const holes: ChurchyHoleReceipt[] = [];
  const overflow = new Map<number, Set<string>>();
  const enabled = (special: ChurchySpecialKey) => game.version === 1 || game.enabledSpecials.includes(special);
  for (const number of numbers) {
    const pairing = churchyPairs(game.playerIds, number);
    if (!pairing) continue;
    const pairs = pairing;
    const stake = (number - 1) % 3 + 1;
    const entries = game.playerIds.map((id) => {
      const input = inputs.find((player) => player.playerId === id);
      const hole = input?.layout.find((hole) => hole.number === number);
      const saved = cards.find((card) => card.playerId === id)?.holes.find((hole) => hole.number === number);
      const handicap = relative.get(id);
      const received = hole && handicap != null ? handicapStrokesForHole(handicap, hole.allocation, numbers.length) : null;
      return { id, hole, saved, net: saved?.score.kind === 'strokes' && received !== null
        ? BigInt(saved.score.strokes) - BigInt(received) : null };
    });
    const pending = entries.some((entry) => !entry.saved || entry.saved.score.kind === 'unplayed');
    const invalidSpecials = game.version === 2 && entries.some((entry) => entry.saved?.score.churchy !== undefined
      && !churchySpecialsMatchGame(entry.saved.score.churchy, game));
    const unavailable = !groupValid || !validHandicaps || relative.size !== 4
      || entries.some((entry) => !entry.hole || relative.get(entry.id) === null);
    const pairEntries = pairs.map((pair) => entries.filter((entry) => pair.includes(entry.id)));
    function lane(which: 'high' | 'low', carry: number | null): ChurchyLane {
      if (unavailable) return { status: 'unavailable', winners: [], dots: null, carry: null };
      if (pending) return { status: 'pending', winners: [], dots: null, carry: null };
      const values = pairEntries.map((pair) => {
        const numeric = pair.flatMap((entry) => entry.net === null ? [] : [entry.net]);
        return which === 'high' ? numeric.length === 2 ? numeric.reduce((a, b) => a > b ? a : b) : null
          : numeric.length ? numeric.reduce((a, b) => a < b ? a : b) : null;
      });
      const [a, b] = values;
      // One incomplete pair loses High to a numeric pair. Other exceptional comparisons have no approved rule.
      if (which === 'low' && (a == null || b == null) || a == null && b == null) {
        return { status: 'unavailable', winners: [], dots: null, carry: null };
      }
      if (carry === null) return { status: 'pending', winners: [], dots: null, carry: null };
      if (a === b) return { status: 'tied', winners: [], dots: 0, carry: carry + stake };
      const winners = a == null ? pairs[1] : b == null || a < b ? pairs[0] : pairs[1];
      return { status: 'won', winners, dots: carry + stake, carry: 0 };
    }
    const high = lane('high', highCarry);
    const low = lane('low', lowCarry);
    highCarry = high.carry;
    lowCarry = low.carry;
    const specials: ChurchyAward[] = [];
    if (enabled('sweep') && high.status === 'won' && low.status === 'won' && high.winners[0] === low.winners[0]) {
      specials.push({ special: 'Sweep', playerId: null, outcome: 'made', winners: high.winners, dots: stake });
    }
    for (const entry of entries) {
      if (!groupValid || invalidSpecials || !entry.hole || !entry.saved
        || game.version === 1 && entry.saved.score.kind === 'unplayed') continue;
      const score = entry.saved.score;
      const extras = score.churchy?.version !== 3 && score.churchy?.gameId === game.id
        && (score.churchy.version === 2) === (game.version === 2) ? score.churchy : undefined;
      const own = pairs.find((pair) => pair.includes(entry.id));
      const other = pairs.find((pair) => !pair.includes(entry.id));
      if (!own || !other) continue;
      const gross = score.kind === 'strokes' ? score.strokes : null;
      function award(special: ChurchyAward['special'], success: boolean, dots = 1) {
        specials.push({ special, playerId: entry.id, outcome: success ? 'made' : 'missed', winners: success ? own ?? [] : other ?? [], dots });
      }
      if (extras?.version === 2) {
        if (enabled('sticky') && extras.sticky) award('Sticky', true);
        if (extras.otherDots) award('Other', true, extras.otherDots);
      }
      if (score.kind === 'unplayed') continue;
      if (enabled('paree') && extras?.paree) award('Paree', gross !== null && gross <= entry.hole.par);
      if (enabled('murphy') && extras?.murphy) award('Murphy', gross !== null && gross <= entry.hole.par, 1 + extras.murphyPresses);
      const sandy = extras?.version === 2 ? extras.sandyCount : extras?.sandy ? 1 : 0;
      for (const [count, special] of [[enabled('sandy') ? sandy : 0, 'Sandy'], [enabled('pully') && extras?.pully ? 1 : 0, 'Pully']] as const) {
        if (!count) continue;
        if (gross === entry.hole.par || special === 'Pully' && gross === entry.hole.par - 1) award(special, true, count);
        else specials.push({ special, playerId: entry.id, outcome: 'ineligible', winners: [], dots: 0 });
      }
      if (enabled('birdie') && gross === entry.hole.par - 1) award('Birdie', true, game.version === 2 ? 2 : 1);
      if (game.version === 2) {
        if (enabled('eagle') && gross === entry.hole.par - 2) award('Eagle', true, 4);
      }
    }
    const specialStatus = !groupValid || invalidSpecials || entries.some((entry) => !entry.hole) ? 'unavailable' : pending ? 'pending' : 'complete';
    const resolved = high.dots !== null && low.dots !== null && specialStatus === 'complete';
    const knownAwards = high.dots !== null || low.dots !== null || specials.some((award) => award.dots > 0);
    const dotStatus = high.status === 'unavailable' || low.status === 'unavailable' || specialStatus === 'unavailable'
      ? 'unavailable' : resolved ? 'complete' : knownAwards ? 'partial' : 'pending';
    const awards = game.playerIds.map((playerId) => {
      const values = [(high.winners.includes(playerId) ? high.dots ?? 0 : 0), (low.winners.includes(playerId) ? low.dots ?? 0 : 0),
        ...specials.filter((award) => award.winners.includes(playerId)).map((award) => award.dots)];
      const dots = game.version === 2 ? exactSum(values) : values.reduce((sum, value) => sum + value, 0);
      if (dots === null) {
        const ids = overflow.get(number) ?? new Set<string>();
        ids.add(playerId);
        overflow.set(number, ids);
      }
      const saved = entries.find((entry) => entry.id === playerId)?.saved;
      return { playerId, dots: resolved || dots !== null && dots > 0 || knownAwards && saved && saved.score.kind !== 'unplayed' ? dots : null };
    });
    holes.push({ number, stake, pairs, high, low, specials, specialStatus,
      dotStatus: overflow.has(number) ? 'unavailable' : dotStatus, awards });
  }
  let status: ChurchyResults['status'] = !groupValid || !validHandicaps || holes.some((hole) =>
    hole.high.status === 'unavailable' || hole.low.status === 'unavailable' || hole.specialStatus === 'unavailable')
    ? 'unavailable' : holes.some((hole) => hole.dotStatus !== 'complete') ? 'in-progress' : 'complete';
  function subtotal(id: string, entries: readonly ChurchyHoleReceipt[]) {
    if (entries.some((hole) => overflow.get(hole.number)?.has(id))) return null;
    const values = entries.flatMap((hole) => hole.awards.filter((award) => award.playerId === id && award.dots !== null));
    const total = values.length ? game.version === 2 ? exactSum(values.map((award) => award.dots ?? 0))
      : values.reduce((sum, award) => sum + (award.dots ?? 0), 0) : null;
    return total;
  }
  const players: GamePlayerResult[] = game.playerIds.map((id) => {
    const player = known.find((entry) => entry.playerId === id) ?? { playerId: id, displayName: 'Golfer unavailable', layout: known[0]?.layout ?? inputs[0]?.layout ?? [], handicap: null };
    return {
    playerId: player.playerId, displayName: player.displayName, playingHandicap: relative.get(player.playerId) ?? null,
    status, holes: holes.map((hole) => ({ number: hole.number,
      points: hole.awards.find((award) => award.playerId === player.playerId)?.dots ?? null,
      strokesReceived: relative.get(player.playerId) == null ? null : handicapStrokesForHole(relative.get(player.playerId) ?? 0,
        player.layout.find((entry) => entry.number === hole.number)?.allocation ?? 1, player.layout.length) })),
    holesScored: cards.find((card) => card.playerId === player.playerId)?.holes.filter((hole) => hole.score.kind !== 'unplayed').length ?? 0,
    totalHoles: numbers.length, frontPoints: subtotal(player.playerId, holes.filter((hole) => hole.number <= 9)),
    backPoints: subtotal(player.playerId, holes.filter((hole) => hole.number > 9)), totalPoints: subtotal(player.playerId, holes),
    };
  });
  if (overflow.size > 0 || game.version === 2 && players.some((player) => player.totalPoints === null
    && holes.some((hole) => hole.awards.some((award) => award.playerId === player.playerId && award.dots !== null)))) status = 'unavailable';
  const outputPlayers = players.map((player) => ({ ...player, status }));
  const internalSettlement = game.version === 2 ? calculateChurchyInternalSettlement(game, outputPlayers, holes, status) : undefined;
  const balances = internalSettlement ? internalSettlement.players.map((player) => player.netMinor)
    : churchySettlement(players.map((player) => status === 'unavailable' ? null : player.totalPoints), game.amountPerDotMinor);
  return { gameId: game.id, kind: 'churchy', version: game.version, players: outputPlayers, churchy: {
    holes, status, unawardedHigh: highCarry, unawardedLow: lowCarry,
    ...(internalSettlement ? { internalSettlement } : {}),
    settlement: players.map((player, index) => ({ playerId: player.playerId,
      paysMinor: balances[index] == null ? null : Math.max(0, -(balances[index] ?? 0)),
      collectsMinor: balances[index] == null ? null : Math.max(0, balances[index] ?? 0) })),
  } };
}
