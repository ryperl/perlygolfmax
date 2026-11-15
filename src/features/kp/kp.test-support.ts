import { fictionalRoundScores } from '../../client/scoring.test-support';
import type { RoundScores } from '../../domain/scoring';
import { kpContext } from '../../domain/kp';

export function fictionalKpRound(): RoundScores {
  const layout = fictionalRoundScores.layout.map((hole) => ({
    ...hole, par: hole.number <= 4 ? 3 : hole.par,
    length: [183, 178, 175, 200][hole.number - 1] ?? hole.length,
  }));
  return { ...fictionalRoundScores, layout, kpEnabled: true,
    kp: { version: 1, context: kpContext(layout, fictionalRoundScores.cards.map((card) => card.playerId)), status: 'open', decisions: [], etag: 'kp-current' },
    kpPot: { amountMinor: 10000, currency: 'USD' } };
}
