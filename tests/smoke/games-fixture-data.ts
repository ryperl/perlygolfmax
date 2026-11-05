import type { RoundGameDefinition, TeamGameDefinition, TeamGameFormat } from '../../src/domain/games';
import type { RoundScores } from '../../src/domain/scoring';
import type { RoundSnapshot } from '../../src/domain/setup';
import { calculateGameResults, stablefordPoints } from '../../src/domain/stableford';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const layout = Array.from({ length: 18 }, (_, index) => ({ number: index + 1, sourceId: 300 + index, length: 350, par: 4, allocation: index + 1 }));
const indices = ['18.9', '0', '+2.1'];
const snapshot: RoundSnapshot = {
  id: id(70), name: 'Fictional games round', courseId: 'ghin:301:302', courseVersionId: 'a'.repeat(64),
  course: {
    provider: 'usga-ghin', sourceId: 302, name: 'Fictional Dunes', status: 'Active', number: null, city: 'Fictional City', state: 'Fictional State',
    facility: { id: 301, name: 'Fictional Club', status: 'Active', number: null, golfAssociationId: 303, address: 'Fictional address', longitude: 0, latitude: 0 },
    season: { name: 'All year', start: '01/01', end: '12/31', allYear: true },
  },
  teeProfile: {
    id: 901, name: 'Fictional Gold', category: 'Fictional category', holeCount: 18, totalYardage: 6300, totalMeters: 5760,
    totalPar: 72, strokeAllocation: true, shorter: false, eligibleSides: 'All', holes: layout,
    ratings: [{ type: 'Total', course: 72, slope: 113, bogey: 90 }, { type: 'Front', course: 36, slope: 113, bogey: 45 }, { type: 'Back', course: 36, slope: 113, bogey: 45 }],
  },
  players: Array.from({ length: 4 }, (_, index) => {
    const value = indices[index];
    return { playerId: id(index + 1), displayName: `Fictional golfer ${String(index + 1)}`,
      handicapIndex: value === undefined ? null : {
        id: id(500 + index), value, effectiveDate: '2026-01-01', source: 'Fictional capture',
        recordedAt: '2026-01-01T00:00:00Z', recordedBy: { tenantId: id(200), objectId: id(201) }, previousObservationId: null,
      } };
  }),
  groups: [{ number: 1, playerIds: [1, 2, 3, 4].map(id) }], scoringStarted: true,
};
export { snapshot as fictionalCapturedRound };
const definitions: readonly RoundGameDefinition[] = [
  { id: id(700), name: 'Fictional standard net', preset: 'standard', basis: 'net', handicapAllowancePercent: 95, points: stablefordPoints('standard') },
  { id: id(701), name: 'Fictional modified gross', preset: 'modified', basis: 'gross', handicapAllowancePercent: 95, points: stablefordPoints('modified') },
];
const cards: RoundScores['cards'] = snapshot.players.map((player) => ({
  playerId: player.playerId, displayName: player.displayName, etag: 'card-v1', updatedAt: '2026-01-01T00:00:00Z',
  holes: layout.map((hole) => ({ number: hole.number, score: { kind: 'strokes', strokes: 4 } })),
}));
export const fictionalGamesRound: RoundScores = {
  permissions: { role: 'owner', writePlayerIds: cards.map((card) => card.playerId), canManageGames: true },
  eventId: id(50), eventName: 'Fictional event', eventStatus: 'active', roundId: snapshot.id, roundName: snapshot.name,
  courseName: snapshot.course.name, teeName: snapshot.teeProfile.name, teeCategory: snapshot.teeProfile.category, layout, cards,
  groups: snapshot.groups, setupLocked: true, lastUpdatedAt: '2026-01-01T00:00:00Z',
  games: { configuration: { eventId: id(50), roundId: snapshot.id, etag: 'games-v1', games: definitions }, results: calculateGameResults(definitions, snapshot, cards) },
};

const teamDefinitions: readonly TeamGameDefinition[] = (
  [
    ['two-net-better-ball', 'standard', 'Fictional 2-man Better Ball'],
    ['two-net-aggregate', 'standard', 'Fictional 2-man Aggregate'],
    ['four-two-net', 'standard', 'Fictional 4-man Standard'],
    ['four-two-net', 'modified', 'Fictional 4-man Modified'],
  ] satisfies readonly (readonly [TeamGameFormat, 'standard' | 'modified', string])[]
).map(([format, preset, name], index) => {
  const size = format === 'four-two-net' ? 4 : 2;
  return {
    id: id(710 + index), name, format, preset, basis: 'net', handicapAllowancePercent: 100,
    points: stablefordPoints(preset),
    teams: Array.from({ length: 4 / size }, (_, teamIndex) => ({
      id: id(950 + index * 10 + teamIndex), name: `Fictional team ${String(teamIndex + 1)}`,
      playerIds: snapshot.players.slice(teamIndex * size, teamIndex * size + size).map((player) => player.playerId),
    })),
  };
});
const teamSnapshot: RoundSnapshot = {
  ...snapshot,
  players: snapshot.players.map((player, index) => ({
    ...player, handicapIndex: {
      id: id(600 + index), value: '0', effectiveDate: '2026-01-01', source: 'Fictional capture',
      recordedAt: '2026-01-01T00:00:00Z', recordedBy: { tenantId: id(200), objectId: id(201) }, previousObservationId: null,
    },
  })),
};
const teamCards: RoundScores['cards'] = cards.map((card, index) => ({
  ...card, holes: layout.map((hole) => ({
    number: hole.number, score: hole.number === 18 ? { kind: 'unplayed' } : { kind: 'strokes', strokes: index < 2 ? 3 : 5 },
  })),
}));
export const fictionalTeamGamesRound: RoundScores = {
  ...fictionalGamesRound, cards: teamCards,
  games: {
    configuration: { eventId: fictionalGamesRound.eventId, roundId: snapshot.id, etag: 'team-games-v1', games: teamDefinitions },
    results: calculateGameResults(teamDefinitions, teamSnapshot, teamCards),
  },
};
