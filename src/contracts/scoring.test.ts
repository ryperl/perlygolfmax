import { describe, expect, it } from 'vitest';
import type { RoundScores, Scorecard, ScoreChange } from '../domain/scoring';
import { maximumExactHoleStrokes } from '../domain/scoring';
import { isHoleScore, isRoundScores, isScorecard, isScoreChange, isScoreHistoryPage, isScoreWriteResult } from './scoring';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
function round(): RoundScores {
  const layout = Array.from({ length: 9 }, (_, index) => ({
    number: index + 1, sourceId: 301 + index, length: 350, par: 4, allocation: index + 1,
  }));
  const cards: Scorecard[] = [1, 2, 3, 4].map((number) => ({
    playerId: id(number), displayName: `Fictional golfer ${String(number)}`, etag: null, updatedAt: null,
    holes: layout.map((hole) => ({ number: hole.number, score: { kind: 'unplayed' } })),
  }));
  return {
    eventId: id(100), eventName: 'Fictional Open', eventStatus: 'active', roundId: id(200), roundName: 'Fictional Round',
    courseName: 'Fictional Course', teeName: 'Fictional Teal', teeCategory: 'Fictional rating',
    layout, groups: [{ number: 1, playerIds: cards.map((card) => card.playerId) }], cards, setupLocked: false, lastUpdatedAt: null,
  };
}
const change: ScoreChange = {
  id: id(300), eventId: id(100), roundId: id(200), playerId: id(1), holeNumber: 1,
  before: { kind: 'unplayed' }, after: { kind: 'strokes', strokes: 4 }, expectedEtag: null,
  recordedAt: '2026-01-01T00:00:00Z', recordedBy: { tenantId: id(500), objectId: id(501) },
};

describe('owner gross scoring network contracts', () => {
  it.each([{ kind: 'unplayed' }, { kind: 'picked-up' }, { kind: 'did-not-finish' }, { kind: 'strokes', strokes: 1 }])('accepts explicit disposition %j', (score) => {
    expect(isHoleScore(score)).toBe(true);
  });
  it.each([
    null, {}, { kind: 'complete' }, { kind: 'strokes', strokes: 0 }, { kind: 'strokes', strokes: -1 },
    { kind: 'strokes', strokes: 1.5 }, { kind: 'strokes', strokes: '4' },
    { kind: 'unplayed', strokes: 0 }, { kind: 'picked-up', strokes: 5 },
    { kind: 'strokes', strokes: maximumExactHoleStrokes + 1 }, { kind: 'strokes', strokes: Number.NaN },
  ])('rejects ambiguous/unsafe score %j', (score) => { expect(isHoleScore(score)).toBe(false); });

  it('accepts an unsaved virtual round but never calls numeric data an unversioned card', () => {
    const value = round();
    expect(isRoundScores(value)).toBe(true);
    expect(isRoundScores({ ...value, setupLocked: true })).toBe(false);
    expect(isRoundScores({ ...value, lastUpdatedAt: '2026-01-01T00:00:00Z' })).toBe(false);
    const first = value.cards[0];
    if (!first) throw new Error('Missing fictional card.');
    expect(isScorecard({ ...first, holes: first.holes.map((hole) => ({ ...hole, score: { kind: 'strokes', strokes: 4 } })) })).toBe(false);
    const persisted = { ...first, etag: 'card-v1', updatedAt: '2026-01-01T00:00:00Z' };
    expect(isScorecard(persisted)).toBe(true);
    expect(isScorecard({ ...persisted, etag: '*' })).toBe(false);
    expect(isScorecard({ ...persisted, updatedAt: null })).toBe(false);
    expect(isRoundScores({ ...value, cards: [persisted, ...value.cards.slice(1)] })).toBe(false);
    expect(isRoundScores({ ...value, setupLocked: true, lastUpdatedAt: persisted.updatedAt, cards: [persisted, ...value.cards.slice(1)] })).toBe(true);
  });

  it('requires complete source layout, unique cards and exactly one group assignment per golfer', () => {
    const empty = round();
    const value = {
      ...empty, setupLocked: true, lastUpdatedAt: '2026-01-01T00:00:00Z',
      cards: empty.cards.map((card, index) => index === 0 ? { ...card, etag: 'card-v2', updatedAt: '2026-01-01T00:00:00Z' } : card),
    };
    expect(isRoundScores({ ...value, cards: [...value.cards, value.cards[0]] })).toBe(false);
    expect(isRoundScores({ ...value, layout: [null, ...value.layout.slice(1)] })).toBe(false);
    expect(isRoundScores({ ...value, layout: value.layout.map((hole) => ({ ...hole, number: 1 })) })).toBe(false);
    expect(isRoundScores({ ...value, layout: value.layout.map((hole) => ({ ...hole, allocation: 1 })) })).toBe(false);
    expect(isRoundScores({ ...value, layout: value.layout.map((hole) => ({ ...hole, sourceId: 1 })) })).toBe(false);
    expect(isRoundScores({ ...value, groups: [{ number: 1, playerIds: [id(1), id(1), id(2), id(3)] }] })).toBe(false);
    expect(isRoundScores({ ...value, cards: value.cards.map((card) => ({ ...card, holes: card.holes.slice(1) })) })).toBe(false);
  });

  it('acknowledges exact audited operations independently of the current projected score', () => {
    const empty = round();
    const value = {
      ...empty, setupLocked: true, lastUpdatedAt: '2026-01-01T00:00:00Z',
      cards: empty.cards.map((card, index) => index === 0 ? { ...card, etag: 'card-v2', updatedAt: '2026-01-01T00:00:00Z' } : card),
    };
    expect(isScoreChange(change)).toBe(true);
    expect(isScoreWriteResult({ round: value, change })).toBe(true);
    expect(isScoreWriteResult({ round: value, change: { ...change, roundId: id(999) } })).toBe(false);
    expect(isScoreWriteResult({ round: value, change: { ...change, playerId: id(999) } })).toBe(false);
    expect(isScoreWriteResult({ round: value, change: { ...change, holeNumber: 18 } })).toBe(false);
    expect(isScoreChange({ ...change, after: { kind: 'strokes', strokes: 0 } })).toBe(false);
    expect(isScoreHistoryPage({ changes: [change] })).toBe(true);
    expect(isScoreHistoryPage({ changes: [change], continuationToken: 'x'.repeat(2049) })).toBe(false);
  });
});
