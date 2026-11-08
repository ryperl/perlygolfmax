import type { CourseHole } from './catalog.js';
import type { GamePlayerResult, GameUnavailableReason, RoundGameResult } from './games.js';
import type { Scorecard } from './scoring.js';
import { handicapStrokesForHole } from './stableford.js';

export interface ChurchyGameDefinition {
  readonly id: string;
  readonly name: string;
  readonly kind: 'churchy';
  readonly version: 1;
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

/** The revision binds a special edit to the saved game/order, not an award supplied by a client. */
export interface ChurchySpecials {
  readonly gameId: string;
  readonly gameEtag: string;
  readonly paree: boolean;
  readonly murphy: boolean;
  readonly murphyPresses: 0 | 1 | 2;
  readonly sandy: boolean;
  readonly pully: boolean;
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
  readonly special: 'Paree' | 'Murphy' | 'Sandy' | 'Pully' | 'Birdie' | 'Sweep';
  readonly playerId: string | null;
  readonly outcome: 'made' | 'missed' | 'ineligible';
  readonly winners: readonly string[];
  readonly dots: number;
}
export interface ChurchyHoleReceipt {
  readonly number: number;
  readonly stake: number;
  readonly pairs: readonly [ChurchyPair, ChurchyPair];
  readonly high: ChurchyLane;
  readonly low: ChurchyLane;
  readonly specials: readonly ChurchyAward[];
  readonly specialStatus: 'complete' | 'pending' | 'unavailable';
  readonly dotStatus: 'complete' | 'partial' | 'pending' | 'unavailable';
  readonly awards: readonly { readonly playerId: string; readonly dots: number | null }[];
}
export interface ChurchyResults {
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
  return a === undefined || b === undefined ? a === b
    : a.gameId === b.gameId && a.gameEtag === b.gameEtag && a.paree === b.paree
      && a.murphy === b.murphy && a.murphyPresses === b.murphyPresses && a.sandy === b.sandy && a.pully === b.pully;
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
  cards: readonly Scorecard[], groupValid = true): RoundGameResult {
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
    if (high.status === 'won' && low.status === 'won' && high.winners[0] === low.winners[0]) {
      specials.push({ special: 'Sweep', playerId: null, outcome: 'made', winners: high.winners, dots: stake });
    }
    for (const entry of entries) {
      if (!groupValid || !entry.hole || !entry.saved || entry.saved.score.kind === 'unplayed') continue;
      const score = entry.saved.score;
      const extras = score.churchy?.gameId === game.id ? score.churchy : undefined;
      const own = pairs.find((pair) => pair.includes(entry.id));
      const other = pairs.find((pair) => !pair.includes(entry.id));
      if (!own || !other) continue;
      const gross = score.kind === 'strokes' ? score.strokes : null;
      function award(special: ChurchyAward['special'], success: boolean, dots = 1) {
        specials.push({ special, playerId: entry.id, outcome: success ? 'made' : 'missed', winners: success ? own ?? [] : other ?? [], dots });
      }
      if (extras?.paree) award('Paree', gross !== null && gross <= entry.hole.par);
      if (extras?.murphy) award('Murphy', gross !== null && gross <= entry.hole.par, 1 + extras.murphyPresses);
      for (const [selected, special] of [[extras?.sandy, 'Sandy'], [extras?.pully, 'Pully']] as const) {
        if (!selected) continue;
        if (gross === entry.hole.par) award(special, true);
        else specials.push({ special, playerId: entry.id, outcome: 'ineligible', winners: [], dots: 0 });
      }
      if (gross === entry.hole.par - 1) award('Birdie', true);
    }
    const specialStatus = !groupValid || entries.some((entry) => !entry.hole) ? 'unavailable' : pending ? 'pending' : 'complete';
    const resolved = high.dots !== null && low.dots !== null && specialStatus === 'complete';
    const knownAwards = high.dots !== null || low.dots !== null || specials.some((award) => award.dots > 0);
    const dotStatus = high.status === 'unavailable' || low.status === 'unavailable' || specialStatus === 'unavailable'
      ? 'unavailable' : resolved ? 'complete' : knownAwards ? 'partial' : 'pending';
    const awards = game.playerIds.map((playerId) => {
      const dots = (high.winners.includes(playerId) ? high.dots ?? 0 : 0) + (low.winners.includes(playerId) ? low.dots ?? 0 : 0)
        + specials.filter((award) => award.winners.includes(playerId)).reduce((sum, award) => sum + award.dots, 0);
      const saved = entries.find((entry) => entry.id === playerId)?.saved;
      return { playerId, dots: resolved || dots > 0 || knownAwards && saved && saved.score.kind !== 'unplayed' ? dots : null };
    });
    holes.push({ number, stake, pairs, high, low, specials, specialStatus, dotStatus, awards });
  }
  const status = !groupValid || !validHandicaps || holes.some((hole) =>
    hole.high.status === 'unavailable' || hole.low.status === 'unavailable' || hole.specialStatus === 'unavailable')
    ? 'unavailable' : holes.some((hole) => hole.dotStatus !== 'complete') ? 'in-progress' : 'complete';
  function subtotal(id: string, entries: readonly ChurchyHoleReceipt[]) {
    const values = entries.flatMap((hole) => hole.awards.filter((award) => award.playerId === id && award.dots !== null));
    return values.length ? values.reduce((sum, award) => sum + (award.dots ?? 0), 0) : null;
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
  const balances = churchySettlement(players.map((player) => status === 'unavailable' ? null : player.totalPoints), game.amountPerDotMinor);
  return { gameId: game.id, kind: 'churchy', version: 1, players, churchy: {
    holes, status, unawardedHigh: highCarry, unawardedLow: lowCarry,
    settlement: players.map((player, index) => ({ playerId: player.playerId,
      paysMinor: balances[index] == null ? null : Math.max(0, -(balances[index] ?? 0)),
      collectsMinor: balances[index] == null ? null : Math.max(0, balances[index] ?? 0) })),
  } };
}
