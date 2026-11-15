import type { RoundScores } from './scoring.js';
import type { EventWorkspace, RoundSnapshot } from './setup.js';
import { calculateCourseHandicap, handicapStrokesForHole } from './stableford.js';
import { playerTee } from './tees.js';
import type { AccountIdentity } from './events.js';

export interface EventSkinsConfiguration {
  readonly version: 1;
}
export interface EventSkinsChange {
  readonly id: string;
  readonly eventId: string;
  readonly expectedEtag: string;
  readonly before: EventSkinsConfiguration | null;
  readonly after: EventSkinsConfiguration | null;
  readonly recordedAt: string;
  readonly recordedBy: AccountIdentity;
}
export interface EventSkinsHole {
  readonly roundId: string;
  readonly number: number;
  readonly status: 'pending' | 'unavailable' | 'tied' | 'awarded' | 'ineligible';
  readonly reason?: 'round-context-mismatch' | 'missing-score-data' | 'missing-net-inputs' | 'arithmetic-range';
  readonly winnerId: string | null;
  readonly contenderIds: readonly string[];
  readonly netStrokes: number | null;
  readonly grossUnderParPriority: boolean;
}
export interface EventSkinsCell {
  readonly roundId: string;
  readonly skins: number;
  readonly decidedHoles: number;
  readonly totalHoles: number;
  readonly status: 'complete' | 'provisional' | 'unavailable';
}
export interface EventSkinsPlayer {
  readonly playerId: string;
  readonly displayName: string;
  /** Confirmed saved awards, not a zero substitute for pending/unavailable totals. */
  readonly skins: number;
  readonly rank: number | null;
  readonly cells: readonly EventSkinsCell[];
}
export interface EventSkinsResults {
  readonly status: 'disabled' | 'complete' | 'provisional' | 'unavailable';
  readonly holes: readonly EventSkinsHole[];
  readonly players: readonly EventSkinsPlayer[];
  readonly awardedSkins: number;
  readonly pendingHoles: number;
  readonly unavailableHoles: number;
  readonly totalHoles: number;
}

function holeResult(roundId: string, number: number, status: EventSkinsHole['status'],
  reason?: EventSkinsHole['reason']): EventSkinsHole {
  return { roundId, number, status, ...(reason ? { reason } : {}),
    winnerId: null, contenderIds: [], netStrokes: null, grossUnderParPriority: false };
}

function roundHoles(workspace: EventWorkspace, snapshot: RoundSnapshot,
  sources: readonly RoundScores[]): readonly EventSkinsHole[] {
  const source = sources[0];
  const ids = snapshot.players.map((player) => player.playerId);
  const context = sources.length === 1 && source?.eventId === workspace.event.id
    && source.roundId === snapshot.id && new Set(ids).size === ids.length
    && ids.length === workspace.roster.length && workspace.roster.every((player) => ids.includes(player.playerId))
    && source.cards.length === ids.length && new Set(source.cards.map((card) => card.playerId)).size === ids.length
    && source.cards.every((card) => ids.includes(card.playerId))
    && source.setupLocked === (snapshot.scoringStarted === true)
    && (source.setupLocked || source.cards.every((card) => card.holes.every((hole) => hole.score.kind === 'unplayed')));
  const cards = new Map(source?.cards.map((card) => [card.playerId, card]));
  const handicaps = new Map(source?.courseHandicaps?.map((entry) => [entry.playerId, entry.courseHandicap]));
  const inputs = snapshot.players.map((player) => {
    const tee = playerTee(snapshot, player.playerId);
    const index = player.handicapIndex === undefined ? player.handicapIndexValue : player.handicapIndex?.value ?? null;
    return { playerId: player.playerId, tee, card: cards.get(player.playerId),
      handicap: index === undefined ? handicaps.get(player.playerId)
        : index === null ? null : calculateCourseHandicap(index, tee) };
  });
  return snapshot.teeProfile.holes.map((base): EventSkinsHole => {
    if (!context) return holeResult(snapshot.id, base.number, 'unavailable', 'round-context-mismatch');
    let pending = false;
    let unavailable: EventSkinsHole['reason'];
    const candidates: { readonly playerId: string; readonly gross: number; readonly net: number; readonly underPar: boolean }[] = [];
    for (const player of inputs) {
      const { tee, card, handicap } = player;
      const hole = tee.holes.find((entry) => entry.number === base.number);
      const saved = card?.holes.filter((entry) => entry.number === base.number);
      const score = saved?.[0]?.score;
      if (!hole || !score || saved.length !== 1) { unavailable = 'missing-score-data'; continue; }
      if (score.kind === 'unplayed') { pending = true; continue; }
      if (score.kind !== 'strokes') continue;
      if (typeof handicap !== 'number' || !Number.isSafeInteger(handicap) || !tee.strokeAllocation
        || !Number.isSafeInteger(hole.allocation) || hole.allocation < 1 || hole.allocation > tee.holes.length) {
        unavailable = 'missing-net-inputs'; continue;
      }
      const net = BigInt(score.strokes) - BigInt(handicapStrokesForHole(handicap, hole.allocation, tee.holes.length));
      if (net > BigInt(Number.MAX_SAFE_INTEGER) || net < BigInt(Number.MIN_SAFE_INTEGER)) {
        unavailable = 'arithmetic-range'; continue;
      }
      candidates.push({ playerId: player.playerId, gross: score.strokes, net: Number(net), underPar: score.strokes < hole.par });
    }
    if (unavailable) return holeResult(snapshot.id, base.number, 'unavailable', unavailable);
    if (pending) return holeResult(snapshot.id, base.number, 'pending');
    if (!candidates.length) return holeResult(snapshot.id, base.number, 'ineligible');
    const net = candidates.reduce((lowest, entry) => Math.min(lowest, entry.net), Infinity);
    const tied = candidates.filter((entry) => entry.net === net);
    const underPar = tied.filter((entry) => entry.underPar);
    const priority = tied.length > 1 && underPar.length > 0;
    const gross = underPar.reduce((lowest, entry) => Math.min(lowest, entry.gross), Infinity);
    const contenders = priority ? underPar.filter((entry) => entry.gross === gross) : tied;
    return { ...holeResult(snapshot.id, base.number, contenders.length === 1 ? 'awarded' : 'tied'),
      winnerId: contenders.length === 1 ? contenders[0]?.playerId ?? null : null,
      contenderIds: contenders.map((entry) => entry.playerId), netStrokes: net, grossUnderParPriority: priority };
  });
}

/** Every round/hole is independent. Only saved numeric strokes can win; there is never a carry. */
export function calculateEventSkins(workspace: EventWorkspace, rounds: readonly RoundScores[]): EventSkinsResults {
  if (!workspace.eventSkins) return { status: 'disabled', holes: [], players: [], awardedSkins: 0,
    pendingHoles: 0, unavailableHoles: 0, totalHoles: 0 };
  const extraSources = rounds.some((round) => !workspace.rounds.some((snapshot) => snapshot.id === round.roundId));
  const holes = workspace.rounds.flatMap((snapshot) => roundHoles(workspace, snapshot,
    extraSources ? [] : rounds.filter((round) => round.roundId === snapshot.id)));
  const pendingHoles = holes.filter((hole) => hole.status === 'pending').length;
  const unavailableHoles = holes.filter((hole) => hole.status === 'unavailable').length;
  const status = unavailableHoles || !holes.length ? 'unavailable' : pendingHoles ? 'provisional' : 'complete';
  const players = workspace.roster.map((player): EventSkinsPlayer => {
    const cells = workspace.rounds.map((round): EventSkinsCell => {
      const roundHoles = holes.filter((hole) => hole.roundId === round.id);
      return { roundId: round.id, skins: roundHoles.filter((hole) => hole.winnerId === player.playerId).length,
        decidedHoles: roundHoles.filter((hole) => hole.status !== 'pending' && hole.status !== 'unavailable').length,
        totalHoles: roundHoles.length,
        status: roundHoles.some((hole) => hole.status === 'unavailable') ? 'unavailable'
          : roundHoles.some((hole) => hole.status === 'pending') ? 'provisional' : 'complete' };
    });
    return { playerId: player.playerId, displayName: player.displayName, skins: cells.reduce((sum, cell) => sum + cell.skins, 0),
      cells, rank: null };
  }).sort((left, right) => right.skins - left.skins);
  return { status, holes, pendingHoles, unavailableHoles, totalHoles: holes.length,
    awardedSkins: holes.filter((hole) => hole.status === 'awarded').length,
    players: players.map((player) => ({ ...player,
      rank: player.skins > 0 ? players.findIndex((entry) => entry.skins === player.skins) + 1 : null,
    })) };
}

export interface EventSkinsPayout {
  readonly status: 'calculated' | 'projected' | 'unavailable';
  readonly perSkinMinor: number | null;
  readonly unallocatedMinor: number | null;
  readonly shares: readonly { readonly playerId: string; readonly amountMinor: number }[];
}

export function calculateEventSkinsPayout(results: EventSkinsResults, potMinor: number): EventSkinsPayout {
  const unavailable: EventSkinsPayout = { status: 'unavailable', perSkinMinor: null, unallocatedMinor: null, shares: [] };
  if (!Number.isSafeInteger(potMinor) || potMinor < 0 || results.status === 'disabled' || results.status === 'unavailable'
    || !Number.isSafeInteger(results.awardedSkins) || results.awardedSkins < 0
    || results.players.some((player) => !Number.isSafeInteger(player.skins) || player.skins < 0)
    || new Set(results.players.map((player) => player.playerId)).size !== results.players.length
    || results.players.reduce((sum, player) => sum + BigInt(player.skins), 0n) !== BigInt(results.awardedSkins)) {
    return unavailable;
  }
  const identities = new Set(results.holes.map((hole) => `${hole.roundId}:${String(hole.number)}`));
  const wins = new Map(results.players.map((player) => [player.playerId, 0]));
  for (const hole of results.holes) {
    if (hole.status === 'awarded') {
      if (hole.winnerId === null || !wins.has(hole.winnerId)) return unavailable;
      wins.set(hole.winnerId, (wins.get(hole.winnerId) ?? 0) + 1);
    } else if (hole.winnerId !== null) return unavailable;
  }
  const pending = results.holes.filter((hole) => hole.status === 'pending').length;
  if (!results.totalHoles || identities.size !== results.holes.length || results.totalHoles !== results.holes.length
    || results.unavailableHoles !== 0 || results.holes.some((hole) => hole.status === 'unavailable')
    || results.pendingHoles !== pending || (results.status === 'complete') !== (pending === 0)
    || results.players.some((player) => wins.get(player.playerId) !== player.skins)) return unavailable;
  const unit = results.awardedSkins ? BigInt(potMinor) / BigInt(results.awardedSkins) : 0n;
  return { status: results.status === 'complete' ? 'calculated' : 'projected', perSkinMinor: results.awardedSkins ? Number(unit) : null,
    unallocatedMinor: Number(BigInt(potMinor) - unit * BigInt(results.awardedSkins)),
    shares: results.players.map((player) => ({ playerId: player.playerId, amountMinor: Number(unit * BigInt(player.skins)) })) };
}
