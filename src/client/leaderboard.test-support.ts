import { fictionalId, fictionalWorkspace } from './catalog.test-support';
import { fictionalRoundScores } from './scoring.test-support';
import type { GamePlayerResult, RoundGameDefinition, TeamGameDefinition } from '../domain/games';
import type { HoleScore, RoundScores } from '../domain/scoring';
import { calculateGameResults, stablefordPoints } from '../domain/stableford';

export function fictionalStanding(number: number, points: number | null, holes = 1): GamePlayerResult {
  const scored = points === null ? 0 : holes;
  return {
    playerId: fictionalId(number), displayName: `Fictional golfer ${String(number)}`,
    playingHandicap: 0, status: scored === 9 ? 'complete' : 'in-progress',
    holesScored: scored, totalHoles: 9, frontPoints: points, backPoints: null, totalPoints: points,
    holes: Array.from({ length: 9 }, (_, index) => ({
      number: index + 1, points: index >= scored ? null : index === 0 ? points : 0, strokesReceived: 0,
    })),
  };
}
export const leaderboardGames: readonly RoundGameDefinition[] = [
  { id: fictionalId(701), name: 'Fictional modified net', preset: 'modified', basis: 'net', handicapAllowancePercent: 95, points: stablefordPoints('modified') },
  { id: fictionalId(702), name: 'Fictional modified gross', preset: 'modified', basis: 'gross', handicapAllowancePercent: 100, points: stablefordPoints('modified') },
];
const captured = fictionalWorkspace.rounds[0];
if (!captured) throw new Error('Missing fictional captured course.');
const players = Array.from({ length: 6 }, (_, index) => ({
  playerId: fictionalId(index + 1), displayName: `Fictional golfer ${String(index + 1)}`,
  handicapIndex: index === 5 ? null : {
    id: fictionalId(800 + index), value: '0', effectiveDate: '2026-01-01', source: 'Fictional capture',
    recordedAt: '2026-01-01T00:00:00Z', recordedBy: { tenantId: fictionalId(201), objectId: fictionalId(202) },
    previousObservationId: null,
  },
}));
const groups = [{ number: 1, playerIds: players.slice(0, 4).map((player) => player.playerId) },
  { number: 2, playerIds: players.slice(4).map((player) => player.playerId) }];
const raw = [[4], [3, 3], [3, 3, 4, 4, 4, 4, 4, 4, 4], [6, 4, 4, 4, 4, 4, 4, 4, 4], [], [3, 3, 3, 3, 3, 3, 3, 3, 3]];
const cards: RoundScores['cards'] = players.map((player, index) => ({
  playerId: player.playerId, displayName: player.displayName, etag: 'card-v1', updatedAt: '2026-01-01T00:00:00Z',
  holes: fictionalRoundScores.layout.map((hole, holeIndex) => {
    const strokes = raw[index]?.[holeIndex];
    const score: HoleScore = strokes === undefined ? { kind: 'unplayed' } : { kind: 'strokes', strokes };
    return { number: hole.number, score };
  }),
}));
const results = calculateGameResults(leaderboardGames, { ...captured, players, groups }, cards);
const primary = results[0];
if (!primary) throw new Error('Missing fictional game results.');
export const leaderboardPlayers: readonly GamePlayerResult[] = primary.players;
export const leaderboardRound: RoundScores = {
  ...fictionalRoundScores, cards, groups, setupLocked: true, lastUpdatedAt: '2026-01-01T00:00:00Z',
  permissions: { role: 'owner', writePlayerIds: cards.map((card) => card.playerId), canManageGames: true },
  games: {
    configuration: { eventId: fictionalRoundScores.eventId, roundId: fictionalRoundScores.roundId, etag: 'games-v1', games: leaderboardGames },
    results,
  },
};

export const teamLeaderboardGame: TeamGameDefinition = {
  id: fictionalId(703), name: 'Fictional team Better Ball', format: 'two-net-better-ball',
  preset: 'modified', basis: 'net', handicapAllowancePercent: 100, points: stablefordPoints('modified'),
  teams: [0, 1, 2].map((index) => ({
    id: fictionalId(900 + index), name: `Fictional team ${String(index + 1)}`,
    playerIds: players.slice(index * 2, index * 2 + 2).map((player) => player.playerId),
  })),
};
export const teamLeaderboardRound: RoundScores = {
  ...leaderboardRound,
  games: {
    configuration: { eventId: leaderboardRound.eventId, roundId: leaderboardRound.roundId, etag: 'team-games-v1', games: [teamLeaderboardGame] },
    results: calculateGameResults([teamLeaderboardGame], { ...captured, players, groups }, cards),
  },
};
