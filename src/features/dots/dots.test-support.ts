import { strokeGameFixture, strokeGameId, strokeGamesRound } from '../../domain/stroke-games.test-support';
import type { DotsGameDefinition } from '../../domain/dots';
import type { RoundScores } from '../../domain/scoring';

export function dotsFixture() {
  const f = strokeGameFixture(9);
  const ids = f.cards.map((card) => card.playerId);
  const game: DotsGameDefinition = { id: strokeGameId(980), name: 'Fictional specials', kind: 'dots', version: 1,
    groupNumber: 1, playerIds: ids, mode: 'individual', stakeMinor: 100,
    specials: [{ kind: 'sandy', units: 1 }, { kind: 'paree', units: 1 }, { kind: 'birdie', units: 2 },
      { kind: 'dime', units: 1 }, { kind: 'super-dime', units: 1 }, { kind: 'kp', units: 1 }] };
  const base = strokeGamesRound(f);
  const round: RoundScores = { ...base, setupLocked: false, supportedGameKinds: ['dots', 'wolf', 'churchy', 'skins'],
    wolfRulesVersions: [1, 2], internalGamesSupported: true,
    games: { configuration: { eventId: base.eventId, roundId: base.roundId, etag: 'fictional-game-revision', games: [game] }, results: [] } };
  return { f, ids, game, round };
}
