import type { StrokeGameUnavailableReason, RoundGameDefinition } from '../../domain/games';
import { isTeamGameDefinition, sameGameDefinitions } from '../../domain/games';
import { stablefordPoints } from '../../domain/stableford';

const reasons: Record<StrokeGameUnavailableReason, string> = {
  'missing-handicap-index': 'No captured Handicap Index is available.',
  'invalid-handicap-index': 'The captured Handicap Index cannot be used.',
  'missing-tee-ratings': 'Tee ratings are unavailable.',
  'missing-stroke-index': 'Hole stroke indexes are unavailable.',
  'missing-score-data': 'Score data is unavailable.',
  'invalid-stroke-score': 'Not enough eligible numeric saved strokes to calculate this hole.',
  'arithmetic-range': 'The stroke total exceeds the exact arithmetic range.',
};

export function gameUnavailableMessage(reason: StrokeGameUnavailableReason | undefined): string {
  return reasons[reason ?? 'missing-score-data'];
}

export function gameScoringLabel(game: RoundGameDefinition): string {
  if (game.kind === 'churchy') return 'Churchy Game · Experimental · Rotating partners · Relative Course Handicap · Earned dots';
  if (game.kind === 'ball-drop') return `Ball Drop · ${game.format === 'ball-drop-net-gross' ? '1 Net + 1 Gross'
    : game.format === 'ball-drop-two-net' ? '2 Net' : '2 Gross'} · 4-person teams · Lowest to par${game.basis === 'net' ? ' · 100% Course Handicap' : ''}`;
  if (game.kind === 'skins') return `${game.basis === 'gross' ? 'Gross' : 'Net'} Skins · ${game.carryovers ? 'Carryovers on' : 'Carryovers off'}${game.basis === 'net' ? ' · 100% Course Handicap' : ''}`;
  const preset = game.preset === 'standard' ? 'Standard Stableford' : 'Modified Stableford';
  const custom = !sameGameDefinitions([game], [{ ...game, points: stablefordPoints(game.preset) }]);
  const format = !isTeamGameDefinition(game) ? '' : game.format === 'two-net-better-ball'
    ? '2-man net Better Ball · ' : game.format === 'two-net-aggregate' ? '2-man net Aggregate · ' : '4-man 2-net Stableford · ';
  return `${format}${preset}${custom ? ' · Custom points' : ''} · ${game.basis === 'gross' ? 'Gross' : `Net · ${String(game.handicapAllowancePercent)}% allowance`}`;
}
