import type { DotsGameDefinition, DotsHoleRecord, DotsResults } from './dots.js';
import { dotsRotationContext } from './dots-rotation.js';
import type { DotAward } from './dot-context.js';
import type { GamePlayerResult } from './games.js';
import type { RoundGameScoringContext } from './game-declarations.js';
import { dotsInputFromScores, wolfInputFromScores } from './game-declarations.js';
import { gameHandicap } from './game-handicaps.js';
import { handicapStrokesForHole } from './handicap-strokes.js';
import { hasStrokeAllocation } from './tees.js';
import { compareHighLow } from './high-low.js';

export interface DotsHighLowContest {
  readonly kind: 'high' | 'low';
  readonly status: 'won' | 'tied' | 'pending' | 'unavailable';
  readonly winnerIds: readonly string[];
  readonly aScore: number | null;
  readonly bScore: number | null;
}
export interface DotsHighLowResults {
  readonly status: 'complete' | 'in-progress' | 'unavailable';
  readonly players: readonly GamePlayerResult[];
  readonly awards: readonly DotAward[];
  readonly holes: readonly {
    readonly number: number;
    readonly status: 'complete' | 'pending' | 'unavailable';
    readonly reason?: string;
    readonly sides: readonly (readonly string[])[];
    readonly contests: readonly DotsHighLowContest[];
  }[];
}

export function calculateDotsHighLow(game: DotsGameDefinition, context: RoundGameScoringContext,
  records: readonly DotsHoleRecord[]): DotsHighLowResults {
  const rotation = dotsRotationContext(game, dotsInputFromScores(context), records);
  const input = wolfInputFromScores(context);
  const handicaps = new Map(game.playerIds.map((playerId) => [playerId, game.highLow
    ? gameHandicap(game.highLow.handicapRule, playerId, input.players, context.groups) : 'invalid-high-low-game']));
  const awards: DotAward[] = [];
  const holes: DotsHighLowResults['holes'] = rotation.contexts.map((hole) => {
    const unresolved = (status: 'pending' | 'unavailable', reason: string) => ({
      number: hole.number, status, reason, sides: hole.sides,
      contests: (['high', 'low'] as const).map((kind) => ({ kind, status, winnerIds: [], aScore: null, bScore: null })),
    });
    if (game.mode !== 'rotating' || game.rotationHoles !== 3 || !game.highLow) return unresolved('unavailable', 'invalid-high-low-game');
    if (hole.status !== 'ready') return unresolved(hole.status, hole.reason ?? 'missing-dots-rotation');
    const players = game.playerIds.map((id) => input.players.find((player) => player.playerId === id));
    const scores = game.playerIds.map((id) => context.cards.find((card) => card.playerId === id)?.holes.find((entry) =>
      entry.number === hole.number)?.score);
    if (scores.some((score) => score === undefined)) return unresolved('unavailable', 'missing-score-data');
    if (scores.some((score) => score?.kind === 'unplayed')) return unresolved('pending', 'missing-score-data');
    const badHandicap = [...handicaps.values()].find((value) => typeof value !== 'number');
    if (badHandicap !== undefined) return unresolved('unavailable', badHandicap);
    if (players.some((player) => !player || !hasStrokeAllocation({
      holes: player.layout, strokeAllocation: player.strokeAllocation === true,
    }) || player.layout.length !== context.layout.length)) return unresolved('unavailable', 'missing-stroke-index');
    const numeric = new Map<string, number>();
    for (const [index, id] of game.playerIds.entries()) {
      const score = scores[index], player = players[index], handicap = handicaps.get(id);
      if (score?.kind !== 'strokes') continue;
      const own = player?.layout.find((entry) => entry.number === hole.number);
      if (!player || !own || !Number.isSafeInteger(score.strokes) || score.strokes < 1 || typeof handicap !== 'number') {
        return unresolved('unavailable', 'invalid-score-input');
      }
      const value = BigInt(score.strokes) - BigInt(handicapStrokesForHole(handicap, own.allocation, player.layout.length));
      if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) return unresolved('unavailable', 'arithmetic-range');
      numeric.set(id, Number(value));
    }
    const a = hole.sides[0], b = hole.sides[1];
    if (!a || !b || a.length !== 2 || b.length !== 2) return unresolved('unavailable', 'invalid-dots-rotation');
    const balls = (ids: readonly string[]) => ids.flatMap((id) => {
      const value = numeric.get(id);
      return value === undefined ? [] : [value];
    });
    const contests = (['high', 'low'] as const).map((kind): DotsHighLowContest => {
      const contest = compareHighLow(kind, balls(a), 2, balls(b), 2);
      const winnerIds = contest.winner === 'a' ? a : contest.winner === 'b' ? b : [];
      if (winnerIds.length) awards.push({
        id: `${game.id}:${String(hole.number)}:high-low:${kind}`, number: hole.number, kind, source: 'derived',
        earnedBy: null, recipientIds: winnerIds, units: 1, count: 1, multiplier: 1, dots: 1, sourceHoles: [hole.number],
        scores: game.playerIds.flatMap((id, index) => {
          const personal = players[index]?.layout.find((entry) => entry.number === hole.number), score = scores[index];
          return personal ? [{ playerId: id, number: hole.number, strokes: score?.kind === 'strokes' ? score.strokes : null, par: personal.par }] : [];
        }), reason: `Saved Modified Sixes ${kind}; one dot per winning teammate, no tie carry.`,
      });
      return { kind, status: contest.status, winnerIds, aScore: contest.aScore, bScore: contest.bScore };
    });
    return { number: hole.number, status: contests.some((contest) => contest.status === 'unavailable') ? 'unavailable' : 'complete',
      sides: hole.sides, contests };
  });
  const status = holes.some((hole) => hole.status === 'unavailable') ? 'unavailable'
    : holes.every((hole) => hole.status === 'complete') ? 'complete' : 'in-progress';
  const players: readonly GamePlayerResult[] = game.playerIds.map((id) => {
    const points = holes.map((hole) => {
      const player = input.players.find((entry) => entry.playerId === id);
      const own = player?.layout.find((entry) => entry.number === hole.number);
      const handicap = handicaps.get(id);
      return { number: hole.number, strokesReceived: own && player && typeof handicap === 'number'
        && hasStrokeAllocation({ holes: player.layout, strokeAllocation: player.strokeAllocation === true })
        ? handicapStrokesForHole(handicap, own.allocation, player.layout.length) : null,
      points: hole.status === 'complete' ? hole.contests.filter((contest) => contest.winnerIds.includes(id)).length : null };
    });
    const subtotal = (front?: boolean) => {
      const known = points.filter((hole) => hole.points !== null && (front === undefined || (hole.number <= 9) === front));
      return known.length ? known.reduce((sum, hole) => sum + (hole.points ?? 0), 0) : null;
    };
    const handicap = handicaps.get(id);
    return { playerId: id, displayName: context.cards.find((card) => card.playerId === id)?.displayName ?? 'Golfer unavailable',
      playingHandicap: typeof handicap === 'number' ? handicap : null, status, holes: points,
      holesScored: holes.filter((hole) => hole.status === 'complete').length, totalHoles: holes.length,
      frontPoints: subtotal(true), backPoints: subtotal(false), totalPoints: subtotal() };
  });
  return { status, players, holes, awards };
}

export function combinedDotsPlayers(specials: DotsResults, base: DotsHighLowResults): readonly GamePlayerResult[] {
  return specials.players.map((player) => {
    const match = base.players.find((entry) => entry.playerId === player.playerId);
    let status: GamePlayerResult['status'] = player.status === 'unavailable' || !match || match.status === 'unavailable' ? 'unavailable'
      : player.status === 'complete' && match.status === 'complete' ? 'complete' : 'in-progress';
    const sum = (a: number | null, b: number | null) => {
      if (a === null && b === null || status === 'unavailable') return null;
      const value = BigInt(a ?? 0) + BigInt(b ?? 0);
      if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
        status = 'unavailable';
        return null;
      }
      return Number(value);
    };
    const holes = player.holes.map((hole) => {
        const other = match?.holes.find((entry) => entry.number === hole.number);
        return { ...hole, strokesReceived: other?.strokesReceived ?? null,
          points: hole.points === null || other?.points == null ? null : sum(hole.points, other.points) };
      });
    const frontPoints = sum(player.frontPoints, match?.frontPoints ?? null);
    const backPoints = sum(player.backPoints, match?.backPoints ?? null);
    const totalPoints = sum(player.totalPoints, match?.totalPoints ?? null);
    return { ...player, status, playingHandicap: match?.playingHandicap ?? null, holes,
      holesScored: holes.filter((hole) => hole.points !== null).length,
      frontPoints: status === 'unavailable' ? null : frontPoints,
      backPoints: status === 'unavailable' ? null : backPoints,
      totalPoints: status === 'unavailable' ? null : totalPoints };
  });
}
