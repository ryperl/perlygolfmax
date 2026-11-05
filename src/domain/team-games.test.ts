import { describe, expect, it } from 'vitest';
import type { GamePlayerResult, TeamGameDefinition, TeamGameFormat } from './games.js';
import { teamSize } from './games.js';
import { aggregateTeamGameResults } from './team-games.js';
import { stablefordPoints } from './stableford.js';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
function player(number: number, points: readonly (number | null)[]): GamePlayerResult {
  return {
    playerId: id(number), displayName: `Fictional golfer ${String(number)}`, playingHandicap: 0,
    status: 'in-progress', holes: points.map((point, index) => ({ number: index + 1, points: point, strokesReceived: 0 })),
    holesScored: 0, totalHoles: points.length, frontPoints: null, backPoints: null, totalPoints: null,
  };
}
function game(format: TeamGameFormat): TeamGameDefinition {
  return {
    id: id(10), name: 'Fictional team game', basis: 'net', format, preset: 'standard', handicapAllowancePercent: 100,
    points: stablefordPoints('standard'),
    teams: [{ id: id(20), name: 'Fictional team', playerIds: [1, 2, 3, 4].slice(0, teamSize(format)).map(id) }],
  };
}

describe('per-hole team points aggregation', () => {
  it.each([
    ['two-net-better-ball', [8, 9, -2, 0]],
    ['two-net-aggregate', [5, 9, -7, 0]],
    ['four-two-net', [15, 17, -3, 0]],
  ] as const)('counts highest points independently on every hole: %s', (format, expected) => {
    const players = [player(1, [8, 0, -5, 0]), player(2, [-3, 9, -2, 0]),
      player(3, [7, 8, -1, 0]), player(4, [1, -6, -8, 0])];
    const input = { definition: game(format), players };
    const before = structuredClone(input);
    const results = aggregateTeamGameResults(input.definition, players, [1, 2, 3, 4]);
    expect(results[0]?.holes.map((hole) => hole.points)).toEqual(expected);
    expect(results[0]).toMatchObject({ status: 'complete', holesScored: 4, totalHoles: 4,
      frontPoints: expected.reduce<number>((sum, point) => sum + point, 0), backPoints: null });
    expect(input).toEqual(before);
    expect(results[0]).not.toHaveProperty('playingHandicap');
    expect(results[0]?.holes[0]).not.toHaveProperty('strokesReceived');
  });

  it('requires all four saved teammate values, not just two or three, and preserves pending versus zero', () => {
    const players = [player(1, [4, 0, 0]), player(2, [3, 0, 0]), player(3, [null, 0, 0]), player(4, [null, null, 0])];
    expect(aggregateTeamGameResults(game('four-two-net'), players, [1, 2, 3])[0]).toMatchObject({
      status: 'in-progress', holesScored: 1, totalPoints: 0, frontPoints: 0, backPoints: null,
      holes: [{ number: 1, points: null }, { number: 2, points: null }, { number: 3, points: 0 }],
    });
    expect(aggregateTeamGameResults(game('four-two-net'), players, [1, 2])[0]).toMatchObject({
      status: 'in-progress', holesScored: 0, totalPoints: null, frontPoints: null, backPoints: null,
    });
  });

  it('propagates unavailable sources or missing members/holes without partial team points', () => {
    const players = [1, 2, 3, 4].map((number) => player(number, [4, 4]));
    const missingIndex = players.map((source, index): GamePlayerResult => index === 3 ? {
      ...source, status: 'unavailable', unavailableReason: 'missing-handicap-index',
      holes: source.holes.map((hole) => ({ ...hole, points: null, strokesReceived: null })),
    } : source);
    expect(aggregateTeamGameResults(game('four-two-net'), missingIndex, [1, 2])[0]).toMatchObject({
      status: 'unavailable', unavailableReason: 'missing-handicap-index', holesScored: 0,
      frontPoints: null, backPoints: null, totalPoints: null,
    });
    for (const sources of [players.slice(1), players.map((source) => ({ ...source, holes: source.holes.slice(1) }))]) {
      expect(aggregateTeamGameResults(game('four-two-net'), sources, [1, 2])[0]).toMatchObject({
        status: 'unavailable', unavailableReason: 'missing-score-data', holesScored: 0, totalPoints: null,
      });
    }
  });
});
