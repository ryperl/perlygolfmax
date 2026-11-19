import type { HoleScore, RoundScores, ScoreChange } from './scoring.js';
import type { DotsCall } from './dots.js';
import { dotsCallResult } from './dots.js';
import { calculateChurchyResults } from './churchy.js';
import { calculateInternalGameResults } from './internal-games.js';

export class DotsCallsClientUpdateRequired extends Error {
  readonly status = 426;
  readonly code = 'DOTS_CALLS_CLIENT_UPDATE_REQUIRED';
  constructor() { super('Refresh the client before using Dots call presses.'); }
}

export function requireLegacyDotsCalls(scores: readonly HoleScore[]): void {
  if (scores.some((score) => score.dots?.some((record) => record.players.some((player) =>
    player.calls.some((call) => (call.murphyPresses ?? 0) > 0))))) throw new DotsCallsClientUpdateRequired();
}

function sameTransportValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length
    && left.every((entry: unknown, index) => sameTransportValue(entry, right[index]));
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    const entries = Object.entries(left), other = Object.entries(right);
    return entries.length === other.length && entries.every(([key, value]) =>
      other.some(([name, entry]) => name === key && sameTransportValue(value, entry)));
  }
  return left === right;
}

function legacyDotsScore(score: HoleScore, round?: RoundScores): HoleScore {
  requireLegacyDotsCalls([score]);
  if (!score.dots) return score;
  return { ...score, dots: score.dots.map((record) => ({ ...record,
    players: record.players.map((player) => ({ ...player, calls: player.calls.map((call): DotsCall => {
      const saved = round?.cards.find((card) => card.playerId === player.playerId)?.holes.find((hole) => hole.number === record.number)?.score;
      const par = (round?.playerTees?.find((entry) => entry.playerId === player.playerId)?.profile.holes ?? round?.layout)
        ?.find((hole) => hole.number === record.number)?.par;
      return { id: call.id, kind: call.kind, result: round ? dotsCallResult(call, saved, par) : call.result };
    }) })),
  })) };
}

/** History deliberately omits current context rather than inventing an outcome at an earlier revision. */
export function legacyMurphyScore(score: HoleScore, round?: RoundScores, murphyTargets = false, pareeTargets = false, dotsCalls = false): HoleScore {
  if (!dotsCalls) score = legacyDotsScore(score, round);
  const extras = score.churchy;
  const project = (call: DotsCall) => !murphyTargets && call.murphyTarget !== undefined
    || !pareeTargets && call.pareeTarget !== undefined;
  if (extras?.version !== 3 || !extras.players.some((player) => player.calls.some(project))) return score;
  return { ...score, churchy: { ...extras, players: extras.players.map((player) => ({ ...player,
    calls: player.calls.map((call): DotsCall => {
      if (!project(call)) return call;
      const manual: DotsCall = { id: call.id, kind: call.kind, result: call.result,
        ...(call.murphyPresses === undefined ? {} : { murphyPresses: call.murphyPresses }),
        ...(murphyTargets && call.murphyTarget !== undefined ? { murphyTarget: call.murphyTarget } : {}),
        ...(pareeTargets && call.pareeTarget !== undefined ? { pareeTarget: call.pareeTarget } : {}) };
      const saved = round?.cards.find((card) => card.playerId === player.playerId)?.holes.find((hole) => hole.number === extras.number)?.score;
      const par = (round?.playerTees?.find((entry) => entry.playerId === player.playerId)?.profile.holes ?? round?.layout)
        ?.find((hole) => hole.number === extras.number)?.par;
      return { ...manual, result: round ? dotsCallResult(call, saved, par) : call.result };
    }),
  })) } };
}

export function murphyRoundScores(round: RoundScores, negotiated = false, pareeTargets = false, dotsCalls = false): RoundScores {
  const { churchyMurphyTargets, churchyPareeTargets, dotsCallTargets, ...base } = round;
  const enabled = round.churchyEnabled === true && round.churchyRulesVersions?.includes(3)
    && round.permissions?.role !== 'tester';
  const legacy: RoundScores = { ...base,
    ...(negotiated && enabled ? { churchyMurphyTargets: true } : {}),
    ...(pareeTargets && enabled ? { churchyPareeTargets: true } : {}),
    ...(dotsCalls && round.internalGamesSupported === true && round.supportedGameKinds?.includes('dots')
      && round.permissions?.role !== 'tester' ? { dotsCallTargets: true } : {}) };
  if (!round.cards.some((card) => card.holes.some((hole) =>
    !dotsCalls && hole.score.dots?.some((record) => record.players.some((player) => player.calls.some((call) =>
      call.murphyTarget !== undefined || call.pareeTarget !== undefined || call.murphyPresses !== undefined)))
    || hole.score.churchy?.version === 3 && hole.score.churchy.players.some((player) => player.calls.some((call) =>
      !negotiated && call.murphyTarget !== undefined || !pareeTargets && call.pareeTarget !== undefined))))) {
    return churchyMurphyTargets === legacy.churchyMurphyTargets && churchyPareeTargets === legacy.churchyPareeTargets
      && dotsCallTargets === legacy.dotsCallTargets ? round : legacy;
  }
  const cards = round.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole,
    score: legacyMurphyScore(hole.score, round, negotiated, pareeTargets, dotsCalls) })) }));
  const games = round.games;
  if (!games) return { ...legacy, cards };
  const internal = calculateInternalGameResults(games.configuration.games, { ...round, cards,
    dotsCategorySweepsVersion: round.dotsCategorySweepsVersion ?? 0,
    stringRulesVersion: round.stringRulesVersion ?? 1 });
  const results = games.results.map((result) => {
    const game = games.configuration.games.find((entry) => entry.id === result.gameId);
    if (game?.kind === 'dots' || game?.kind === 'wolf') {
      const projected = internal.get(game.id) ?? result;
      if (!dotsCalls && !sameTransportValue(projected, result)) throw new DotsCallsClientUpdateRequired();
      return projected;
    }
    if (game?.kind !== 'churchy' || game.version !== 3) return result;
    const group = round.groups.find((entry) => entry.number === game.groupNumber);
    return calculateChurchyResults(game, cards.map((card) => {
      const personal = round.playerTees?.find((entry) => entry.playerId === card.playerId)?.profile;
      return { playerId: card.playerId, displayName: card.displayName, layout: personal?.holes ?? round.layout,
        handicap: !(personal?.strokeAllocation ?? round.teeStrokeAllocation) ? 'missing-stroke-index'
          : round.courseHandicaps?.find((entry) => entry.playerId === card.playerId)?.courseHandicap ?? 'missing-handicap-index' };
    }), cards, group?.playerIds.length === 4 && group.playerIds.every((id) => game.playerIds.includes(id)), round.groups, round.layout,
    round.stringRulesVersion ?? 1);
  });
  return { ...legacy, cards, games: { ...games, results } };
}

export function murphyScoreChange(change: ScoreChange, negotiated = false, round?: RoundScores, pareeTargets = false, dotsCalls = false): ScoreChange {
  return negotiated && pareeTargets && dotsCalls ? change : { ...change,
    before: legacyMurphyScore(change.before, undefined, negotiated, pareeTargets, dotsCalls),
    after: legacyMurphyScore(change.after, round, negotiated, pareeTargets, dotsCalls) };
}
