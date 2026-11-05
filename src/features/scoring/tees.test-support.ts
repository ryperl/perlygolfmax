import { fictionalProfile } from '../../client/catalog.test-support';
import { fictionalRoundScores } from '../../client/scoring.test-support';
import type { RoundScores } from '../../domain/scoring';

export function mixedTeeRound(): RoundScores {
  const first = fictionalRoundScores.cards[0];
  if (!first) throw new Error('Missing fictional golfer.');
  return {
    ...fictionalRoundScores,
    playerTees: [{
      playerId: first.playerId,
      profile: {
        ...fictionalProfile, id: 990, name: 'Fictional Gold', category: 'Fictional personal category',
        holes: fictionalRoundScores.layout.map((hole) => ({ ...hole, par: 5, length: 210, allocation: 10 - hole.number })),
        ratings: [{ type: 'Total', course: 41, slope: 130, bogey: 50 }], totalPar: 45, totalYardage: 1890,
      },
    }],
    cards: fictionalRoundScores.cards.map((card) => ({
      ...card, holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'strokes', strokes: 4 } })),
    })),
  };
}
