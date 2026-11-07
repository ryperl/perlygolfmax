import type { BallDropFormat, BallDropGameDefinition, SkinsGameDefinition } from './games.js';
import type { HoleScore, RoundScores, Scorecard } from './scoring.js';
import type { RoundSnapshot } from './setup.js';
import { calculateGameResults } from './stableford.js';
import { publishedCourseHandicaps } from './playing-handicaps.js';
import { purseTestContext } from './purse.test-support.js';

export const strokeGameId = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

export function strokeGameFixture(count: 9 | 18 = 9, playerCount = 4) {
  const layout = Array.from({ length: count }, (_, index) => ({
    number: index + 1, sourceId: index + 100, par: 4, length: 350, allocation: index + 1,
  }));
  const tee = {
    ...purseTestContext().workspace.rounds[0]?.teeProfile,
    id: 300, name: 'Fictional Blue', category: 'Fictional rating', holeCount: count,
    totalPar: count * 4, totalYardage: count * 350, totalMeters: count * 320, holes: layout, strokeAllocation: true,
    shorter: null, eligibleSides: null,
    ratings: (['Total', 'Front', 'Back'] as const).map((type) => ({ type, course: type === 'Total' ? count * 4 : 36, slope: 113, bogey: 50 })),
  };
  const players = Array.from({ length: playerCount }, (_, index) => ({
    playerId: strokeGameId(index + 1), displayName: `Fictional golfer ${String(index + 1)}`,
    handicapIndex: { id: strokeGameId(400 + index), value: '0', effectiveDate: '2026-01-01',
      source: 'Fictional manual capture', recordedAt: '2026-01-01T00:00:00Z',
      recordedBy: { tenantId: strokeGameId(501), objectId: strokeGameId(502) }, previousObservationId: null },
  }));
  const base = purseTestContext().workspace.rounds[0];
  if (!base) throw new Error('Missing fictional snapshot');
  const snapshot = {
    ...base,
    id: strokeGameId(200), name: 'Fictional Round',
    teeProfile: tee, players,
    groups: Array.from({ length: Math.ceil(players.length / 4) }, (_, index) => ({
      number: index + 1, playerIds: players.slice(index * 4, (index + 1) * 4).map((player) => player.playerId),
    })),
  } satisfies RoundSnapshot;
  const cards: readonly Scorecard[] = players.map((player) => ({
    playerId: player.playerId, displayName: player.displayName, etag: 'fictional-card-v1', updatedAt: '2026-01-01T00:00:00Z',
    holes: layout.map((hole) => ({ number: hole.number, score: { kind: 'strokes', strokes: 4 } })),
  }));
  const ballDrop: BallDropGameDefinition = {
    id: strokeGameId(700), name: 'Fictional Ball Drop', kind: 'ball-drop', version: 1, basis: 'net', format: 'ball-drop-net-gross',
    teams: Array.from({ length: Math.floor(playerCount / 4) }, (_, index) => ({
      id: strokeGameId(800 + index), name: `Fictional team ${String(index + 1)}`,
      playerIds: players.slice(index * 4, (index + 1) * 4).map((player) => player.playerId),
    })),
  };
  const skins: SkinsGameDefinition = {
    id: strokeGameId(701), name: 'Fictional Skins', kind: 'skins', version: 1, basis: 'gross', carryovers: true,
  };
  return { snapshot, cards, ballDrop, skins };
}

export function ballDropFormat(game: BallDropGameDefinition, format: BallDropFormat): BallDropGameDefinition {
  return { ...game, format, basis: format === 'ball-drop-two-gross' ? 'gross' : 'net' };
}

export function strokeGameCards(
  cards: readonly Scorecard[], hole: number, scores: readonly HoleScore[],
): readonly Scorecard[] {
  return cards.map((card, index) => ({ ...card, holes: card.holes.map((entry) =>
    entry.number === hole ? { ...entry, score: scores[index] ?? entry.score } : entry) }));
}

export function strokeGamesRound(fixture: {
  readonly snapshot: RoundSnapshot;
  readonly cards: readonly Scorecard[];
  readonly ballDrop: BallDropGameDefinition;
  readonly skins: SkinsGameDefinition;
} = strokeGameFixture()): RoundScores {
  const { snapshot, cards, ballDrop, skins } = fixture;
  const games = [ballDrop, skins];
  return {
    eventId: strokeGameId(900), eventName: 'Fictional Games Event', eventStatus: 'active',
    roundId: snapshot.id, roundName: snapshot.name, courseName: snapshot.course.name,
    teeName: snapshot.teeProfile.name, teeCategory: snapshot.teeProfile.category, teeRatings: snapshot.teeProfile.ratings,
    layout: snapshot.teeProfile.holes, groups: snapshot.groups, cards, setupLocked: true, lastUpdatedAt: '2026-01-01T00:00:00Z',
    permissions: { role: 'owner', writePlayerIds: cards.map((card) => card.playerId), canManageGames: true },
    courseHandicaps: publishedCourseHandicaps(snapshot), ...(snapshot.playerTees ? { playerTees: snapshot.playerTees } : {}),
    games: { configuration: { eventId: strokeGameId(900), roundId: snapshot.id, etag: 'fictional-games-v1', games },
      results: calculateGameResults(games, snapshot, cards) },
  };
}
