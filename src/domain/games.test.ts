import { describe, expect, it } from 'vitest';
import type { RoundGameDefinition, TeamGameDefinition, TeamGameFormat } from './games.js';
import {
  defaultHandicapAllowancePercent, defaultTeamHandicapAllowancePercent, gameTeamsMatchRoster,
  isTeamGameDefinition, maximumExactGamePoints, maximumExactPointsForGame, maximumGameConfigurationBytes,
  sameGameDefinitions, teamCountingSize, teamSize,
} from './games.js';
import { stablefordPoints } from './stableford.js';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const roster = [1, 2, 3, 4].map(id);
function teamGame(format: TeamGameFormat = 'two-net-better-ball'): TeamGameDefinition {
  const size = teamSize(format);
  return {
    id: id(20), name: 'Fictional team game', basis: 'net', preset: 'standard',
    handicapAllowancePercent: defaultTeamHandicapAllowancePercent, points: stablefordPoints('standard'), format,
    teams: Array.from({ length: roster.length / size }, (_, index) => ({
      id: id(100 + index), name: `Fictional team ${String(index + 1)}`, playerIds: roster.slice(index * size, (index + 1) * size),
    })),
  };
}

describe('team game definitions', () => {
  it('keeps individual defaults and legacy shapes independent of new team defaults and budgets', () => {
    const individual: RoundGameDefinition = {
      id: id(10), name: 'Fictional individual', basis: 'net', preset: 'standard',
      handicapAllowancePercent: defaultHandicapAllowancePercent, points: stablefordPoints('standard'),
    };
    expect(defaultHandicapAllowancePercent).toBe(95);
    expect(defaultTeamHandicapAllowancePercent).toBe(100);
    expect(maximumGameConfigurationBytes).toBe(12 * 1024);
    expect(isTeamGameDefinition(individual)).toBe(false);
    expect(maximumExactPointsForGame(individual)).toBe(maximumExactGamePoints);
    expect(gameTeamsMatchRoster(individual, roster)).toBe(true);
    expect(sameGameDefinitions([individual], [structuredClone(individual)])).toBe(true);
    expect(sameGameDefinitions([individual], [teamGame()])).toBe(false);
  });

  it.each([
    ['two-net-better-ball', 2, 1], ['two-net-aggregate', 2, 2], ['four-two-net', 4, 2],
  ] as const)('defines size, counting budget and exact roster coverage for %s', (format, size, counting) => {
    const game = teamGame(format);
    expect(isTeamGameDefinition(game)).toBe(true);
    expect(teamSize(format)).toBe(size);
    expect(teamCountingSize(format)).toBe(counting);
    expect(maximumExactPointsForGame(game)).toBe(Math.floor(Number.MAX_SAFE_INTEGER / (18 * counting)));
    expect(gameTeamsMatchRoster(game, [...roster].reverse())).toBe(true);
    const first = game.teams[0];
    if (!first) throw new Error('Missing fictional team');
    expect(gameTeamsMatchRoster({ ...game, teams: [first] }, first.playerIds)).toBe(true);
    for (const players of [[], roster.slice(1), [...roster, id(5)], [id(1), id(1), id(3), id(4)], [id(1), id(2), id(3), id(9)]]) {
      expect(gameTeamsMatchRoster(game, players)).toBe(false);
    }
    expect(gameTeamsMatchRoster({ ...game, teams: [...game.teams, ...game.teams] }, roster)).toBe(false);
    expect(gameTeamsMatchRoster({ ...game, teams: game.teams.map((team) => ({ ...team, playerIds: team.playerIds.slice(1) })) }, roster)).toBe(false);
  });

  it('includes format, names, team identity and ordered members in equality receipts', () => {
    const game = teamGame();
    expect(sameGameDefinitions([game], [structuredClone(game)])).toBe(true);
    expect(sameGameDefinitions([game], [])).toBe(false);
    const variants: readonly RoundGameDefinition[] = [
      { ...game, format: 'two-net-aggregate' },
      { ...game, preset: 'modified' },
      { ...game, handicapAllowancePercent: 95 },
      { ...game, teams: [...game.teams].reverse() },
      ...['id', 'name', 'members'].map((field): TeamGameDefinition => ({
        ...game, teams: game.teams.map((team, index) => index !== 0 ? team : ({
          ...team, ...(field === 'id' ? { id: id(900) } : field === 'name' ? { name: 'Fictional renamed team' }
            : { playerIds: [...team.playerIds].reverse() }),
        })),
      })),
    ];
    for (const other of variants) expect(sameGameDefinitions([game], [other])).toBe(false);
  });
});
