import type { GameUnavailableReason, RoundGameDefinition } from '../../domain/games';
import { isTeamGameDefinition, sameGameDefinitions } from '../../domain/games';
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
  const preset = game.preset === 'standard' ? 'Standard Stableford' : 'Modified Stableford';
  const custom = !sameGameDefinitions([game], [{ ...game, points: stablefordPoints(game.preset) }]);
  const format = !isTeamGameDefinition(game) ? '' : game.format === 'two-net-better-ball'
    ? '2-man net Better Ball · ' : game.format === 'two-net-aggregate' ? '2-man net Aggregate · ' : '4-man 2-net Stableford · ';
  return `${format}${preset}${custom ? ' · Custom points' : ''} · ${game.basis === 'gross' ? 'Gross' : `Net · ${String(game.handicapAllowancePercent)}% allowance`}`;
}
