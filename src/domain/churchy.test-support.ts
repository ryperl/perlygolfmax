import type { ChurchyGameDefinition, ChurchySpecials } from './churchy.js';
import type { RoundScores, Scorecard } from './scoring.js';
import { strokeGameFixture, strokeGameId, strokeGamesRound } from './stroke-games.test-support.js';
import { calculateGameResults } from './stableford.js';

export function churchyFixture(count: 9 | 18 = 18) {
  const base = strokeGameFixture(count, 8);
  const game: ChurchyGameDefinition = { id: strokeGameId(702), name: 'Churchy Game', kind: 'churchy',
    version: 1, basis: 'net', groupNumber: 1, playerIds: base.cards.slice(0, 4).map((card) => card.playerId),
    amountPerDotMinor: 100, currency: 'USD' };
  const extras: ChurchySpecials = { gameId: game.id, gameEtag: 'fictional-games-v1', paree: false,
    murphy: false, murphyPresses: 0, sandy: false, pully: false };
  function round(cards: readonly Scorecard[] = base.cards, enabled: boolean | undefined = true): RoundScores {
    const original = strokeGamesRound(base);
    const games = [game, base.skins];
    return { ...original, churchyEnabled: enabled, teeStrokeAllocation: true, cards,
      games: { configuration: { ...original.games?.configuration, eventId: original.eventId, roundId: original.roundId,
        etag: extras.gameEtag, games }, results: calculateGameResults(games, base.snapshot, cards) } };
  }
  return { ...base, game, extras, round };
}
