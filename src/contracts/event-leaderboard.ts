import type { EventLeaderboardView, EventStandings } from '../domain/event-leaderboard.js';
import { calculateEventStandings } from '../domain/event-leaderboard.js';
import type { RoundScores } from '../domain/scoring.js';
import type { EventWorkspace } from '../domain/setup.js';
import { isRecord } from './events.js';
import { isRoundScores } from './scoring.js';
import { isEventWorkspace } from './setup.js';
import { roundScoresMatchWorkspace, sameJsonValue } from './round-context.js';

export function isEventStandings(
  value: unknown, workspace: EventWorkspace, roundScores: readonly RoundScores[],
): value is EventStandings {
  return sameJsonValue(value, calculateEventStandings(workspace, roundScores));
}

export function isEventLeaderboardView(value: unknown): value is EventLeaderboardView {
  if (!isRecord(value) || Object.keys(value).length !== 3
    || !Object.keys(value).every((key) => ['workspace', 'roundScores', 'standings'].includes(key))
    || !isEventWorkspace(value.workspace) || !Array.isArray(value.roundScores)) return false;
  const workspace = value.workspace;
  if (workspace.overallCompetition === undefined) {
    return value.roundScores.length === 0 && isEventStandings(value.standings, workspace, []);
  }
  if (value.roundScores.length !== workspace.rounds.length || !value.roundScores.every(isRoundScores)) return false;
  const rounds: readonly RoundScores[] = value.roundScores;
  if (!roundScoresMatchWorkspace(workspace, rounds)) return false;
  return isEventStandings(value.standings, workspace, rounds);
}
