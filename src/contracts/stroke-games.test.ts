import { describe, expect, it } from 'vitest';
import { ballDropFormat, strokeGameCards, strokeGameFixture, strokeGamesRound } from '../domain/stroke-games.test-support.js';
import { calculateGameResults } from '../domain/stableford.js';
import { isRoundGameDefinition, isRoundGamesView } from './games.js';
import { isRoundScores } from './scoring.js';
import { isStrokeGameResult } from './stroke-games.js';

const malformedStrings: readonly { readonly name: string; readonly value: unknown }[] = [
  { name: 'null', value: null },
  { name: 'number', value: 42 },
  { name: 'object', value: {} },
  { name: 'non-callable toString', value: { toString: 42 } },
  { name: 'nested non-callable toString', value: { toString: { toString: 42 } } },
];

describe('versioned stroke game wire contracts', () => {
  it.each(malformedStrings)('rejects $name stroke-hole and player statuses without throwing', ({ value }) => {
    const f = strokeGameFixture();
    for (const game of [f.ballDrop, f.skins]) {
      const result = calculateGameResults([game], f.snapshot, f.cards)[0];
      if (!result) throw new Error('Missing fictional stroke result');
      for (const target of ['hole', 'player'] as const) {
        const candidate = { ...result, players: result.players.map((player, index) => {
          if (index) return player;
          if (target === 'player') return { ...player, status: value };
          if (!player.strokeGame) throw new Error('Missing fictional stroke holes');
          return { ...player, strokeGame: { ...player.strokeGame, holes: player.strokeGame.holes.map((hole, holeIndex) =>
            holeIndex ? hole : { ...hole, status: value }) } };
        }) };
        expect(() => isStrokeGameResult(candidate, game)).not.toThrow();
        expect(isStrokeGameResult(candidate, game)).toBe(false);
      }
    }
  });

  it.each(malformedStrings)('rejects $name player and stroke-game unavailable reasons without coercion or throwing', ({ value }) => {
    const f = strokeGameFixture();
    for (const game of [f.ballDrop, f.skins]) {
      const result = calculateGameResults([game], f.snapshot, f.cards)[0];
      if (!result) throw new Error('Missing fictional stroke result');
      for (const target of ['stroke-game', 'player'] as const) {
        const candidate = { ...result, players: result.players.map((player, index) => index ? player
          : target === 'player' ? { ...player, unavailableReason: value }
            : { ...player, strokeGame: { ...player.strokeGame, unavailableReason: value } }) };
        expect(() => isStrokeGameResult(candidate, game)).not.toThrow();
        expect(isStrokeGameResult(candidate, game)).toBe(false);
      }
    }
  });

  it('accepts all new definitions/results with honest units and legacy Stableford alongside them', () => {
    const f = strokeGameFixture();
    for (const format of ['ball-drop-net-gross', 'ball-drop-two-net', 'ball-drop-two-gross'] as const) {
      const round = strokeGamesRound({ ...f, ballDrop: ballDropFormat(f.ballDrop, format) });
      expect(isRoundGameDefinition(round.games?.configuration.games[0])).toBe(true);
      expect(isRoundGamesView(round.games)).toBe(true);
      expect(isRoundScores(round)).toBe(true);
    }
    for (const basis of ['gross', 'net'] as const) for (const carryovers of [false, true]) {
      expect(isRoundScores(strokeGamesRound({ ...f, skins: { ...f.skins, basis, carryovers } }))).toBe(true);
    }
  });

  it('rejects Stableford fields, configurable allowances, unsupported versions/formats, and duplicate golfers', () => {
    const f = strokeGameFixture();
    for (const game of [f.ballDrop, f.skins]) for (const patch of [
      { version: 2 }, { handicapAllowancePercent: 95 }, { points: {} }, { preset: 'standard' }, { unknown: true },
    ]) expect(isRoundGameDefinition({ ...game, ...patch })).toBe(false);
    expect(isRoundGameDefinition({ ...f.ballDrop, format: 'four-two-net' })).toBe(false);
    expect(isRoundGameDefinition({ ...f.ballDrop, basis: 'gross' })).toBe(false);
    expect(isRoundGameDefinition({ ...f.skins, carryovers: 'yes' })).toBe(false);
    expect(isRoundGameDefinition({ ...f.ballDrop, teams: f.ballDrop.teams.map((team) => ({
      ...team, playerIds: [team.playerIds[0], team.playerIds[0], ...team.playerIds.slice(2)],
    })) })).toBe(false);
  });

  it('rederives awards, team selection, totals and unclaimed skins instead of trusting forged server fields', () => {
    const round = strokeGamesRound();
    const view = round.games;
    if (!view) throw new Error('Missing fictional games');
    const result = view.results[1];
    if (!result) throw new Error('Missing fictional result');
    for (const patch of [{ unawardedSkins: 0 }, { pendingSkins: 9 }, { version: 2 }, { teams: [] }, { extra: true }]) {
      expect(isRoundGamesView({ ...view, results: [view.results[0], { ...result, ...patch }] })).toBe(false);
    }
    const players = result.players.map((player, index) => index ? player : ({
      ...player, strokeGame: { ...player.strokeGame, total: 1 },
    }));
    expect(isRoundGamesView({ ...view, results: [view.results[0], { ...result, players }] })).toBe(false);
    const team = view.results[0];
    expect(isRoundGamesView({ ...view, results: [{ ...team, teams: team?.teams?.map((entry) => ({
      ...entry, strokeGame: { ...entry.strokeGame, holes: entry.strokeGame?.holes.map((hole) => ({
        ...hole, countingPlayerIds: [entry.playerIds[0], entry.playerIds[0]],
      })) },
    })) }, result] })).toBe(false);
    const cards = strokeGameCards(round.cards, 1, [{ kind: 'strokes', strokes: 3 }]);
    expect(isRoundScores({ ...round, cards })).toBe(false);
  });

  it('accepts pending earlier holes, picked-up/DNF, missing net data, and stale team repair projections', () => {
    const f = strokeGameFixture();
    const cards = strokeGameCards(f.cards, 1, [{ kind: 'unplayed' }, { kind: 'picked-up', reportedStrokes: 7 },
      { kind: 'did-not-finish' }, { kind: 'strokes', strokes: 3 }]);
    expect(isRoundScores(strokeGamesRound({ ...f, cards }))).toBe(true);
    const snapshot = { ...f.snapshot, players: f.snapshot.players.map((player, index) => index ? player : { ...player, handicapIndex: null }) };
    const missing = strokeGamesRound({ ...f, snapshot, skins: { ...f.skins, basis: 'net' } });
    expect(isRoundScores(missing)).toBe(true);
    const stale = { ...f.snapshot, players: f.snapshot.players.slice(1) };
    const games = { ...missing.games, results: calculateGameResults([f.ballDrop, f.skins], stale, f.cards) };
    expect(isRoundGamesView({ ...games, configuration: { ...missing.games?.configuration, games: [f.ballDrop, f.skins] } })).toBe(true);
  });
});
