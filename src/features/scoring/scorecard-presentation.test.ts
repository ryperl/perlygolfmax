import { describe, expect, it } from 'vitest';
import { fictionalRoundScores } from '../../client/scoring.test-support';
import { cardTotalText, summarizeCard } from './scorecard-presentation';

const card = fictionalRoundScores.cards[0];
if (!card) throw new Error('Missing fictional card.');
describe('scorecard displayed totals', () => {
  it('uses only the selected source holes and never fabricates zero for an untouched card', () => {
    expect(cardTotalText(card, fictionalRoundScores.layout)).toBe('—');
    const scored = { ...card, holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'strokes' as const, strokes: hole.number } })) };
    expect(cardTotalText(scored, fictionalRoundScores.layout.slice(0, 3))).toBe('6');
    expect(summarizeCard(scored, fictionalRoundScores.layout).complete).toBe(true);
  });
  it('includes X7 but keeps totals incomplete, and missing saved entries fail visibly', () => {
    const pickup = { ...card, holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'picked-up' as const, reportedStrokes: 7 } })) };
    expect(cardTotalText(pickup, fictionalRoundScores.layout)).toBe('63*');
    expect(summarizeCard(pickup, fictionalRoundScores.layout).completed).toBe(0);
    const missing = { ...card, holes: [{ number: 1, score: { kind: 'strokes' as const, strokes: 4 } }] };
    expect(summarizeCard(missing, fictionalRoundScores.layout)).toEqual({ total: 4, completed: 1, complete: false, missing: true });
    expect(cardTotalText(missing, fictionalRoundScores.layout)).toBe('4*');
  });
});
