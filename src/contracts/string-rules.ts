import type { RoundScores } from '../domain/scoring.js';
import { calculateInternalGameResults } from '../domain/internal-games.js';
import { calculateChurchyResults } from '../domain/churchy.js';
import { sameJsonValue } from './round-context.js';

export class StringRulesClientUpdateRequired extends Error {
  readonly status = 426;
  readonly code = 'STRING_RULES_CLIENT_UPDATE_REQUIRED';
  constructor() { super('Refresh the client before using the corrected String rules.'); }
}

/** Never substitute legacy totals: only omit metadata when the old decoder agrees. */
export function stringRoundScores(round: RoundScores, negotiated = false): RoundScores {
  if (negotiated) return { ...round, stringRulesVersion: 2 };
  const legacy = { ...round };
  delete legacy.stringRulesVersion;
  const games = round.games?.configuration.games ?? [];
  if (round.stringRulesVersion !== 2 || !games.some((game) =>
    (game.kind === 'dots' || game.kind === 'churchy' && game.version === 3)
      && game.specials.some((special) => special.kind === 'string' || special.kind === 'birdy-string'))) return legacy;
  const context = { ...round, stringRulesVersion: 1 as const, dotsCategorySweepsVersion: round.dotsCategorySweepsVersion ?? 0 as const };
  const internal = calculateInternalGameResults(games, context);
  for (const result of round.games?.results ?? []) {
    const game = games.find((entry) => entry.id === result.gameId);
    if (game?.kind === 'dots' || game?.kind === 'wolf') {
      if (!sameJsonValue(result, internal.get(game.id))) throw new StringRulesClientUpdateRequired();
    } else if (game?.kind === 'churchy' && game.version === 3) {
      const group = round.groups.find((entry) => entry.number === game.groupNumber);
      const expected = calculateChurchyResults(game, round.cards.map((card) => {
        const personal = round.playerTees?.find((entry) => entry.playerId === card.playerId)?.profile;
        return { playerId: card.playerId, displayName: card.displayName, layout: personal?.holes ?? round.layout,
          handicap: !(personal?.strokeAllocation ?? round.teeStrokeAllocation) ? 'missing-stroke-index'
            : round.courseHandicaps?.find((entry) => entry.playerId === card.playerId)?.courseHandicap ?? 'missing-handicap-index' };
      }), round.cards, group?.playerIds.length === 4 && group.playerIds.every((id) => game.playerIds.includes(id)),
      round.groups, round.layout, 1);
      if (!sameJsonValue(result, expected)) throw new StringRulesClientUpdateRequired();
    }
  }
  return legacy;
}
