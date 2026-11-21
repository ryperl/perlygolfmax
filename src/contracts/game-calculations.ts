import type { RoundGameDefinition } from '../domain/games.js';
import type { RoundScores } from '../domain/scoring.js';
import { groupStartingHole } from '../domain/round-navigation.js';

type CalculationContext = Pick<RoundScores, 'cards' | 'groups' | 'layout' | 'courseHandicaps' | 'games'>;

export class GameCalculationsClientUpdateRequired extends Error {
  readonly status = 426;
  readonly code = 'GAME_CALCULATIONS_CLIENT_UPDATE_REQUIRED';
  constructor() { super('Refresh the client before using updated game calculation and special-review rules.'); }
}

export function needsUpdatedGameCalculations(
  round: CalculationContext, games: readonly RoundGameDefinition[] = round.games?.configuration.games ?? [], writing = false,
): boolean {
  if (round.cards.some((card) => card.holes.some((hole) => [
    ...(hole.score.dots ?? []), ...(hole.score.churchy?.version === 3 ? [hole.score.churchy] : []),
  ].some((record) => record.players.some((player) => player.calls.some((call) => call.pullyMurphyTarget !== undefined)))))) return true;
  if (round.games?.results.some((result) => result.dots?.reviewRequired?.length || result.churchy?.reviewRequired?.length)) return true;
  return games.some((game) => {
    if (game.kind === 'wolf' && game.version === 2 && game.basis === 'net' && game.handicapRule === 'full-course-v1') {
      const group = round.groups.find((group) => group.number === game.groupNumber);
      return writing || round.courseHandicaps?.some((player) => group?.playerIds.includes(player.playerId)
        && typeof player.courseHandicap === 'number' && player.courseHandicap < 0) === true;
    }
    return game.kind === 'nassau' && game.playOrder === 'shared-group-v1'
      && groupStartingHole(round.groups.find((group) => group.number === game.groupNumber), round.layout) !== round.layout[0]?.number;
  });
}

export function requireGameCalculations(
  round: CalculationContext, supported: boolean, games?: readonly RoundGameDefinition[], writing = false,
): void {
  if (!supported && needsUpdatedGameCalculations(round, games, writing)) throw new GameCalculationsClientUpdateRequired();
}

export function gameCalculationRoundScores(round: RoundScores, supported = false): RoundScores {
  if (supported) return round;
  requireGameCalculations(round, false);
  const legacy = { ...round };
  delete legacy.gameCalculationsVersion;
  delete legacy.pullyMurphyTargets;
  return legacy;
}
