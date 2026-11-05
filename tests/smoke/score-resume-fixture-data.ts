import type { RoundScores } from '../../src/domain/scoring';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const layout = Array.from({ length: 18 }, (_, index) => ({
  number: index + 1, sourceId: 300 + index, length: 350, par: 4, allocation: index + 1,
}));
export const fictionalResumeRound: RoundScores = {
  eventId: id(50), eventName: 'Fictional return visits', eventStatus: 'active',
  roundId: id(70), roundName: 'Fictional round', courseName: 'Fictional course',
  teeName: 'Fictional tee', teeCategory: 'Fictional category', layout,
  permissions: { role: 'public', writePlayerIds: [1, 2, 3, 4].map(id), canManageGames: false },
  groups: [{ number: 1, playerIds: [1, 2].map(id) }, { number: 2, playerIds: [3, 4].map(id) }],
  cards: [1, 2, 3, 4].map((number) => ({
    playerId: id(number), displayName: `Fictional golfer ${String(number)}`, etag: null, updatedAt: null,
    holes: layout.map((hole) => ({ number: hole.number, score: { kind: 'unplayed' } })),
  })),
  setupLocked: false, lastUpdatedAt: null,
};
