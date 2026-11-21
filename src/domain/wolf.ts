import type { CourseHole } from './catalog.js';
import type { GameScoreBasis, GameUnavailableReason } from './games.js';
import type { RoundGroup } from './setup.js';
import type { Scorecard } from './scoring.js';
import { groupStartingHole } from './round-navigation.js';
import { hasStrokeAllocation } from './tees.js';
import { handicapStrokesForHole } from './handicap-strokes.js';
import { calculateEarnedWolf } from './wolf-earned.js';
import type { DotAward, DotHoleContext, DotPrefixPoints } from './dot-context.js';
import { gameHandicap } from './game-handicaps.js';
import type { GameHandicapSettings } from './game-handicaps.js';

export interface WolfGameDefinition extends GameHandicapSettings {
  readonly id: string;
  readonly name: string;
  readonly kind: 'wolf';
  readonly version: 1 | 2;
  readonly stakeMinor?: number | null;
  readonly basis: GameScoreBasis;
  readonly groupNumber: number;
  readonly playerIds: readonly string[];
  readonly allowPig: boolean;
  readonly highLowSweep?: true;
  readonly format?: never;
  readonly teams?: never;
  readonly preset?: never;
  readonly points?: never;
  readonly handicapAllowancePercent?: never;
}

export type WolfHoleChoice = {
  readonly gameId: string;
  readonly gameEtag: string;
} & (
  | { readonly mode: 'partner'; readonly partnerId: string }
  | { readonly mode: 'blind' | 'pig'; readonly partnerId?: never }
);

export type WolfHoleOutcome = 'scores' | 'wolf' | 'opponents' | 'halved';
export interface WolfHoleRecord {
  readonly number: number;
  readonly choice: WolfHoleChoice;
  readonly outcome?: WolfHoleOutcome;
  readonly recordedLate?: true;
  readonly comeback?: WolfComebackReceipt;
}
export interface WolfComebackReceipt {
  readonly wolfId: string;
  readonly afterHoles: readonly number[];
  readonly totals: readonly { readonly playerId: string; readonly dots: number }[];
  readonly proof: string;
}
export interface WolfComebackState {
  readonly status: 'pending' | 'available' | 'saved' | 'unavailable';
  readonly receipt: WolfComebackReceipt | null;
  readonly changed: boolean;
  readonly reason?: string;
}
export interface WolfContestResult {
  readonly kind: 'high' | 'low';
  readonly status: 'won' | 'tied' | 'pending' | 'unavailable';
  readonly winner: 'wolf' | 'opponents' | null;
  readonly wolfScore: number | null;
  readonly opponentScore: number | null;
}
export type WolfUnavailableReason = GameUnavailableReason | 'uncaptured-handicap-index'
  | 'invalid-wolf-group' | 'invalid-wolf-choice' | 'arithmetic-range' | 'missing-numeric-ball' | 'invalid-stroke-score'
  | 'conflicting-sweep-configuration';
export interface WolfPlayerInput {
  readonly playerId: string;
  readonly displayName: string;
  readonly layout: readonly CourseHole[];
  readonly strokeAllocation: boolean | undefined;
  readonly handicap: number | null | WolfUnavailableReason;
}
export interface WolfRoundInput {
  readonly layout: readonly CourseHole[];
  readonly groups: readonly RoundGroup[];
  readonly players: readonly WolfPlayerInput[];
  readonly comebackPoints?: readonly DotPrefixPoints[];
  readonly comebackRequired?: boolean;
}
export interface WolfHoleResult {
  readonly number: number;
  readonly wolfId: string | null;
  readonly mode: WolfHoleChoice['mode'] | null;
  readonly wolfSide: readonly string[];
  readonly opponents: readonly string[];
  readonly status: 'pending' | 'unavailable' | 'tied' | 'won';
  readonly reason?: WolfUnavailableReason;
  readonly source: 'scores' | 'explicit';
  readonly winner: 'wolf' | 'opponents' | null;
  readonly wolfScore: number | null;
  readonly opponentScore: number | null;
  readonly stake: 1 | 2 | 3 | null;
  readonly transfers: readonly { readonly playerId: string; readonly dots: number }[];
  readonly recordedLate?: true;
  readonly contests?: readonly WolfContestResult[];
}
export interface WolfPlayerLedger {
  readonly playerId: string;
  readonly displayName: string;
  readonly playingHandicap: number | null;
  readonly holesScored: number;
  readonly totalHoles: number;
  readonly status: 'complete' | 'in-progress' | 'unavailable';
  readonly dotsWon: number | null;
  readonly dotsLost: number | null;
  readonly balance: number | null;
}
export interface WolfResults {
  readonly status: 'complete' | 'in-progress' | 'unavailable';
  readonly reason?: WolfUnavailableReason;
  readonly holes: readonly WolfHoleResult[];
  readonly players: readonly WolfPlayerLedger[];
  readonly rulesVersion?: 2;
  readonly awards?: readonly DotAward[];
  readonly contexts?: readonly DotHoleContext[];
  readonly comeback?: WolfComebackState;
}

export function sameWolfChoice(left: WolfHoleChoice | undefined, right: WolfHoleChoice | undefined): boolean {
  return left === undefined || right === undefined ? left === right
    : left.gameId === right.gameId && left.gameEtag === right.gameEtag
      && left.mode === right.mode && left.partnerId === right.partnerId;
}

export function wolfForHole(game: WolfGameDefinition, round: Pick<WolfRoundInput, 'layout' | 'groups'>, number: number): string | null {
  const group = round.groups.find((entry) => entry.number === game.groupNumber);
  const start = groupStartingHole(group, round.layout);
  const holes = [...round.layout].sort((a, b) => a.number - b.number);
  const first = holes.findIndex((hole) => hole.number === start), current = holes.findIndex((hole) => hole.number === number);
  return first < 0 || current < 0 || game.playerIds.length !== 4 ? null
    : game.playerIds[((current - first + holes.length) % holes.length) % 4] ?? null;
}

export function wolfGroupMatchesRound(game: WolfGameDefinition, round: Pick<WolfRoundInput, 'layout' | 'groups'>): boolean {
  const group = round.groups.find((entry) => entry.number === game.groupNumber);
  return [9, 18].includes(round.layout.length) && group?.playerIds.length === 4 && game.playerIds.length === 4
    && new Set(game.playerIds).size === 4 && group.playerIds.every((id) => game.playerIds.includes(id))
    && round.layout.some((hole) => hole.number === groupStartingHole(group, round.layout));
}
function exact(value: bigint): number | null {
  return value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
}

function emptyHole(number: number, wolfId: string | null, reason?: WolfUnavailableReason): WolfHoleResult {
  return { number, wolfId, mode: null, wolfSide: [], opponents: [],
    status: reason ? 'unavailable' : 'pending', ...(reason ? { reason } : {}), source: 'scores',
    winner: null, wolfScore: null, opponentScore: null, stake: null, transfers: [] };
}

export function wolfTransfers(
  wolfSide: readonly string[], opponents: readonly string[], stake: 1 | 2 | 3, winner: 'wolf' | 'opponents' | null,
): readonly { readonly playerId: string; readonly dots: number }[] {
  if (!([1, 2].includes(wolfSide.length) && wolfSide.length + opponents.length === 4)
    || new Set([...wolfSide, ...opponents]).size !== 4) throw new Error('Invalid Wolf sides.');
  return [...wolfSide.map((playerId) => ({ playerId, dots: winner === null ? 0
    : (winner === 'wolf' ? 1 : -1) * opponents.length * stake })),
  ...opponents.map((playerId) => ({ playerId, dots: winner === null ? 0
    : (winner === 'opponents' ? 1 : -1) * wolfSide.length * stake }))];
}

export function calculateWolf(
  game: WolfGameDefinition, round: WolfRoundInput, cards: readonly Scorecard[], records: readonly WolfHoleRecord[],
): WolfResults {
  if (game.version === 2) return calculateEarnedWolf(game, round, cards, records);
  const layout = [...round.layout].sort((a, b) => a.number - b.number);
  const group = round.groups.find((entry) => entry.number === game.groupNumber);
  const players = game.playerIds.flatMap((id) => {
    const player = round.players.find((entry) => entry.playerId === id);
    return player ? [player] : [];
  });
  if (![9, 18].includes(layout.length) || !group || group.playerIds.length !== 4 || game.playerIds.length !== 4
    || new Set(layout.map((hole) => hole.number)).size !== layout.length
    || new Set(game.playerIds).size !== 4 || !group.playerIds.every((id) => game.playerIds.includes(id)) || players.length !== 4
    || !layout.some((hole) => hole.number === groupStartingHole(group, round.layout))
    || players.some((player) => player.layout.length !== layout.length
      || new Set(player.layout.map((hole) => hole.number)).size !== layout.length
      || player.layout.some((hole) => !layout.some((common) => common.number === hole.number)))) {
    return { status: 'unavailable', reason: 'invalid-wolf-group',
      holes: layout.map((hole) => emptyHole(hole.number, null, 'invalid-wolf-group')), players: [] };
  }
  const inputs = new Map(players.map((player) => [player.playerId, player]));
  const handicaps = new Map<string, number>();
  const captured = new Map<string, number>();
  let netReason: WolfUnavailableReason | undefined;
  if (game.basis === 'net') {
    for (const player of players) {
      if (typeof player.handicap !== 'number' || !Number.isSafeInteger(player.handicap)) {
        netReason = typeof player.handicap === 'string' ? player.handicap : 'missing-handicap-index';
        break;
      }
      if (!hasStrokeAllocation({ holes: player.layout, strokeAllocation: player.strokeAllocation === true })) {
        netReason = 'missing-stroke-index';
        break;
      }
      captured.set(player.playerId, player.handicap);
    }
    if (!netReason) {
      const minimum = Math.min(...captured.values());
      for (const [id, handicap] of captured) {
        const relative = game.handicapRule ? gameHandicap(game.handicapRule, id, round.players, round.groups)
          : exact(BigInt(handicap) - BigInt(minimum));
        if (typeof relative !== 'number') { netReason = relative ?? 'arithmetic-range'; break; }
        handicaps.set(id, relative);
      }
    }
  }
  const orphan = records.some((record) => !layout.some((hole) => hole.number === record.number));
  const holes = layout.map((hole): WolfHoleResult => {
    const wolfId = wolfForHole(game, round, hole.number);
    const entries = records.filter((record) => record.number === hole.number);
    if (orphan || !wolfId || entries.length > 1) return emptyHole(hole.number, wolfId, 'invalid-wolf-choice');
    const record = entries[0];
    if (!record) return emptyHole(hole.number, wolfId);
    const choice = record.choice;
    if (choice.gameId !== game.id || choice.mode === 'pig' && !game.allowPig
      || choice.mode === 'partner' && (choice.partnerId === wolfId || !game.playerIds.includes(choice.partnerId))) {
      return emptyHole(hole.number, wolfId, 'invalid-wolf-choice');
    }
    const wolfSide = choice.mode === 'partner' ? [wolfId, choice.partnerId] : [wolfId];
    const opponents = game.playerIds.filter((id) => !wolfSide.includes(id));
    const stake: 1 | 2 | 3 = choice.mode === 'pig' ? 3 : choice.mode === 'blind' ? 2 : 1;
    const base: WolfHoleResult = { ...emptyHole(hole.number, wolfId), mode: choice.mode, wolfSide, opponents, stake,
      ...(record.recordedLate ? { recordedLate: true } : {}) };
    if (record.outcome && record.outcome !== 'scores') {
      const winner = record.outcome === 'halved' ? null : record.outcome;
      return { ...base, status: winner === null ? 'tied' : 'won', source: 'explicit', winner,
        transfers: wolfTransfers(wolfSide, opponents, stake, winner) };
    }
    const raw = new Map(game.playerIds.map((id) => [id, cards.find((card) => card.playerId === id)?.holes.find((entry) => entry.number === hole.number)?.score]));
    if ([...raw.values()].some((score) => score === undefined)) return { ...base, status: 'unavailable', reason: 'missing-score-data' };
    if ([...raw.values()].some((score) => score?.kind === 'unplayed')) return base;
    if (netReason) return { ...base, status: 'unavailable', reason: netReason };
    const numeric = new Map<string, number>();
    for (const id of game.playerIds) {
      const score = raw.get(id);
      if (score?.kind !== 'strokes') continue;
      if (!Number.isSafeInteger(score.strokes) || score.strokes < 1) return { ...base, status: 'unavailable', reason: 'invalid-stroke-score' };
      const player = inputs.get(id), own = player?.layout.find((entry) => entry.number === hole.number);
      if (!player || !own) return { ...base, status: 'unavailable', reason: 'missing-score-data' };
      let received = 0;
      if (game.basis === 'net') {
        const handicap = handicaps.get(id);
        if (handicap === undefined) return { ...base, status: 'unavailable', reason: 'missing-handicap-index' };
        received = handicapStrokesForHole(handicap, own.allocation, player.layout.length);
      }
      const value = exact(BigInt(score.strokes) - BigInt(received));
      if (value === null) return { ...base, status: 'unavailable', reason: 'arithmetic-range' };
      numeric.set(id, value);
    }
    const scoresFor = (ids: readonly string[]) => ids.flatMap((id) => {
      const score = numeric.get(id); return score === undefined ? [] : [score];
    });
    const a = scoresFor(wolfSide), b = scoresFor(opponents);
    if (!a.length || !b.length) return { ...base, status: 'unavailable', reason: 'missing-numeric-ball' };
    const wolfScore = Math.min(...a), opponentScore = Math.min(...b);
    const winner = wolfScore === opponentScore ? null : wolfScore < opponentScore ? 'wolf' : 'opponents';
    return { ...base, status: winner === null ? 'tied' : 'won', winner, wolfScore, opponentScore,
      transfers: wolfTransfers(wolfSide, opponents, stake, winner) };
  });
  const unavailable = holes.some((hole) => hole.status === 'unavailable');
  const complete = holes.every((hole) => hole.status === 'won' || hole.status === 'tied');
  const status = unavailable ? 'unavailable' : complete ? 'complete' : 'in-progress';
  return {
    status, holes,
    players: players.map((player) => {
      const values = holes.flatMap((hole) => hole.transfers.filter((entry) => entry.playerId === player.playerId));
      const won = values.length ? values.reduce((sum, entry) => sum + Math.max(0, entry.dots), 0) : null;
      const lost = values.length ? values.reduce((sum, entry) => sum + Math.max(0, -entry.dots), 0) : null;
      return { playerId: player.playerId, displayName: player.displayName, playingHandicap: handicaps.get(player.playerId) ?? null,
        holesScored: values.length, totalHoles: layout.length, status,
        dotsWon: won, dotsLost: lost, balance: won === null || lost === null ? null : won - lost };
    }),
  };
}
