import type { RoundGameDefinition, TeamGameFormat } from './games.js';
import type { PursePlan, PurseRankedPool } from './purse.js';
import type { RoundScores } from './scoring.js';
import type { EventWorkspace, RoundSnapshot } from './setup.js';
import { calculateGameResults, stablefordPoints } from './stableford.js';

export const purseTestId = (value: number): string => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

/** Shared synthetic context for domain and contract suites; never used by production code. */
export function purseTestContext(
  count = 4, format?: TeamGameFormat, strokes: readonly number[] = [4, 5, 6, 7],
  preset: 'standard' | 'modified' = 'standard',
): { readonly workspace: EventWorkspace; readonly rounds: readonly RoundScores[]; readonly plan: PursePlan; readonly pool: PurseRankedPool } {
  const players = Array.from({ length: count }, (_, index) => ({
    playerId: purseTestId(index + 1), displayName: `Fictional golfer ${String(index + 1)}`,
    handicapIndex: { id: purseTestId(1000 + index), value: '0', effectiveDate: '2026-01-01', source: 'Fictional manual',
      recordedAt: '2026-01-01T00:00:00Z', recordedBy: { tenantId: purseTestId(9001), objectId: purseTestId(9002) },
      previousObservationId: null },
  }));
  const holes = Array.from({ length: 9 }, (_, index) => ({
    number: index + 1, sourceId: 300 + index, length: 350, par: 4, allocation: index + 1,
  }));
  const round: RoundSnapshot = {
    id: purseTestId(2000), name: 'Fictional round', courseId: 'ghin:801:802', courseVersionId: 'a'.repeat(64),
    course: {
      provider: 'usga-ghin', sourceId: 802, name: 'Fictional course', status: 'Active', number: null,
      city: 'Fictional city', state: 'Fictional state',
      facility: { id: 801, status: 'Active', name: 'Fictional facility', number: null, golfAssociationId: 803,
        address: 'Fictional address', longitude: 0, latitude: 0 },
      season: { name: 'All year', allYear: true, start: '01/01', end: '12/31' },
    },
    teeProfile: { id: 700, name: 'Fictional tee', category: 'Fictional category', holeCount: 9,
      totalYardage: 3150, totalMeters: 2880, totalPar: 36, strokeAllocation: true,
      shorter: null, eligibleSides: null,
      ratings: [{ type: 'Total', course: 36, slope: 113, bogey: 45 }], holes },
    groups: Array.from({ length: Math.ceil(count / 4) }, (_, index) => ({
      number: index + 1, playerIds: players.slice(index * 4, index * 4 + 4).map((player) => player.playerId),
    })), players,
  };
  const commonGame = {
    id: purseTestId(3000), name: 'Fictional game', preset,
    handicapAllowancePercent: format ? 100 : 95, points: stablefordPoints(preset),
  };
  const game: RoundGameDefinition = format
    ? { ...commonGame, basis: 'net', format, teams: Array.from({ length: count / (format === 'four-two-net' ? 4 : 2) }, (_, index) => {
      const size = format === 'four-two-net' ? 4 : 2;
      return { id: purseTestId(4000 + index), name: `Fictional team ${String(index + 1)}`,
        playerIds: players.slice(index * size, index * size + size).map((player) => player.playerId) };
    }) } : { ...commonGame, basis: 'gross' };
  const workspace: EventWorkspace = {
    event: { id: purseTestId(9000), name: 'Fictional Open', createdAt: '2026-01-01', role: 'owner', status: 'active', etag: 'current' },
    location: '', roster: players.map(({ playerId, displayName }) => ({ playerId, displayName })), rounds: [round],
    etag: 'current', overallCompetition: {
      kind: 'stableford', credit: 'individual', roundGames: [{ roundId: round.id, gameId: game.id }],
    },
  };
  const cards = players.map((player, index) => ({
    playerId: player.playerId, displayName: player.displayName, etag: 'fictional-card', updatedAt: '2026-01-01T00:00:00Z',
    holes: holes.map((hole) => ({ number: hole.number, score: { kind: 'strokes', strokes: strokes[index % strokes.length] ?? 4 } as const })),
  }));
  const rounds: readonly RoundScores[] = [{
    eventId: workspace.event.id, eventName: workspace.event.name, eventStatus: 'active', roundId: round.id, roundName: round.name,
    courseName: round.course.name, teeName: round.teeProfile.name, teeCategory: round.teeProfile.category, layout: holes,
    groups: round.groups, cards, setupLocked: true, lastUpdatedAt: '2026-01-01T00:00:00Z',
    games: { configuration: { eventId: workspace.event.id, roundId: round.id, etag: 'games-current', games: [game] },
      results: calculateGameResults([game], round, cards) },
  }];
  const pool: PurseRankedPool = {
    id: purseTestId(5000), name: 'Fictional awards', source: { kind: 'round-game', roundId: round.id, gameId: game.id },
    awardUnit: format ? 'per-team' : 'per-golfer', tiePolicy: 'pooled',
    prizes: [{ place: 1, amountMinor: 100 }, { place: 2, amountMinor: 50 }],
  };
  return { workspace, rounds, pool,
    plan: { eventId: workspace.event.id, currency: 'USD', funding: { kind: 'fixed', budgetMinor: 200 }, pools: [pool] } };
}
