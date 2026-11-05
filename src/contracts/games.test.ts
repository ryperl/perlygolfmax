import { describe, expect, it } from 'vitest';
import type {
  GameChange, GamePlayerResult, IndividualGameDefinition, RoundGamesView, TeamGameDefinition, TeamGameFormat,
} from '../domain/games.js';
import { maximumExactGamePoints, maximumExactPointsForGame, maximumGamesPerRound, maximumPointsRows, teamSize } from '../domain/games.js';
import { aggregateTeamGameResults } from '../domain/team-games.js';
import { stablefordPoints } from '../domain/stableford.js';
import {
  isGameChange, isGameConfiguration, isRoundGameDefinition, isRoundGameDefinitions, isRoundGamesView,
} from './games.js';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
function game(number = 1, overrides: Partial<IndividualGameDefinition> = {}): IndividualGameDefinition {
  return { id: id(number), name: 'Fictional Stableford', preset: 'standard', basis: 'gross',
    handicapAllowancePercent: 95, points: stablefordPoints('standard'), ...overrides };
}
function player(number: number, count = 18, overrides: Partial<GamePlayerResult> = {}): GamePlayerResult {
  return {
    playerId: id(number + 100), displayName: `Fictional golfer ${String(number)}`, playingHandicap: null,
    status: 'complete', totalHoles: count, holesScored: count, frontPoints: 18,
    backPoints: count === 18 ? 18 : null, totalPoints: count * 2,
    holes: Array.from({ length: count }, (_, index) => ({ number: index + 1, points: 2, strokesReceived: 0 })),
    ...overrides,
  };
}
function view(count = 18): RoundGamesView {
  return {
    configuration: { eventId: id(10), roundId: id(20), etag: 'fictional-game-v1', games: [game()] },
    results: [{ gameId: id(1), players: [1, 2, 3, 4].map((number) => player(number, count)) }],
  };
}
function mapPlayers(value: RoundGamesView, mapper: (player: GamePlayerResult, index: number) => unknown): unknown {
  return { ...value, results: value.results.map((result) => ({ ...result, players: result.players.map(mapper) })) };
}
function unavailable(value: GamePlayerResult): GamePlayerResult {
  return { ...value, status: 'unavailable', unavailableReason: 'missing-score-data', playingHandicap: null,
    holesScored: 0, frontPoints: null, backPoints: null, totalPoints: null,
    holes: value.holes.map((hole) => ({ ...hole, points: null, strokesReceived: null })) };
}
const change: GameChange = {
  id: id(30), eventId: id(10), roundId: id(20), expectedEtag: null, before: [], after: [game()],
  recordedAt: '2026-01-01T00:00:00Z', recordedBy: { tenantId: id(40), objectId: id(50) },
};

describe('Stableford configuration runtime contracts', () => {
  it('accepts standard, modified, extended custom tables and editable tails independently of preset', () => {
    expect(isRoundGameDefinition(game())).toBe(true);
    expect(isRoundGameDefinition(game(1, { preset: 'modified', basis: 'net', points: stablefordPoints('modified') }))).toBe(true);
    const rows = Array.from({ length: maximumPointsRows }, (_, index) => ({ scoreToPar: index - 25, points: index - 10 }));
    expect(isRoundGameDefinition(game(1, { points: { rows, betterScorePoints: -20, worseScorePoints: 100 } }))).toBe(true);
    for (const boundary of [-maximumExactGamePoints, maximumExactGamePoints]) {
      expect(isRoundGameDefinition(game(1, { points: { rows: [{ scoreToPar: 0, points: boundary }],
        betterScorePoints: boundary, worseScorePoints: boundary } }))).toBe(true);
    }
    expect(isRoundGameDefinitions([])).toBe(true);
    expect(isRoundGameDefinitions(Array.from({ length: maximumGamesPerRound }, (_, index) => game(index + 1)))).toBe(true);
  });

  it.each([
    null, undefined, [], {}, 0, 'game',
    { ...game(), id: 'not-a-uuid' }, { ...game(), id: 1 },
    { ...game(), name: '' }, { ...game(), name: ' padded' }, { ...game(), name: 'a'.repeat(101) },
    { ...game(), name: 'Fictional\nname' }, { ...game(), preset: 'unknown' }, { ...game(), basis: 'adjusted' },
    { ...game(), handicapAllowancePercent: 0 }, { ...game(), handicapAllowancePercent: 101 },
    { ...game(), handicapAllowancePercent: 95.5 }, { ...game(), handicapAllowancePercent: '95' },
    { ...game(), handicapAllowancePercent: undefined }, { ...game(), extra: true },
    { ...game(), points: null }, { ...game(), points: { rows: [] } },
  ])('rejects malformed or ambiguous definitions %j', (value) => {
    expect(isRoundGameDefinition(value)).toBe(false);
  });

  it('rejects duplicate games, excess budgets and unsafe/unsorted/gapped point rows and tails', () => {
    for (const value of [null, {}, [game(), game()], [null],
      Array.from({ length: maximumGamesPerRound + 1 }, (_, index) => game(index + 1))]) {
      expect(isRoundGameDefinitions(value)).toBe(false);
    }
    const base = game();
    for (const points of [
      { ...base.points, rows: [] }, { ...base.points, rows: [null] },
      { ...base.points, rows: Array.from({ length: maximumPointsRows + 1 }, (_, scoreToPar) => ({ scoreToPar, points: 0 })) },
      { ...base.points, rows: [...base.points.rows].reverse() },
      { ...base.points, rows: [{ scoreToPar: 0, points: 1 }, { scoreToPar: 0, points: 2 }] },
      { ...base.points, rows: [{ scoreToPar: 0, points: 1 }, { scoreToPar: 2, points: 2 }] },
      { ...base.points, rows: [{ scoreToPar: 0.5, points: 1 }] },
      { ...base.points, rows: [{ scoreToPar: Number.MAX_SAFE_INTEGER + 1, points: 1 }] },
      { ...base.points, rows: [{ scoreToPar: 0, points: 0, extra: true }] },
      { ...base.points, extra: true },
      ...[NaN, Infinity, -Infinity, 1.5, maximumExactGamePoints + 1, -maximumExactGamePoints - 1, '2'].flatMap((points) => [
        { ...base.points, rows: [{ scoreToPar: 0, points }] },
        { ...base.points, betterScorePoints: points }, { ...base.points, worseScorePoints: points },
      ]),
    ]) expect(isRoundGameDefinition({ ...base, points })).toBe(false);
  });

  it('requires event/round IDs and distinguishes empty virtual configuration from saved games', () => {
    const config = view().configuration;
    expect(isGameConfiguration(config)).toBe(true);
    expect(isGameConfiguration({ ...config, etag: null, games: [] })).toBe(true);
    for (const value of [
      null, {}, { ...config, eventId: 'event' }, { ...config, roundId: '' },
      { ...config, etag: null }, { ...config, etag: '*' }, { ...config, etag: '' },
      { ...config, etag: 'a'.repeat(513) }, { ...config, etag: 'bad\netag' },
      { ...config, etag: 'persisted', games: [] }, { ...config, games: [game(), game()] }, { ...config, extra: true },
    ]) expect(isGameConfiguration(value)).toBe(false);
  });

  it('validates immutable audit before/after snapshots, expected revisions, actor and ISO instant', () => {
    const before = structuredClone(change);
    expect(isGameChange(change)).toBe(true);
    expect(change).toEqual(before);
    expect(isGameChange({ ...change, before: [game()], expectedEtag: 'fictional-v1' })).toBe(true);
    expect(isGameChange({ ...change, recordedAt: '2026-01-01T10:00:00.123+01:00' })).toBe(true);
    for (const value of [
      null, {}, { ...change, id: 'request' }, { ...change, eventId: 1 }, { ...change, roundId: null },
      { ...change, after: [] }, { ...change, after: [game(), game()] }, { ...change, before: [null] },
      { ...change, expectedEtag: '*' }, { ...change, expectedEtag: 'v1' },
      { ...change, before: [game()], expectedEtag: null },
      { ...change, recordedAt: '2026-01-01' }, { ...change, recordedAt: 'tomorrow' },
      { ...change, recordedAt: '2026-02-31T00:00:00Z' }, { ...change, recordedAt: 123 },
      { ...change, recordedBy: null }, { ...change, recordedBy: { tenantId: id(40), objectId: 'actor' } },
      { ...change, recordedBy: { tenantId: 'tenant', objectId: id(50) } }, { ...change, extra: true },
    ]) expect(isGameChange(value)).toBe(false);
  });
});

describe('self-contained round game result contracts', () => {
  it.each([9, 18])('accepts complete, blank, partial, unavailable and zero-point outcomes on %s holes', (count) => {
    const value = view(count);
    expect(isRoundGamesView(value)).toBe(true);
    expect(isRoundGamesView(mapPlayers(value, unavailable))).toBe(true);
    expect(isRoundGamesView(mapPlayers(value, (p) => ({
      ...p, status: 'in-progress', holesScored: 0, frontPoints: null, backPoints: null, totalPoints: null,
      holes: p.holes.map((hole) => ({ ...hole, points: null })),
    })))).toBe(true);
    expect(isRoundGamesView(mapPlayers(value, (p) => ({
      ...p, status: 'in-progress', holesScored: 1, frontPoints: 0, backPoints: null, totalPoints: 0,
      holes: p.holes.map((hole, index) => ({ ...hole, points: index === 0 ? 0 : null })),
    })))).toBe(true);
    const zero = mapPlayers(value, (p) => ({ ...p, frontPoints: 0, backPoints: count === 9 ? null : 0, totalPoints: 0,
      holes: p.holes.map((hole) => ({ ...hole, points: 0 })) }));
    expect(isRoundGamesView(zero)).toBe(true);
  });

  function teamView(format: TeamGameFormat = 'four-two-net', count = 18, rosterSize = 4): RoundGamesView {
    const players = Array.from({ length: rosterSize }, (_, index) => player(index + 1, count, { playingHandicap: 0 }));
    const size = teamSize(format);
    const definition: TeamGameDefinition = {
      ...game(), basis: 'net', format, handicapAllowancePercent: 100,
      teams: Array.from({ length: Math.floor(rosterSize / size) }, (_, index) => ({
        id: id(900 + index), name: `Fictional team ${String(index + 1)}`,
        playerIds: players.slice(index * size, (index + 1) * size).map((player) => player.playerId),
      })),
    };
    return {
      configuration: { ...view(count).configuration, games: [definition] },
      results: [{ gameId: definition.id, players,
        teams: aggregateTeamGameResults(definition, players, Array.from({ length: count }, (_, index) => index + 1)) }],
    };
  }
  function teamDefinition(value: RoundGamesView): TeamGameDefinition {
    const definition = value.configuration.games[0];
    if (!definition || definition.format === undefined) throw new Error('Missing fictional team definition');
    return definition;
  }

  describe('team definition and exact projection contracts', () => {
    it.each(['two-net-better-ball', 'two-net-aggregate', 'four-two-net'] as const)('accepts explicit complete teams for %s on 9/18 holes', (format) => {
      for (const count of [9, 18]) {
        for (const size of [4, 8]) {
          const value = teamView(format, count, size);
          const before = structuredClone(value);
          expect(isRoundGameDefinition(teamDefinition(value))).toBe(true);
          expect(isRoundGamesView(value)).toBe(true);
          expect(isGameChange({ ...change, after: value.configuration.games })).toBe(true);
          expect(value).toEqual(before);
        }
      }
      expect(isRoundGamesView(teamView(format, 18, 6))).toBe(format !== 'four-two-net');
    });

    it('rejects unknown format, gross teams, extra keys, partial/duplicate/malformed team identities and assignments', () => {
      const definition = teamDefinition(teamView('two-net-better-ball'));
      const first = definition.teams[0];
      if (!first) throw new Error('Missing fictional team');
      const invalid = [
        { ...definition, format: 'four-two-net-modified' }, { ...definition, basis: 'gross' },
        { ...definition, format: undefined }, { ...definition, teams: undefined }, { ...definition, teams: [] },
        { ...definition, extra: true }, { ...definition, teams: [first] }, { ...definition, teams: [first, first] },
        ...[
          { ...first, id: 'team' }, { ...first, name: '' }, { ...first, name: ' Fictional team' },
          { ...first, name: 'x'.repeat(101) }, { ...first, extra: true },
          { ...first, playerIds: first.playerIds.slice(1) }, { ...first, playerIds: [id(101), id(101)] },
          { ...first, playerIds: ['player', id(102)] }, { ...first, playerIds: [id(103), id(104)] },
        ].map((team) => ({ ...definition, teams: [team, ...definition.teams.slice(1)] })),
        { ...definition, teams: Array.from({ length: 5 }, (_, index) => ({
          id: id(600 + index), name: 'Fictional team', playerIds: [id(700 + index * 2), id(701 + index * 2)],
        })) },
      ];
      for (const value of invalid) expect(isRoundGameDefinition(value)).toBe(false);
      expect(isRoundGameDefinition({ ...game(), teams: definition.teams })).toBe(false);
    });

    it.each(['two-net-better-ball', 'two-net-aggregate', 'four-two-net'] as const)('uses counting-size-specific exact signed table budgets for %s', (format) => {
      const definition = teamDefinition(teamView(format));
      const maximum = maximumExactPointsForGame(definition);
      for (const sign of [-1, 1]) {
        const point = maximum * sign;
        const points = { rows: [{ scoreToPar: 0, points: point }], betterScorePoints: point, worseScorePoints: point };
        expect(isRoundGameDefinition({ ...definition, points })).toBe(true);
        expect(isRoundGameDefinition({ ...definition, points: { ...points, betterScorePoints: (maximum + 1) * sign } })).toBe(false);
        expect(isRoundGameDefinition({ ...definition, points: { ...points, worseScorePoints: (maximum + 1) * sign } })).toBe(false);
        expect(isRoundGameDefinition({ ...definition, points: { ...points, rows: [{ scoreToPar: 0, points: (maximum + 1) * sign }] } })).toBe(false);
        const base = teamView(format);
        const players = base.results[0]?.players.map((source) => ({
          ...source, frontPoints: point * 9, backPoints: point * 9, totalPoints: point * 18,
          holes: source.holes.map((hole) => ({ ...hole, points: point })),
        })) ?? [];
        const game = { ...definition, points };
        expect(isRoundGamesView({
          configuration: { ...base.configuration, games: [game] },
          results: [{ gameId: game.id, players, teams: aggregateTeamGameResults(game, players, players[0]?.holes.map((hole) => hole.number) ?? []) }],
        })).toBe(true);
      }
    });

    it('rejects missing/extra/tampered teams and individual projections carrying teams', () => {
      const value = teamView();
      const result = value.results[0];
      const team = result?.teams?.[0];
      if (!result || !team) throw new Error('Missing fictional team result');
      const { teams: omitted, ...withoutTeams } = result;
      expect(omitted).toHaveLength(1);
      for (const replacement of [
        withoutTeams, { ...result, teams: [] }, { ...result, teams: [team, team] },
        ...[
          { ...team, teamId: id(999) }, { ...team, displayName: 'Fictional other team' },
          { ...team, playerIds: [...team.playerIds].reverse() }, { ...team, playerIds: team.playerIds.slice(1) },
          { ...team, totalPoints: 71 }, { ...team, frontPoints: 35 }, { ...team, backPoints: null },
          { ...team, totalHoles: 9 }, { ...team, holesScored: 17 }, { ...team, status: 'in-progress' },
          { ...team, unavailableReason: undefined }, { ...team, playingHandicap: 0 },
          { ...team, holes: team.holes.map((hole) => ({ ...hole, points: 3 })) },
          { ...team, holes: [...team.holes].reverse() },
          { ...team, holes: team.holes.map((hole) => ({ ...hole, strokesReceived: 0 })) },
        ].map((team) => ({ ...result, teams: [team] })),
      ]) expect(isRoundGamesView({ ...value, results: [replacement] })).toBe(false);
      const individual = view();
      expect(isRoundGamesView({ ...individual, results: individual.results.map((result) => ({ ...result, teams: [] })) })).toBe(false);
    });

    it('rejects validly shaped but unknown golfer assignments or incomplete result rosters', () => {
      const value = teamView();
      const definition = teamDefinition(value);
      const changed = { ...definition, teams: definition.teams.map((team) => ({
        ...team, playerIds: team.playerIds.map((id, index) => index === 0 ? '00000000-0000-4000-8000-000000000999' : id),
      })) };
      expect(isRoundGameDefinition(changed)).toBe(true);
      expect(isRoundGamesView({ ...value, configuration: { ...value.configuration, games: [changed] } })).toBe(false);
      const configuration = { ...value.configuration, games: [changed] };
      const results = value.results.map((result) => ({ ...result, teams: [], teamSetupRequired: true }));
      expect(isRoundGamesView({ configuration, results })).toBe(true);
      for (const fields of [
        { teamSetupRequired: undefined }, { teamSetupRequired: false }, { teamSetupRequired: 'true' },
        { teams: value.results[0]?.teams }, { teams: undefined },
      ]) expect(isRoundGamesView({ configuration, results: results.map((result) => ({ ...result, ...fields })) })).toBe(false);
      for (const fields of [{ teamSetupRequired: true }, { teamSetupRequired: undefined }, { teamSetupRequired: true, teams: [] }]) {
        expect(isRoundGamesView({ ...value, results: value.results.map((result) => ({ ...result, ...fields })) })).toBe(false);
      }
      const individual = view();
      expect(isRoundGamesView({ ...individual, results: individual.results.map((result) => ({
        ...result, teamSetupRequired: true,
      })) })).toBe(false);
      expect(isRoundGamesView({ ...value, results: value.results.map((result) => ({ ...result, players: result.players.slice(1) })) })).toBe(false);
    });

    it('checks pending all-members completion and unavailable reason against the exact individual sources', () => {
      const base = teamView();
      const definition = teamDefinition(base);
      const result = base.results[0];
      if (!result) throw new Error('Missing fictional result');
      const sources = [
        result.players.map((source, index): GamePlayerResult => index !== 3 ? source : ({
          ...source, status: 'in-progress', holesScored: 0, frontPoints: null, backPoints: null, totalPoints: null,
          holes: source.holes.map((hole) => ({ ...hole, points: null })),
        })),
        result.players.map((source, index) => index !== 3 ? source : unavailable(source)),
      ];
      for (const players of sources) {
        const teams = aggregateTeamGameResults(definition, players, result.players[0]?.holes.map((hole) => hole.number) ?? []);
        const value = { ...base, results: [{ ...result, players, teams }] };
        expect(isRoundGamesView(value)).toBe(true);
        const team = teams[0];
        if (!team) throw new Error('Missing fictional team');
        for (const changed of [
          { ...team, totalPoints: 0 }, { ...team, holesScored: 18 }, { ...team, status: 'complete' },
          { ...team, holes: team.holes.map((hole) => ({ ...hole, points: 4 })), frontPoints: 36, backPoints: 36, totalPoints: 72, holesScored: 18, status: 'complete' },
          { ...team, unavailableReason: team.status === 'unavailable' ? 'missing-handicap-index' : 'missing-score-data' },
        ]) expect(isRoundGamesView({ ...value, results: [{ ...result, players, teams: [changed] }] })).toBe(false);
      }
    });
  });

  it('accepts negative modified totals and exact maximum totals', () => {
    const value = view();
    for (const point of [-2, -maximumExactGamePoints, maximumExactGamePoints]) {
      const points = { rows: [{ scoreToPar: 0, points: point }], betterScorePoints: point, worseScorePoints: point };
      const configuration = { ...value.configuration, games: [game(1, { preset: 'modified', points })] };
      expect(isRoundGamesView(mapPlayers({ ...value, configuration }, (p) => ({
        ...p, frontPoints: point * 9, backPoints: point * 9, totalPoints: point * 18,
        holes: p.holes.map((hole) => ({ ...hole, points: point })),
      })))).toBe(true);
    }
  });

  it.each([
    { playerId: 'golfer' }, { displayName: '' }, { displayName: 'a'.repeat(101) },
    { playingHandicap: 0 }, { status: 'pending' }, { status: 'complete', unavailableReason: 'missing-score-data' },
    { holesScored: 17 }, { holesScored: 19 }, { holesScored: -1 }, { holesScored: 18.5 },
    { totalHoles: 9 }, { totalPoints: 0 }, { totalPoints: null }, { totalPoints: Number.MAX_SAFE_INTEGER },
    { frontPoints: 0 }, { backPoints: null }, { frontPoints: NaN }, { totalPoints: '36' }, { extra: true },
  ])('rejects inconsistent player fields %j', (fields) => {
    expect(isRoundGamesView(mapPlayers(view(), (p) => ({ ...p, ...fields })))).toBe(false);
  });

  it('rejects holes with missing/duplicate/unsorted numbers, unsupported points or incorrect received strokes', () => {
    const value = view();
    for (const mapper of [
      (p: GamePlayerResult) => p.holes.slice(1),
      (p: GamePlayerResult) => [...p.holes].reverse(),
      (p: GamePlayerResult) => p.holes.map((hole) => ({ ...hole, number: 1 })),
      (p: GamePlayerResult) => p.holes.map((hole) => ({ ...hole, points: 7 })),
      (p: GamePlayerResult) => p.holes.map((hole) => ({ ...hole, points: maximumExactGamePoints + 1 })),
      (p: GamePlayerResult) => p.holes.map((hole) => ({ ...hole, points: 1.5 })),
      (p: GamePlayerResult) => p.holes.map((hole) => ({ ...hole, strokesReceived: 1 })),
      (p: GamePlayerResult) => p.holes.map((hole) => ({ ...hole, strokesReceived: null })),
      (p: GamePlayerResult) => p.holes.map((hole) => ({ ...hole, extra: true })),
      () => [null],
    ]) expect(isRoundGamesView(mapPlayers(value, (p) => ({ ...p, holes: mapper(p) })))).toBe(false);
  });

  it('requires null empty totals, correct partial sums and complete only when every hole has points', () => {
    const value = view();
    const partial = (p: GamePlayerResult): GamePlayerResult => ({
      ...p, status: 'in-progress', holesScored: 1, frontPoints: null, backPoints: 2, totalPoints: 2,
      holes: p.holes.map((hole) => ({ ...hole, points: hole.number === 10 ? 2 : null })),
    });
    expect(isRoundGamesView(mapPlayers(value, partial))).toBe(true);
    for (const fields of [
      { frontPoints: 0 }, { status: 'complete' }, { backPoints: null }, { totalPoints: null }, { holesScored: 0 },
    ]) expect(isRoundGamesView(mapPlayers(value, (p) => ({ ...partial(p), ...fields })))).toBe(false);
    expect(isRoundGamesView(mapPlayers(view(9), (p) => ({ ...p, backPoints: 0 })))).toBe(false);
    expect(isRoundGamesView(mapPlayers(value, (p) => ({ ...p, status: 'in-progress' })))).toBe(false);
  });

  it('requires a valid unavailable reason and null calculated fields instead of fabricated zeroes', () => {
    const value = view();
    for (const fields of [
      { unavailableReason: undefined }, { unavailableReason: 'unknown' }, { unavailableReason: 'missing-handicap-index' },
      { totalPoints: 0 }, { frontPoints: 0 }, { backPoints: 0 }, { holesScored: 1 }, { playingHandicap: 0 },
    ]) expect(isRoundGamesView(mapPlayers(value, (p) => ({ ...unavailable(p), ...fields })))).toBe(false);
    expect(isRoundGamesView(mapPlayers(value, (p) => ({
      ...unavailable(p), holes: p.holes.map((hole) => ({ ...hole, points: null, strokesReceived: 0 })),
    })))).toBe(false);
    const net = { ...value, configuration: { ...value.configuration, games: [game(1, { basis: 'net' })] } };
    for (const reason of ['missing-handicap-index', 'invalid-handicap-index', 'missing-tee-ratings', 'missing-stroke-index', 'missing-score-data']) {
      expect(isRoundGamesView(mapPlayers(net, (p) => ({ ...unavailable(p), unavailableReason: reason })))).toBe(true);
    }
  });

  it.each([25, -2, 0, 100])('checks signed net allocation and PH invariants for %s', (handicap) => {
    const value = view();
    const net = { ...value, configuration: { ...value.configuration, games: [game(1, { basis: 'net' })] } };
    const mapper = (p: GamePlayerResult): GamePlayerResult => ({
      ...p, playingHandicap: handicap, holes: p.holes.map((hole) => ({
        ...hole, strokesReceived: Math.floor(handicap / 18) + (hole.number <= (handicap % 18 + 18) % 18 ? 1 : 0),
      })),
    });
    expect(isRoundGamesView(mapPlayers(net, mapper))).toBe(true);
    for (const playingHandicap of [null, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isRoundGamesView(mapPlayers(net, (p) => ({ ...mapper(p), playingHandicap })))).toBe(false);
    }
    expect(isRoundGamesView(mapPlayers(net, (p) => ({
      ...mapper(p), holes: p.holes.map((hole) => ({ ...hole, strokesReceived: hole.number === 1 ? handicap : 0 })),
    })))).toBe(handicap === 0);
    expect(isRoundGamesView(mapPlayers(net, (p) => ({ ...mapper(p), playingHandicap: handicap + 1 })))).toBe(false);
  });

  it('pairs results exactly by configured game ID and enforces 4..8 unique golfers', () => {
    const value = view();
    const result = value.results[0];
    if (!result) throw new Error('Missing fictional result');
    for (const invalid of [
      null, {}, { ...value, results: null }, { ...value, results: [] },
      { ...value, results: [result, result] }, { ...value, results: [{ ...result, gameId: id(2) }] },
      { ...value, results: [{ ...result, players: result.players.slice(1) }] },
      { ...value, results: [{ ...result, players: [...result.players, ...result.players] }] },
      { ...value, results: [{ ...result, players: Array.from({ length: 9 }, (_, index) => player(index)) }] },
      { ...value, extra: true }, { ...value, results: [{ ...result, extra: true }] },
    ]) expect(isRoundGamesView(invalid)).toBe(false);
    expect(isRoundGamesView({ ...value, results: [{ ...result, players: Array.from({ length: 8 }, (_, index) => player(index)) }] })).toBe(true);
    expect(isRoundGamesView({ configuration: { ...value.configuration, games: [], etag: null }, results: [] })).toBe(true);
  });

  it('rejects cross-game player/hole-count/name/resolution mismatches without inventing raw scores', () => {
    const base = view();
    const players = [1, 2, 3, 4].map((number) => player(number));
    const value: RoundGamesView = { ...base,
      configuration: { ...base.configuration, games: [game(), game(2)] },
      results: [{ gameId: id(1), players }, { gameId: id(2), players }],
    };
    expect(isRoundGamesView(value)).toBe(true);
    expect(isRoundGamesView({ ...value, results: [...value.results].reverse() })).toBe(true);
    const second = (values: readonly GamePlayerResult[]) => ({
      ...value, results: [{ gameId: id(1), players }, { gameId: id(2), players: values }],
    });
    expect(isRoundGamesView(second([2, 3, 4, 5].map((number) => player(number))))).toBe(false);
    expect(isRoundGamesView(second(players.map((p) => ({ ...p, displayName: 'Different fictional name' }))))).toBe(false);
    expect(isRoundGamesView(second([1, 2, 3, 4].map((number) => player(number, 9))))).toBe(false);
    expect(isRoundGamesView(second(players.map((p) => ({ ...p, status: 'in-progress', holesScored: 0,
      frontPoints: null, backPoints: null, totalPoints: null, holes: p.holes.map((hole) => ({ ...hole, points: null })) }))))).toBe(false);
    expect(isRoundGamesView(second(players.map(unavailable)))).toBe(true);
    expect(isRoundGamesView({ ...base, results: [{ gameId: id(1), players: [...players.slice(0, 3), player(4, 9)] }] })).toBe(false);
  });
});
