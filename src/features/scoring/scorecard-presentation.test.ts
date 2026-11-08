import { describe, expect, it } from 'vitest';
import { fictionalRoundScores } from '../../client/scoring.test-support';
import { ballDropContribution, ballDropScoreText, cardTotalText, pointsTotalText, scorecardBallDropTeams, scorecardGame, scorecardGameWarnings, summarizeCard } from './scorecard-presentation';
import { scorecardGamesFixture } from './scorecard-games.test-support';
import { ballDropFormat, strokeGameFixture, strokeGamesRound } from '../../domain/stroke-games.test-support';

const card = fictionalRoundScores.cards[0];
if (!card) throw new Error('Missing fictional card.');
describe('scorecard displayed totals', () => {
  it.each([
    ['ball-drop-net-gross', 'net', 'gross'],
    ['ball-drop-two-net', 'net', 'net'],
    ['ball-drop-two-gross', 'gross', 'gross'],
  ] as const)('uses saved counting IDs and roles for %s rather than selecting scores again', (format, first, second) => {
    const f = strokeGameFixture();
    const ballDrop = { ...ballDropFormat(f.ballDrop, format), teams: f.ballDrop.teams.map((team) => ({
      ...team, playerIds: [...team.playerIds].reverse(),
    })) };
    const round = strokeGamesRound({ ...f, ballDrop });
    const game = scorecardGame(round);
    const ids = f.cards.map((entry) => entry.playerId);
    expect(ballDropContribution(game, ids[3] ?? '', 1)).toEqual({ teamName: 'Fictional team 1', basis: first });
    expect(ballDropContribution(game, ids[2] ?? '', 1)).toEqual({ teamName: 'Fictional team 1', basis: second });
    expect(ballDropContribution(game, ids[0] ?? '', 1)).toBeUndefined();
    expect(scorecardBallDropTeams(game, round.cards)).toHaveLength(1);
    expect(scorecardBallDropTeams(scorecardGame(round, f.skins.id), round.cards)).toEqual([]);
  });
  it('formats positive, par, negative, pending and incomplete Ball Drop scores honestly', () => {
    expect(ballDropScoreText(1)).toBe('+1');
    expect(ballDropScoreText(0)).toBe('0');
    expect(ballDropScoreText(-1)).toBe('-1');
    expect(ballDropScoreText(1, false)).toBe('+1*');
    expect(ballDropScoreText(null)).toBe('—');
    expect(ballDropScoreText(undefined)).toBe('—');
  });
  it('resolves a saved game by view selection without calculating or changing game configuration', () => {
    const { round, games } = scorecardGamesFixture();
    expect(scorecardGame(round)?.definition).toBe(games[0]);
    expect(scorecardGame(round, games[1]?.id)?.definition).toBe(games[1]);
    expect(scorecardGame(round, null)).toBeUndefined();
    expect(scorecardGame(fictionalRoundScores)).toBeUndefined();
    expect(scorecardGame(round, 'missing-view-id')?.definition).toBe(games[0]);
  });
  it('preserves zero/negative points and identifies partial totals without filling pending points', () => {
    expect(pointsTotalText(0, true)).toBe('0');
    expect(pointsTotalText(0, false)).toBe('0*');
    expect(pointsTotalText(-2, true)).toBe('-2');
    expect(pointsTotalText(-2, false)).toBe('-2*');
    expect(pointsTotalText(null, false)).toBe('—');
  });
  it('summarizes unavailable inputs only for the displayed players and keeps them distinct from pending points', () => {
    const { round, games } = scorecardGamesFixture();
    const net = scorecardGame(round, games[2]?.id);
    expect(scorecardGameWarnings(net, round.cards)).toEqual(['Fictional Player 3: No captured Handicap Index is available.']);
    expect(scorecardGameWarnings(net, round.cards.slice(0, 1))).toEqual([]);
    expect(scorecardGameWarnings(undefined, round.cards)).toEqual([]);
  });
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
