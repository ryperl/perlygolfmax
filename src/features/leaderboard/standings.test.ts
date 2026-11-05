import { describe, expect, it } from 'vitest';
import { fictionalStanding, leaderboardPlayers, leaderboardRound } from '../../client/leaderboard.test-support';
import { gameStandings } from './standings';
import { isRoundScores } from '../../contracts/scoring';
import type { GameTeamResult } from '../../domain/games';

describe('saved game standings', () => {
  it('ranks points earned so far, not projected points, progress or gross strokes', () => {
    expect(isRoundScores(leaderboardRound)).toBe(true);
    const standings = gameStandings(leaderboardPlayers);
    expect(standings.ranked.map((entry) => [entry.player.totalPoints, entry.player.holesScored, entry.position, entry.tied])).toEqual([
      [4, 2, 1, true], [4, 9, 1, true], [0, 1, 3, false], [-2, 9, 4, false],
    ]);
    expect(standings.provisional).toBe(true);
    expect(standings.awaiting.map((player) => player.displayName)).toEqual(['Fictional golfer 5']);
    expect(standings.unavailable.map((player) => player.displayName)).toEqual(['Fictional golfer 6']);
  });
  it('keeps negative ties tied and leaves ties in server roster order without a tie-break', () => {
    const players = [fictionalStanding(3, -2), fictionalStanding(2, 0), fictionalStanding(1, -2), fictionalStanding(4, -5)];
    expect(gameStandings(players).ranked.map((entry) => [entry.player.playerId, entry.position, entry.tied])).toEqual([
      [players[1]?.playerId, 1, false], [players[0]?.playerId, 2, true],
      [players[2]?.playerId, 2, true], [players[3]?.playerId, 4, false],
    ]);
  });
  it('distinguishes known zero from no scored holes and never ranks an unavailable result', () => {
    const players = [
      fictionalStanding(1, 0), fictionalStanding(2, null), fictionalStanding(3, 0, 0),
      { ...fictionalStanding(4, null), status: 'unavailable' as const, unavailableReason: 'missing-tee-ratings' as const },
    ];
    const standings = gameStandings(players);
    expect(standings.ranked).toHaveLength(1);
    expect(standings.ranked[0]?.player.totalPoints).toBe(0);
    expect(standings.awaiting).toHaveLength(2);
    expect(standings.unavailable).toHaveLength(1);
  });
  it('does not mutate or reorder readonly inputs and handles empty/complete cards', () => {
    const players = Object.freeze([Object.freeze(fictionalStanding(1, -5, 9)), Object.freeze(fictionalStanding(2, 0, 9))]);
    expect(gameStandings(players).ranked[0]?.player.displayName).toBe('Fictional golfer 2');
    expect(players[0]?.displayName).toBe('Fictional golfer 1');
    expect(gameStandings(players).provisional).toBe(false);
    expect(gameStandings([])).toEqual({ ranked: [], awaiting: [], unavailable: [], provisional: false });
  });
  it('supports tied first place for all players and exact large signed totals', () => {
    expect(gameStandings([1, 2, 3].map((id) => fictionalStanding(id, 0))).ranked.map((entry) => [entry.position, entry.tied]))
      .toEqual([[1, true], [1, true], [1, true]]);
    expect(gameStandings([fictionalStanding(1, -Number.MAX_SAFE_INTEGER), fictionalStanding(2, Number.MAX_SAFE_INTEGER)])
      .ranked.map((entry) => entry.player.totalPoints)).toEqual([Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]);
  });
  it('uses the same stable competition ranking for teams, including zero, pending and unavailable teams', () => {
    const teams: readonly GameTeamResult[] = [0, 0, -2, null, null].map((points, index) => {
      const { playerId, playingHandicap, ...entry } = fictionalStanding(index + 1, points);
      void playingHandicap;
      return { ...entry, teamId: playerId, playerIds: [], ...(index === 4 ? { status: 'unavailable' } : {}) };
    });
    const standings = gameStandings(teams);
    expect(standings.ranked.map((entry) => [entry.player.totalPoints, entry.position, entry.tied])).toEqual([
      [0, 1, true], [0, 1, true], [-2, 3, false],
    ]);
    expect(standings.awaiting).toHaveLength(1);
    expect(standings.unavailable).toHaveLength(1);
    expect(standings.provisional).toBe(true);
  });
});
