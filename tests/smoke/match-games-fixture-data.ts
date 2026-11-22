import type { NassauGameDefinition } from '../../src/domain/nassau';
import type { WolfGameDefinition } from '../../src/domain/wolf';
import type { RoundGameDefinition } from '../../src/domain/games';
import type { RoundScores } from '../../src/domain/scoring';
import type { EventWorkspace } from '../../src/domain/setup';
import { calculateGameResults } from '../../src/domain/stableford';
import { calculateInternalSettlements } from '../../src/domain/internal-games';
import { strokeGameFixture, strokeGameId, strokeGamesRound } from '../../src/domain/stroke-games.test-support';
import { roundTee } from '../../src/domain/round-tee';

export const matchFixture = strokeGameFixture(18);
export const wolf: WolfGameDefinition = {
  id: strokeGameId(950), name: 'Fictional Wolf', kind: 'wolf', version: 1, basis: 'gross',
  groupNumber: 1, playerIds: [...matchFixture.cards.map((card) => card.playerId)].reverse(), allowPig: true,
};
export const nassau: NassauGameDefinition = {
  id: strokeGameId(951), name: 'Fictional Nassau', kind: 'nassau', version: 1, basis: 'gross',
  groupNumber: 1, variant: 'two-v-two-best-ball', automaticPresses: false,
  sides: [{ id: strokeGameId(952), name: 'Fictional Red', playerIds: wolf.playerIds.slice(0, 2) },
    { id: strokeGameId(953), name: 'Fictional Blue', playerIds: wolf.playerIds.slice(2) }],
  stakes: { currency: 'USD', frontMinor: 101, backMinor: 0, overallMinor: 0 },
};

export function withMatchResults(round: RoundScores, games: readonly RoundGameDefinition[] = round.games?.configuration.games ?? []): RoundScores {
  const tee = roundTee(matchFixture.snapshot.teeProfile, round.layout.length === 9 ? 'back' : 'full');
  if (!tee) throw new Error('Missing fictional match tee.');
  const results = calculateGameResults(games, { ...matchFixture.snapshot, teeProfile: tee, groups: round.groups }, round.cards);
  return { ...round, games: {
    configuration: { eventId: round.eventId, roundId: round.roundId, etag: games.length === 0 ? null : round.games?.configuration.etag ?? 'fictional-games-v1', games },
    results,
  }, internalSettlements: calculateInternalSettlements(games, results, round) };
}

export function matchRound(late = false, count: 9 | 18 = 18): RoundScores {
  const initial = strokeGamesRound(matchFixture);
  const tee = roundTee(matchFixture.snapshot.teeProfile, count === 9 ? 'back' : 'full');
  if (!tee) throw new Error('Missing fictional match layout.');
  const cards = initial.cards.map((card, index) => ({ ...card, etag: late ? 'fictional-card-v1' : null,
    updatedAt: late ? '2026-01-01T00:00:00Z' : null,
    holes: card.holes.filter((hole) => tee.holes.some((entry) => entry.number === hole.number)).map((hole) => ({ ...hole, score: late && hole.number === 1
      ? { kind: 'strokes' as const, strokes: 4, ...(index === 0 ? { wolf: [{
        number: 1, choice: { gameId: wolf.id, gameEtag: 'fictional-games-v1', mode: 'pig' as const }, recordedLate: true as const,
      }] } : {}) } : { kind: 'unplayed' as const } })),
  }));
  const round: RoundScores = { ...initial, quickRound: true, setupLocked: late, cards, layout: tee.holes, teeRatings: tee.ratings,
    groups: initial.groups.map((group) => ({ ...group, ...(count === 9 ? { startingHole: 17 } : {}) })),
    lastUpdatedAt: late ? '2026-01-01T00:00:00Z' : null,
    supportedGameKinds: ['stableford', 'ball-drop', 'skins', 'stroke-play', 'wolf', 'nassau', 'match-play'],
    wolfRulesVersions: [1, 2],
    wolfOrderVersion: 1,
    teeStrokeAllocation: true,
    gameInputContext: { courseVersionId: matchFixture.snapshot.courseVersionId, teeProfileId: matchFixture.snapshot.teeProfile.id },
    permissions: { role: 'public', writePlayerIds: cards.map((card) => card.playerId), canManageGames: true },
  };
  return withMatchResults(round, late ? [wolf, nassau] : []);
}

export function matchWorkspace(round: RoundScores): EventWorkspace {
  const teeProfile = roundTee(matchFixture.snapshot.teeProfile, round.layout.length === 9 ? 'back' : 'full');
  if (!teeProfile) throw new Error('Missing fictional captured match layout.');
  return {
    event: { id: round.eventId, name: round.eventName, role: 'viewer', status: 'active', quickRound: true,
      etag: 'fictional-event-v1', createdAt: '2026-01-01T00:00:00Z' },
    etag: 'fictional-event-v1', location: 'Fictional location', publicAccess: true, canViewScores: true, quickRound: true,
    roster: round.cards.map(({ playerId, displayName }) => ({ playerId, displayName, handicapIndexValue: '0' })),
    rounds: [{ ...matchFixture.snapshot, teeProfile, groups: round.groups, scoringStarted: round.setupLocked,
      players: round.cards.map(({ playerId, displayName }) => ({ playerId, displayName, handicapIndexValue: '0' })) }],
  };
}
