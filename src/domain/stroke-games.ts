import type { CourseHole } from './catalog.js';
import type {
  GamePlayerResult, GameTeamResult, GameUnavailableReason, NewRoundGameDefinition,
  RoundGameResult, StrokeGameHole, StrokeGameScore,
} from './games.js';
import { gameTeamsMatchRoster } from './games.js';
import type { Scorecard } from './scoring.js';
import { handicapStrokesForHole } from './stableford.js';

export interface StrokeGamePlayer {
  readonly playerId: string;
  readonly displayName: string;
  readonly layout: readonly CourseHole[];
  readonly handicap: number | null | GameUnavailableReason;
}

function exact(value: bigint): number | null {
  return value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
}

function sum(holes: readonly StrokeGameHole[]): number | null {
  const known = holes.filter((hole) => hole.value !== null);
  return known.length ? exact(known.reduce((total, hole) => total + BigInt(hole.value ?? 0), 0n)) : null;
}

function outcome(kind: NewRoundGameDefinition['kind'], holes: readonly StrokeGameHole[]): StrokeGameScore {
  const frontTotal = sum(holes.filter((hole) => hole.number <= 9));
  const backTotal = sum(holes.filter((hole) => hole.number > 9));
  const total = sum(holes);
  const overflow = total === null && holes.some((hole) => hole.value !== null)
    || frontTotal === null && holes.some((hole) => hole.number <= 9 && hole.value !== null)
    || backTotal === null && holes.some((hole) => hole.number > 9 && hole.value !== null);
  return { kind, version: 1, holes, frontTotal, backTotal, total,
    ...(overflow ? { unavailableReason: 'arithmetic-range' as const } : {}) };
}

function summary(score: StrokeGameScore) {
  const holesScored = score.holes.filter((hole) => score.kind === 'skins' ? hole.value !== null
    : hole.status === 'complete' || hole.status === 'ineligible').length;
  return {
    strokeGame: score, holesScored, totalHoles: score.holes.length,
    status: score.unavailableReason || score.holes.some((hole) => hole.status === 'unavailable')
      ? 'unavailable' as const : holesScored === score.holes.length ? 'complete' as const : 'in-progress' as const,
    frontPoints: null, backPoints: null, totalPoints: null,
  };
}

export function calculateStrokeGameResults(
  game: NewRoundGameDefinition, inputs: readonly StrokeGamePlayer[], cards: readonly Scorecard[],
): RoundGameResult {
  const players: GamePlayerResult[] = inputs.map((player) => {
    const card = cards.find((entry) => entry.playerId === player.playerId);
    const reason = typeof player.handicap === 'string' ? player.handicap
      : !card || player.layout.some((hole) => !card.holes.some((entry) => entry.number === hole.number))
        ? 'missing-score-data' : undefined;
    const handicap = typeof player.handicap === 'number' ? player.handicap : null;
    const holes: StrokeGameHole[] = [...player.layout].sort((a, b) => a.number - b.number).map((hole) => {
      const score = card?.holes.find((entry) => entry.number === hole.number)?.score;
      const received = handicapStrokesForHole(handicap ?? 0, hole.allocation, player.layout.length);
      const grossToPar = score?.kind === 'strokes' ? exact(BigInt(score.strokes) - BigInt(hole.par)) : null;
      const netToPar = score?.kind === 'strokes' && handicap !== null
        ? exact(BigInt(score.strokes) - BigInt(received) - BigInt(hole.par)) : null;
      const range = score?.kind === 'strokes' && (grossToPar === null || game.basis === 'net' && netToPar === null);
      return {
        number: hole.number, par: hole.par, grossToPar, netToPar, value: null, countingPlayerIds: [],
        status: reason || range ? 'unavailable' : !score || score.kind === 'unplayed' ? 'pending'
          : score.kind === 'strokes' ? 'complete' : 'ineligible',
      };
    });
    const overflow = holes.some((hole) => hole.status === 'unavailable');
    const strokeGame = { ...outcome(game.kind, holes),
      ...(reason ? { unavailableReason: reason } : overflow ? { unavailableReason: 'arithmetic-range' as const } : {}) };
    return {
      playerId: player.playerId, displayName: player.displayName, playingHandicap: reason ? null : handicap,
      holes: holes.map((hole) => ({ number: hole.number, points: null,
        strokesReceived: reason ? null : handicapStrokesForHole(handicap ?? 0,
          player.layout.find((entry) => entry.number === hole.number)?.allocation ?? 1, player.layout.length) })),
      ...summary(strokeGame),
      ...(reason ? { unavailableReason: reason } : {}),
    };
  });
  return aggregateStrokeGameResults(game, players);
}

export function aggregateStrokeGameResults(
  game: NewRoundGameDefinition, players: readonly GamePlayerResult[],
): RoundGameResult {
  const numbers = players[0]?.holes.map((hole) => hole.number) ?? [];
  if (game.kind === 'ball-drop') {
    if (!gameTeamsMatchRoster(game, players.map((player) => player.playerId))) {
      return { gameId: game.id, kind: game.kind, version: 1, players, teams: [], teamSetupRequired: true };
    }
    const playersById = new Map(players.map((player) => [player.playerId, player]));
    const teams: GameTeamResult[] = game.teams.map((team) => {
      const members = team.playerIds.flatMap((id) => {
        const player = playersById.get(id);
        return player ? [player] : [];
      });
      const holes = numbers.map((number): StrokeGameHole => {
        const entries = members.map((player) => ({ playerId: player.playerId,
          hole: player.strokeGame?.holes.find((hole) => hole.number === number) }));
        const base = { number, par: null, grossToPar: null, netToPar: null, value: null, countingPlayerIds: [] };
        if (entries.some((entry) => !entry.hole || entry.hole.status === 'unavailable')) return { ...base, status: 'unavailable' };
        if (entries.some((entry) => entry.hole?.status === 'pending')) return { ...base, status: 'pending' };
        let best: bigint | null = null;
        let countingPlayerIds: readonly string[] = [];
        for (const a of entries) for (const b of entries) {
          if (a.playerId === b.playerId || a.hole?.status !== 'complete' || b.hole?.status !== 'complete') continue;
          const first = game.format === 'ball-drop-two-gross' ? a.hole.grossToPar : a.hole.netToPar;
          const second = game.format === 'ball-drop-two-net' ? b.hole.netToPar : b.hole.grossToPar;
          if (first === null || second === null) continue;
          const value = BigInt(first) + BigInt(second);
          if (best === null || value < best) { best = value; countingPlayerIds = [a.playerId, b.playerId]; }
        }
        const value = best === null ? null : exact(best);
        return { ...base, value, countingPlayerIds, status: value === null ? 'unavailable' : 'complete' };
      });
      const score = outcome(game.kind, holes);
      const reason = members.find((member) => member.strokeGame?.unavailableReason)?.strokeGame?.unavailableReason
        ?? (holes.some((hole) => hole.status === 'unavailable' && hole.countingPlayerIds.length === 2)
          ? 'arithmetic-range' : holes.some((hole) => hole.status === 'unavailable') ? 'invalid-stroke-score' : undefined);
      return { teamId: team.id, displayName: team.name, playerIds: team.playerIds,
        holes: holes.map((hole) => ({ number: hole.number, points: null })),
        ...summary({ ...score, ...(reason ? { unavailableReason: reason } : {}) }) };
    });
    return { gameId: game.id, kind: game.kind, version: 1, players, teams };
  }
  const awards = new Map<string, StrokeGameHole[]>(players.map((player) => [player.playerId, []]));
  let carry = 0;
  let unawardedSkins = 0;
  let pendingSkins = 0;
  let blocked = false;
  for (const number of numbers) {
    const entries = players.map((player) => ({ player,
      hole: player.strokeGame?.holes.find((hole) => hole.number === number) }));
    const unknown = entries.some((entry) => !entry.hole || entry.hole.status === 'pending' || entry.hole.status === 'unavailable');
    if (unknown || game.carryovers && blocked) {
      pendingSkins++;
      blocked = true;
      for (const entry of entries) if (entry.hole) awards.get(entry.player.playerId)?.push({
        ...entry.hole, value: null, countingPlayerIds: [],
      });
      continue;
    }
    const eligible = entries.flatMap((entry) => {
      const value = entry.hole?.status === 'complete' ? game.basis === 'gross'
        ? entry.hole.grossToPar : entry.hole.netToPar : null;
      const par = entry.hole?.par;
      return value === null || par == null ? []
        : [{ playerId: entry.player.playerId, value: BigInt(value) + BigInt(par) }];
    });
    const low = eligible.reduce<bigint | null>((best, entry) => best === null || entry.value < best ? entry.value : best, null);
    const winners = eligible.filter((entry) => entry.value === low);
    const winner = winners.length === 1 ? winners[0]?.playerId : undefined;
    const prize = 1 + carry;
    if (winner) carry = 0;
    else if (game.carryovers) carry++;
    else unawardedSkins++;
    for (const entry of entries) if (entry.hole) awards.get(entry.player.playerId)?.push({
      ...entry.hole, value: winner === entry.player.playerId ? prize : 0,
      countingPlayerIds: winner ? [winner] : [],
    });
  }
  if (blocked && game.carryovers) pendingSkins += carry;
  else unawardedSkins += carry;
  const resolved = players.map((player): GamePlayerResult => {
    const score = outcome('skins', awards.get(player.playerId) ?? []);
    const reason = players.find((entry) => entry.strokeGame?.unavailableReason)?.strokeGame?.unavailableReason;
    return { ...player, ...summary({ ...score, ...(reason ? { unavailableReason: reason } : {}) }) };
  });
  return { gameId: game.id, kind: game.kind, version: 1, players: resolved, unawardedSkins, pendingSkins };
}
