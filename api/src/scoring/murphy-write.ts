import type { HoleScore } from '../../../src/domain/scoring.js';
import type { DotRoundInput } from '../../../src/domain/dot-context.js';
import { dotsCallResult } from '../../../src/domain/dots.js';
import { ApiError } from '../errors.js';

/** Old clients may echo the manual projection, but cannot erase or override a retained call's scoring policy. */
export function retainMurphyTargets(score: HoleScore, saved: HoleScore, round: DotRoundInput): HoleScore {
  const extras = score.churchy, previous = saved.churchy;
  if (extras?.version !== 3 || previous?.version !== 3 || extras.gameId !== previous.gameId || extras.number !== previous.number) return score;
  return { ...score, churchy: { ...extras, players: extras.players.map((player) => ({ ...player,
    calls: player.calls.map((call) => {
      const priorPlayer = previous.players.find((entry) => entry.calls.some((entry) => entry.id === call.id));
      const prior = priorPlayer?.calls.find((entry) => entry.id === call.id);
      if (prior?.murphyTarget === undefined && prior?.pareeTarget === undefined) return call;
      const paree = prior.pareeTarget !== undefined;
      if (paree ? call.pareeTarget !== undefined : call.murphyTarget !== undefined) return call;
      const raw = round.cards.find((card) => card.playerId === player.playerId)?.holes.find((hole) => hole.number === extras.number)?.score;
      const par = (round.playerLayouts?.find((entry) => entry.playerId === player.playerId)?.layout ?? round.layout)
        .find((hole) => hole.number === extras.number)?.par;
      if (priorPlayer?.playerId !== player.playerId || call.kind !== prior.kind || call.result !== dotsCallResult(prior, raw, par)) {
        throw new ApiError(409, paree ? 'CHURCHY_PAREE_REFRESH_REQUIRED' : 'CHURCHY_MURPHY_REFRESH_REQUIRED');
      }
      return { ...call, result: 'pending' as const,
        ...(prior.pareeTarget !== undefined ? { pareeTarget: prior.pareeTarget } : {}),
        ...(prior.murphyTarget !== undefined ? { murphyTarget: prior.murphyTarget } : {}) };
    }),
  })) } };
}
