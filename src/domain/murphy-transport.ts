import type { HoleScore, RoundScores, ScoreChange } from './scoring.js';
import type { DotsCall } from './dots.js';
import { dotsCallResult } from './dots.js';
import { calculateChurchyResults } from './churchy.js';

/** History deliberately omits current context rather than inventing an outcome at an earlier revision. */
export function legacyMurphyScore(score: HoleScore, round?: RoundScores): HoleScore {
  const extras = score.churchy;
  if (extras?.version !== 3 || !extras.players.some((player) => player.calls.some((call) => call.murphyTarget !== undefined))) return score;
  return { ...score, churchy: { ...extras, players: extras.players.map((player) => ({ ...player,
    calls: player.calls.map((call): DotsCall => {
      if (call.murphyTarget === undefined) return call;
      const manual: DotsCall = { id: call.id, kind: call.kind, result: call.result,
        ...(call.murphyPresses === undefined ? {} : { murphyPresses: call.murphyPresses }) };
      const saved = round?.cards.find((card) => card.playerId === player.playerId)?.holes.find((hole) => hole.number === extras.number)?.score;
      const par = (round?.playerTees?.find((entry) => entry.playerId === player.playerId)?.profile.holes ?? round?.layout)
        ?.find((hole) => hole.number === extras.number)?.par;
      return { ...manual, result: round ? dotsCallResult(call, saved, par) : call.result };
    }),
  })) } };
}

export function murphyRoundScores(round: RoundScores, negotiated = false): RoundScores {
  if (negotiated) return round.churchyEnabled === true && round.churchyRulesVersions?.includes(3)
    && round.permissions?.role !== 'tester' ? { ...round, churchyMurphyTargets: true } : round;
  const { churchyMurphyTargets, ...legacy } = round;
  if (!round.cards.some((card) => card.holes.some((hole) => hole.score.churchy?.version === 3
    && hole.score.churchy.players.some((player) => player.calls.some((call) => call.murphyTarget !== undefined))))) {
    return churchyMurphyTargets === undefined ? round : legacy;
  }
  const cards = round.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole, score: legacyMurphyScore(hole.score, round) })) }));
  const games = round.games;
  if (!games) return { ...legacy, cards };
  const results = games.results.map((result) => {
    const game = games.configuration.games.find((entry) => entry.id === result.gameId);
    if (game?.kind !== 'churchy' || game.version !== 3) return result;
    const group = round.groups.find((entry) => entry.number === game.groupNumber);
    return calculateChurchyResults(game, cards.map((card) => {
      const personal = round.playerTees?.find((entry) => entry.playerId === card.playerId)?.profile;
      return { playerId: card.playerId, displayName: card.displayName, layout: personal?.holes ?? round.layout,
        handicap: !(personal?.strokeAllocation ?? round.teeStrokeAllocation) ? 'missing-stroke-index'
          : round.courseHandicaps?.find((entry) => entry.playerId === card.playerId)?.courseHandicap ?? 'missing-handicap-index' };
    }), cards, group?.playerIds.length === 4 && group.playerIds.every((id) => game.playerIds.includes(id)), round.groups, round.layout);
  });
  return { ...legacy, cards, games: { ...games, results } };
}

export function murphyScoreChange(change: ScoreChange, negotiated = false, round?: RoundScores): ScoreChange {
  return negotiated ? change : { ...change, before: legacyMurphyScore(change.before), after: legacyMurphyScore(change.after, round) };
}
