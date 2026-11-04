import { describe, expect, it } from 'vitest';
import { fictionalId, fictionalWorkspace } from '../../client/catalog.test-support';
import { fictionalRoundScores, scoreResult } from '../../client/scoring.test-support';
import type { RoundScores } from '../../domain/scoring';
import { summarizeEntryProgress } from './entry-progress';

const firstRound = fictionalWorkspace.rounds[0];
if (!firstRound) throw new Error('Missing fictional round.');
const round = firstRound;
function summarize(scores: RoundScores) {
  return summarizeEntryProgress(fictionalWorkspace.event.id, round, scores);
}
const entered = scoreResult().round;
const complete: RoundScores = {
  ...entered,
  cards: entered.cards.map((card) => ({
    ...card, etag: 'card-v2', updatedAt: entered.lastUpdatedAt,
    holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'did-not-finish' } })),
  })),
};

describe('saved entry progress', () => {
  it('distinguishes no scores, partial entries and clearing without relying on the permanent setup lock', () => {
    expect(summarize(fictionalRoundScores)).toMatchObject({ kind: 'ready', summary: { status: 'No scores yet', entered: 0, total: 36 } });
    expect(summarize(entered)).toMatchObject({ kind: 'ready', summary: { status: 'In progress', entered: 1, completeHoles: 0 } });
    expect(summarize({ ...entered, cards: entered.cards.map((card) => ({
      ...card, holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'unplayed' } })),
    })) })).toMatchObject({ kind: 'ready', summary: { status: 'No scores yet', entered: 0 } });
  });

  it('counts strokes, pickups with and without reported strokes, and DNF as entries', () => {
    const mixed: RoundScores = { ...complete, cards: complete.cards.map((card) => ({
      ...card, holes: card.holes.map((hole) => ({
        ...hole, score: hole.number === 1 ? { kind: 'picked-up' }
          : hole.number === 2 ? { kind: 'picked-up', reportedStrokes: 7 }
            : hole.number === 3 ? { kind: 'strokes', strokes: 4 } : hole.score,
      })),
    })) };
    expect(summarize(mixed)).toMatchObject({ kind: 'ready', summary: { status: 'Entries complete', entered: 36, completeHoles: 9 } });
  });

  it('requires every group golfer on a hole and keeps partial groups separate from the round', () => {
    const groups = [
      { number: 1, playerIds: round.players.slice(0, 2).map((player) => player.playerId) },
      { number: 2, playerIds: round.players.slice(2).map((player) => player.playerId) },
    ];
    const scores = { ...complete, groups, cards: complete.cards.map((card, index) => index < 2 ? card : fictionalRoundScores.cards[index] ?? card) };
    expect(summarizeEntryProgress(fictionalWorkspace.event.id, { ...round, groups }, scores))
      .toMatchObject({ kind: 'ready', summary: { status: 'In progress', completeHoles: 0, groups: [
        { number: 1, status: 'Entries complete', completeHoles: 9 },
        { number: 2, status: 'No scores yet', completeHoles: 0 },
      ] } });
  });

  it.each([
    { ...complete, eventId: fictionalId(99) },
    { ...complete, roundId: fictionalId(99) },
    { ...complete, cards: complete.cards.slice(1) },
    { ...complete, cards: complete.cards.map((card, index) => index === 0 ? { ...card, playerId: fictionalId(99) } : card) },
    { ...complete, cards: complete.cards.map((card) => ({ ...card, holes: card.holes.slice(1) })) },
    { ...complete, cards: complete.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole, number: 1 })) })) },
    { ...complete, layout: complete.layout.map((hole) => ({ ...hole, par: 5 })) },
    { ...complete, groups: [{ number: 2, playerIds: round.players.map((player) => player.playerId) }] },
  ])('fails closed for missing, corrupt or mismatched projections %#', (scores) => {
    expect(summarize(scores)).toEqual({ kind: 'unavailable' });
  });
});
