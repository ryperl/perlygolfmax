import type { RoundGameDefinition } from '../../domain/games';
import type { RoundScores, Scorecard } from '../../domain/scoring';
import { calculateGameResults, stablefordPoints } from '../../domain/stableford';
import { fictionalId, fictionalWorkspace } from '../../client/catalog.test-support';
import { fictionalRoundScores } from '../../client/scoring.test-support';

export function scorecardGamesFixture(count: 9 | 18 = 18) {
  const first = fictionalWorkspace.rounds[0];
  if (!first) throw new Error('Missing fictional round.');
  const layout = Array.from({ length: count }, (_, index) => ({
    number: index + 1, sourceId: 300 + index, length: 350, par: 4, allocation: index + 1,
  }));
  const indices = ['18.9', '0', null, '12'];
  const snapshot = {
    ...first,
    teeProfile: { ...first.teeProfile, holeCount: count, holes: layout, totalPar: count * 4,
      ratings: first.teeProfile.ratings.map((rating) => ({ ...rating, course: rating.type === 'Total' ? count * 4 : count * 2, slope: 113 })),
    },
    players: first.players.map((player, index) => {
      const value = indices[index];
      return { ...player, handicapIndex: typeof value !== 'string' ? null : {
        id: fictionalId(500 + index), value, effectiveDate: '2026-01-01', source: 'Fictional captured index',
        recordedAt: '2026-01-01T00:00:00Z', recordedBy: { tenantId: fictionalId(600), objectId: fictionalId(601) }, previousObservationId: null,
      } };
    }),
  };
  const games: readonly RoundGameDefinition[] = [
    { id: fictionalId(700), name: 'Fictional standard', preset: 'standard', basis: 'gross', handicapAllowancePercent: 95, points: stablefordPoints('standard') },
    { id: fictionalId(701), name: 'Fictional modified', preset: 'modified', basis: 'gross', handicapAllowancePercent: 95, points: stablefordPoints('modified') },
    { id: fictionalId(702), name: 'Fictional net', preset: 'standard', basis: 'net', handicapAllowancePercent: 95, points: stablefordPoints('standard') },
  ];
  const cards: readonly Scorecard[] = snapshot.players.map((player, index) => ({
    playerId: player.playerId, displayName: player.displayName,
    etag: index === 3 ? null : `card-${String(index)}`, updatedAt: index === 3 ? null : '2026-01-01T00:00:00Z',
    holes: layout.map((hole) => ({ number: hole.number, score: index === 3 ? { kind: 'unplayed' }
      : index === 2 && hole.number === 1 ? { kind: 'picked-up', reportedStrokes: 7 }
        : { kind: 'strokes', strokes: index === 1 ? 5 : 4 } })),
  }));
  const round: RoundScores = {
    ...fictionalRoundScores, layout, cards, setupLocked: true, lastUpdatedAt: '2026-01-01T00:00:00Z',
    games: { configuration: { eventId: fictionalRoundScores.eventId, roundId: snapshot.id, etag: 'games-v1', games },
      results: calculateGameResults(games, snapshot, cards) },
  };
  return { round, games };
}
