import type { EventLeaderboardView } from '../../src/domain/event-leaderboard';
import type { RoundScores } from '../../src/domain/scoring';
import type { EventWorkspace } from '../../src/domain/setup';
import { fictionalGamesRound } from './games-fixture-data';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const players = fictionalGamesRound.cards.map((card, index) => ({ playerId: card.playerId,
  displayName: index === 1 ? 'Fictional golfer with a long display name' : card.displayName }));
export const overallWorkspace: EventWorkspace = {
  event: { id: id(50), name: 'Fictional overall event', role: 'owner', status: 'active', etag: 'fixture-v1', createdAt: '2026-01-01T00:00:00Z' },
  etag: 'fixture-v1', location: 'Fictional County', roster: players,
  overallCompetition: { kind: 'stroke-play', basis: 'gross' },
  rounds: Array.from({ length: 8 }, (_, index) => ({
    id: id(70 + index), name: `Fictional round ${String(index + 1)}`, courseId: 'ghin:301:302', courseVersionId: 'a'.repeat(64),
    course: {
      provider: 'usga-ghin', sourceId: 302, name: 'Fictional Dunes', status: 'Active', number: null, city: 'Fictional City', state: 'Fictional State',
      facility: { id: 301, name: 'Fictional Club', status: 'Active', number: null, golfAssociationId: 303, address: 'Fictional address', longitude: 0, latitude: 0 },
      season: { name: 'All year', start: '01/01', end: '12/31', allYear: true },
    },
    teeProfile: {
      id: 901, name: 'Fictional Gold', category: 'Fictional rating', holeCount: 18, totalYardage: 6300, totalMeters: 5760, totalPar: 72,
      strokeAllocation: true, shorter: false, eligibleSides: 'All', holes: fictionalGamesRound.layout,
      ratings: [{ type: 'Total', course: 72, slope: 113, bogey: 90 },
        { type: 'Front', course: 36, slope: 113, bogey: 45 }, { type: 'Back', course: 36, slope: 113, bogey: 45 }],
    },
    groups: fictionalGamesRound.groups, players, scoringStarted: true,
  })),
};
const roundScores: readonly RoundScores[] = overallWorkspace.rounds.map((round, roundIndex) => ({
  eventId: overallWorkspace.event.id, eventName: overallWorkspace.event.name, eventStatus: 'active',
  roundId: round.id, roundName: round.name, courseName: round.course.name,
  teeName: round.teeProfile.name, teeCategory: round.teeProfile.category, layout: round.teeProfile.holes,
  groups: round.groups, setupLocked: roundIndex === 0, lastUpdatedAt: roundIndex === 0 ? '2026-01-01T00:00:00Z' : null,
  cards: players.map((player, playerIndex) => ({
    ...player, etag: roundIndex === 0 && playerIndex !== 2 ? 'card-v1' : null,
    updatedAt: roundIndex === 0 && playerIndex !== 2 ? '2026-01-01T00:00:00Z' : null,
    holes: round.teeProfile.holes.map((hole) => ({
      number: hole.number,
      score: roundIndex === 0 && playerIndex < 2 && hole.number <= 4 ? { kind: 'strokes', strokes: hole.number === 1 ? 3 : 4 }
        : roundIndex === 0 && playerIndex === 3 && hole.number === 1 ? { kind: 'picked-up', reportedStrokes: 7 }
          : { kind: 'unplayed' },
    })),
  })),
}));
export const overallView: EventLeaderboardView = {
  workspace: overallWorkspace, roundScores,
  standings: {
    status: 'unavailable', staleRoundIds: [],
    rounds: overallWorkspace.rounds.map((round) => ({ roundId: round.id, roundName: round.name, totalHoles: 18, gameId: null })),
    players: players.map((player, index) => ({
      ...player, status: index === 2 ? 'awaiting-scores' : index === 3 ? 'unavailable' : 'in-progress',
      ...(index === 3 ? { reason: 'invalid-stroke-score' as const } : {}),
      holesScored: index < 2 ? 4 : 0, totalHoles: 144,
      subtotal: index < 2 ? 15 : null, relativeToPar: index < 2 ? -1 : null,
      rank: index < 2 ? 1 : null, rankLabel: index < 2 ? 'T1' : null,
      cells: overallWorkspace.rounds.map((round, roundIndex) => ({
        roundId: round.id, status: roundIndex === 0 && index === 3 ? 'unavailable'
          : roundIndex === 0 && index < 2 ? 'in-progress' : 'awaiting-scores',
        ...(roundIndex === 0 && index === 3 ? { reason: 'invalid-stroke-score' as const } : {}),
        holesScored: roundIndex === 0 && index < 2 ? 4 : 0, totalHoles: 18,
        subtotal: roundIndex === 0 && index < 2 ? 15 : null, relativeToPar: roundIndex === 0 && index < 2 ? -1 : null,
      })),
    })),
  },
};
