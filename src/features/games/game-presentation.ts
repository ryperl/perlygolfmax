import type { GameUnavailableReason, RoundGameDefinition } from '../../domain/games';
import { sameGameDefinitions } from '../../domain/games';
import { stablefordPoints } from '../../domain/stableford';

const reasons: Record<GameUnavailableReason, string> = {
  'missing-handicap-index': 'No captured Handicap Index is available.',
  'invalid-handicap-index': 'The captured Handicap Index cannot be used.',
  'missing-tee-ratings': 'Tee ratings are unavailable.',
  'missing-stroke-index': 'Hole stroke indexes are unavailable.',
  'missing-score-data': 'Score data is unavailable.',
};

export function gameUnavailableMessage(reason: GameUnavailableReason | undefined): string {
  return reasons[reason ?? 'missing-score-data'];
}

export function gameScoringLabel(game: RoundGameDefinition): string {
  return !sameGameDefinitions([game], [{ ...game, points: stablefordPoints(game.preset) }]) ? 'Custom points'
    : game.preset === 'standard' ? 'Standard Stableford' : 'Modified Stableford';
}
