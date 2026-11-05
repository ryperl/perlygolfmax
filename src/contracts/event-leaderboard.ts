import type { EventLeaderboardView, EventStandings } from '../domain/event-leaderboard.js';
import { calculateEventStandings } from '../domain/event-leaderboard.js';
import type { RoundScores } from '../domain/scoring.js';
import type { EventWorkspace, RoundSnapshot } from '../domain/setup.js';
import { calculateGameResults } from '../domain/stableford.js';
import { isRecord } from './events.js';
import { isRoundScores } from './scoring.js';
import { isEventWorkspace } from './setup.js';

function same(value: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(value) && value.length === expected.length
      && expected.every((entry: unknown, index: number) => same(value[index], entry));
  }
  if (isRecord(expected)) {
    return isRecord(value) && Object.keys(value).length === Object.keys(expected).length
      && Object.keys(expected).every((key) => Object.hasOwn(value, key) && same(value[key], expected[key]));
  }
  return value === expected;
}

function matchesSnapshot(workspace: EventWorkspace, snapshot: RoundSnapshot, round: RoundScores): boolean {
  return round.eventId === workspace.event.id && round.eventName === workspace.event.name
    && round.eventStatus === workspace.event.status && round.roundId === snapshot.id && round.roundName === snapshot.name
    && round.courseName === snapshot.course.name && round.teeName === snapshot.teeProfile.name
    && round.teeCategory === snapshot.teeProfile.category
    && same(round.groups, snapshot.groups)
    && round.layout.length === snapshot.teeProfile.holes.length
    && round.layout.every((hole) => same(hole, snapshot.teeProfile.holes.find((entry) => entry.number === hole.number)))
    && (round.teeRatings === undefined || same(round.teeRatings, snapshot.teeProfile.ratings))
    && round.cards.length === snapshot.players.length
    && round.cards.every((card) => snapshot.players.some((player) =>
      player.playerId === card.playerId && player.displayName === card.displayName))
    && (round.games === undefined || same(round.games.results,
      calculateGameResults(round.games.configuration.games, snapshot, round.cards)));
}

export function isEventStandings(
  value: unknown, workspace: EventWorkspace, roundScores: readonly RoundScores[],
): value is EventStandings {
  return same(value, calculateEventStandings(workspace, roundScores));
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
  if (new Set(rounds.map((round) => round.roundId)).size !== rounds.length
    || !workspace.rounds.every((snapshot) => {
      const round = rounds.find((entry) => entry.roundId === snapshot.id);
      return round !== undefined && matchesSnapshot(workspace, snapshot, round);
    })) return false;
  return isEventStandings(value.standings, workspace, rounds);
}
