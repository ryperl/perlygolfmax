import type { NassauGameDefinition } from './nassau.js';
import type { WolfGameDefinition } from './wolf.js';
import type { RoundGameDefinition } from './games.js';
import { roundGameKinds } from './games.js';
import type { RoundScores, Scorecard } from './scoring.js';
import { calculateGameResults } from './stableford.js';
import { strokeGameFixture, strokeGameId, strokeGamesRound } from './stroke-games.test-support.js';

export function matchGamesFixture(playerCount = 4) {
  const f = strokeGameFixture(18, playerCount);
  const ids = f.snapshot.players.map((player) => player.playerId);
  const wolf: WolfGameDefinition = { id: strokeGameId(950), name: 'Fictional Wolf', kind: 'wolf', version: 1,
    basis: 'gross', groupNumber: 1, playerIds: ids.slice(0, 4), allowPig: true };
  const nassau: NassauGameDefinition = { id: strokeGameId(951), name: 'Fictional Nassau', kind: 'nassau', version: 1,
    basis: 'gross', groupNumber: 1, variant: 'singles',
    sides: ids.slice(0, 2).map((id, index) => ({ id: strokeGameId(960 + index), name: `Fictional side ${String(index + 1)}`, playerIds: [id] })),
    stakes: { currency: 'USD', frontMinor: 100, backMinor: 100, overallMinor: 200 }, automaticPresses: true };
  function round(cards: readonly Scorecard[] = f.cards, games: readonly RoundGameDefinition[] = [wolf, nassau]): RoundScores {
    const base = strokeGamesRound({ ...f, cards });
    const persisted = cards.some((card) => card.etag !== null);
    return { ...base, churchyEnabled: true, supportedGameKinds: roundGameKinds, teeStrokeAllocation: f.snapshot.teeProfile.strokeAllocation,
      gameInputContext: { courseVersionId: f.snapshot.courseVersionId, teeProfileId: f.snapshot.teeProfile.id },
      setupLocked: persisted, lastUpdatedAt: persisted ? base.lastUpdatedAt : null,
      games: { configuration: { eventId: base.eventId, roundId: base.roundId, games, etag: 'fictional-game-revision' },
        results: calculateGameResults(games, f.snapshot, cards) } };
  }
  return { ...f, ids, wolf, nassau, round };
}
