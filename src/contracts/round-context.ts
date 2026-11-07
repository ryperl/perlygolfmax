import type { RoundScores } from '../domain/scoring.js';
import type { EventWorkspace, RoundSnapshot } from '../domain/setup.js';
import { calculateGameResults } from '../domain/stableford.js';
import { isRecord } from './events.js';
import { publishedCourseHandicaps, publishedPlayingHandicaps } from '../domain/playing-handicaps.js';

export function sameJsonValue(value: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(value) && value.length === expected.length
      && expected.every((entry: unknown, index: number) => sameJsonValue(value[index], entry));
  }
  if (isRecord(expected)) {
    return isRecord(value) && Object.keys(value).length === Object.keys(expected).length
      && Object.keys(expected).every((key) => Object.hasOwn(value, key) && sameJsonValue(value[key], expected[key]));
  }
  return value === expected;
}

export function roundMatchesSnapshot(workspace: EventWorkspace, snapshot: RoundSnapshot, round: RoundScores): boolean {
  const players = new Map(snapshot.players.map((player) => [player.playerId, player.displayName]));
  const holes = new Map(snapshot.teeProfile.holes.map((hole) => [hole.number, hole]));
  const competition = workspace.overallCompetition;
  const permissionsMatch = workspace.event.role === 'owner'
    ? round.permissions === undefined || round.permissions.role === 'owner'
    : workspace.canViewScores === true && round.permissions !== undefined
      && round.permissions.role === (workspace.publicAccess ? 'public' : workspace.testerAccess ? 'tester' : workspace.viewerPlayerId ? 'player' : 'viewer')
      && round.permissions.viewerPlayerId === workspace.viewerPlayerId;
  const publishedMatches = round.overallHandicaps === undefined
    || competition?.kind === 'stroke-play' && competition.basis === 'net'
      && round.overallHandicaps.allowancePercent === competition.handicapAllowancePercent
      && (workspace.event.role !== 'owner'
        || sameJsonValue(round.overallHandicaps, publishedPlayingHandicaps(snapshot, competition.handicapAllowancePercent)));
  return round.eventId === workspace.event.id && round.eventName === workspace.event.name
    && round.eventStatus === workspace.event.status && round.roundId === snapshot.id && round.roundName === snapshot.name
    && round.courseName === snapshot.course.name && round.teeName === snapshot.teeProfile.name
    && round.teeCategory === snapshot.teeProfile.category
    && permissionsMatch
    && publishedMatches
    && (round.courseHandicaps === undefined || workspace.event.role !== 'owner'
      || sameJsonValue(round.courseHandicaps, publishedCourseHandicaps(snapshot)))
    && sameJsonValue(round.playerTees ?? [], snapshot.playerTees ?? [])
    && sameJsonValue(round.groups, snapshot.groups)
    && round.layout.length === holes.size
    && round.layout.every((hole) => sameJsonValue(hole, holes.get(hole.number)))
    && (round.teeRatings === undefined || sameJsonValue(round.teeRatings, snapshot.teeProfile.ratings))
    && round.cards.length === players.size
    && round.cards.every((card) => players.get(card.playerId) === card.displayName)
    && (round.games === undefined || (workspace.event.role === 'owner'
      ? sameJsonValue(round.games.results, calculateGameResults(round.games.configuration.games, snapshot, round.cards))
      : round.games.configuration.games.filter((game) => game.basis === 'gross').every((game) =>
        sameJsonValue(round.games?.results.find((result) => result.gameId === game.id),
          calculateGameResults([game], snapshot, round.cards)[0]))));
}

export function roundScoresMatchWorkspace(workspace: EventWorkspace, rounds: readonly RoundScores[]): boolean {
  const byId = new Map(rounds.map((round) => [round.roundId, round]));
  return rounds.length === workspace.rounds.length && byId.size === rounds.length
    && workspace.rounds.every((snapshot) => {
      const round = byId.get(snapshot.id);
      return round !== undefined && roundMatchesSnapshot(workspace, snapshot, round);
    });
}
