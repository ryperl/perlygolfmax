import { describe, expect, it } from 'vitest';
import { calculateRoundDifferentials } from '../domain/round-differential';
import { strokeGameFixture, strokeGamesRound } from '../domain/stroke-games.test-support';
import type { Scorecard } from '../domain/scoring';
import { isRoundScores } from './scoring';

describe('saved round differential projections', () => {
  const fixture = strokeGameFixture(18);
  const base = strokeGamesRound(fixture);
  const values = calculateRoundDifferentials(fixture.snapshot, fixture.cards);
  const round = { ...base, roundDifferentials: values };
  function project(cards: readonly Scorecard[]) {
    return { ...strokeGamesRound({ ...fixture, cards }),
      roundDifferentials: calculateRoundDifferentials(fixture.snapshot, cards) };
  }

  it('accepts bound estimates and older responses without the new projection', () => {
    expect(isRoundScores(base)).toBe(true);
    expect(isRoundScores(round)).toBe(true);
    const cards = round.cards.map((card, index) => index ? card : { ...card,
      holes: card.holes.map((hole) => hole.number === 18 ? { ...hole, score: { kind: 'unplayed' as const } } : hole) });
    expect(isRoundScores(project(cards))).toBe(true);
  });

  it('rejects missing/duplicate/unknown rows and private or unsupported estimate fields', () => {
    for (const roundDifferentials of [
      values.slice(1), [...values, values[0]],
      values.map((value, index) => index ? value : { ...value, playerId: '00000000-0000-4000-8000-999999999999' }),
      values.map((value, index) => index ? value : { ...value, observationId: 'not-public' }),
      values.map((value, index) => index ? value : { ...value, pcc: 1 }),
    ]) expect(isRoundScores({ ...round, roundDifferentials })).toBe(false);
    const nine = strokeGameFixture(9);
    expect(isRoundScores({ ...strokeGamesRound(nine),
      roundDifferentials: calculateRoundDifferentials(nine.snapshot, nine.cards) })).toBe(false);
  });

  it('rejects completed estimates on incomplete/pickup cards and adjusted totals greater than raw strokes', () => {
    for (const score of [{ kind: 'unplayed' }, { kind: 'picked-up', reportedStrokes: 7 }, { kind: 'did-not-finish' }] as const) {
      const cards = round.cards.map((card, index) => index ? card : { ...card,
        holes: card.holes.map((hole) => hole.number === 18 ? { ...hole, score } : hole) });
      expect(isRoundScores({ ...project(cards), roundDifferentials: values })).toBe(false);
      expect(isRoundScores(project(cards))).toBe(true);
    }
    expect(isRoundScores({ ...round, roundDifferentials: values.map((value, index) =>
      index || value.status !== 'available' ? value : { ...value, adjustedGross: 73 }) })).toBe(false);
    expect(isRoundScores({ ...round, roundDifferentials: values.map((value, index) =>
      index ? value : { playerId: value.playerId, method: 'estimated-18-hole', pcc: 0,
        status: 'pending', differentialTenths: null, adjustedGross: null, reason: 'incomplete-card' }) })).toBe(false);
  });
});
