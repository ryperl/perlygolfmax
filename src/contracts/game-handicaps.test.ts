import { describe, expect, it } from 'vitest';
import { calculateGameResults, stablefordPoints } from '../domain/stableford.js';
import type { RoundGameDefinition } from '../domain/games.js';
import type { RoundScores } from '../domain/scoring.js';
import { strokeGameFixture, strokeGameId, strokeGamesRound } from '../domain/stroke-games.test-support.js';
import { matchGamesFixture } from '../domain/match-games.test-support.js';
import { churchyV3Fixture } from '../domain/churchy-v3.test-support.js';
import { publishedCourseHandicaps } from '../domain/playing-handicaps.js';
import { isRoundGameDefinition } from './games.js';
import { decodeRoundScores, isRoundScores } from './scoring.js';
import { leanRoundScores } from './lean-round-scores.js';
import { gameHandicapRoundScores, GameHandicapClientUpdateRequired } from './game-handicaps.js';

function fixture(handicapRule: 'full-course-v1' | 'group-low-v1' = 'group-low-v1') {
  const f = strokeGameFixture(18), m = matchGamesFixture(), c = churchyV3Fixture(18, 1, 'tee');
  const snapshot = { ...f.snapshot, players: f.snapshot.players.map((player, index) => ({
    ...player, handicapIndex: { ...player.handicapIndex, value: ['+2', '4', '8', '3'][index] ?? '0' },
  })) };
  const games: readonly RoundGameDefinition[] = [
    { id: strokeGameId(980), name: 'Fictional net points', preset: 'standard', basis: 'net', points: stablefordPoints('standard'),
      handicapAllowancePercent: 95, handicapRule },
    { ...f.ballDrop, handicapRule },
    { ...f.skins, basis: 'net', handicapRule, carryOrder: 'shared-group-v1' as const },
    { id: strokeGameId(981), name: 'Fictional stroke', kind: 'stroke-play', basis: 'net', version: 1, handicapRule },
    { ...c.game, handicapRule, specials: [] },
    { ...m.wolf, basis: 'net', handicapRule },
    { ...m.wolf, id: strokeGameId(982), basis: 'net', version: 2 as const, stakeMinor: null, handicapRule },
    { ...m.nassau, basis: 'net', handicapRule, playOrder: 'shared-group-v1' as const },
    { ...m.nassau, id: strokeGameId(983), kind: 'match-play', basis: 'net', handicapRule,
      stakes: { ...m.nassau.stakes, frontMinor: 0, backMinor: 0 } },
  ];
  const peers = games.filter((game) => game.kind !== 'churchy');
  const round: RoundScores = { ...strokeGamesRound({ ...f, snapshot }),
    gameHandicapRules: 1, gameCalculationsVersion: 2, courseHandicaps: publishedCourseHandicaps(snapshot), teeStrokeAllocation: true,
    stringRulesVersion: 2, churchyCustomNames: true, churchyMurphyTargets: true, churchyPareeTargets: true,
    churchyEnabled: true, churchyRulesVersions: [1, 2, 3], wolfRulesVersions: [1, 2], internalGamesSupported: true,
    gameInputContext: { courseVersionId: snapshot.courseVersionId, teeProfileId: snapshot.teeProfile.id },
    games: { configuration: { eventId: strokeGameId(900), roundId: snapshot.id, etag: 'fictional-games', games: peers },
      results: calculateGameResults(peers, snapshot, f.cards) } };
  return { ...f, snapshot, games, round };
}

describe('explicit game handicap and circuit contracts', () => {
  it.each(['full-course-v1', 'group-low-v1'] as const)('strictly decodes full and lean %s results including plus CH', (rule) => {
    const { round, games, snapshot, cards } = fixture(rule);
    expect(games.every(isRoundGameDefinition)).toBe(true);
    expect(isRoundScores(round)).toBe(true);
    const wire = leanRoundScores(round, true, true, true, true, true, true, true, true, true, true);
    expect(decodeRoundScores(JSON.parse(JSON.stringify(wire)))).toEqual(round);
    expect(gameHandicapRoundScores(round, true)).toBe(round);
    expect(() => gameHandicapRoundScores(round)).toThrow(GameHandicapClientUpdateRequired);
    expect(() => leanRoundScores(round, true, true, true, true, true, true, true, true, false, true)).toThrow(GameHandicapClientUpdateRequired);
    for (const game of games) {
      const single = { ...round, games: { configuration: { eventId: round.eventId, roundId: round.roundId,
        etag: 'fictional-games', games: [game] }, results: calculateGameResults([game], snapshot, cards) } };
      expect(isRoundScores(single), game.kind ?? 'stableford').toBe(true);
      expect(decodeRoundScores(leanRoundScores(single, true, true, true, true, true, true, true, true, true, true))).toEqual(single);
    }
  });

  it('rejects unknown/null/undefined markers, gross off-low and standalone Dots net rules', () => {
    const { games } = fixture();
    for (const game of games) {
      for (const rule of [null, undefined, 'group-low-v2', 1]) {
        expect(isRoundGameDefinition({ ...game, handicapRule: rule })).toBe(false);
      }
      expect(isRoundGameDefinition({ ...game, basis: 'gross' })).toBe(false);
    }
    const dots = { id: strokeGameId(984), name: 'Fictional Dots', kind: 'dots', version: 1, mode: 'individual',
      groupNumber: 1, playerIds: fixture().snapshot.players.map((player) => player.playerId), stakeMinor: null, specials: [] };
    expect(isRoundGameDefinition(dots)).toBe(true);
    expect(isRoundGameDefinition({ ...dots, handicapRule: 'full-course-v1' })).toBe(false);
    expect(isRoundGameDefinition({ ...dots, handicapRule: 'group-low-v1' })).toBe(false);
  });

  it('binds the capability and captured group-low calculation, never accepting substituted full or missing CH', () => {
    const { round } = fixture(), games = round.games;
    if (!games) throw new Error('Missing fictional configured games');
    const withoutCapability = { ...round };
    delete withoutCapability.gameHandicapRules;
    expect(isRoundScores(withoutCapability)).toBe(false);
    expect(isRoundScores({ ...round, gameHandicapRules: 2 })).toBe(false);
    expect(isRoundScores({ ...round, courseHandicaps: undefined })).toBe(false);
    const result = games.results[0];
    if (!result) throw new Error('Missing fictional points result');
    const tampered = { ...round, games: { ...games, results: [{ ...result,
      players: result.players.map((player, index) => index ? player : { ...player, playingHandicap: 11 }) }, ...games.results.slice(1)] } };
    expect(isRoundScores(tampered)).toBe(false);
    expect(decodeRoundScores({ version: 1, kind: 'round-scores-lean', round: tampered })).toBeNull();
    const removed = { ...round, games: { ...games, configuration: { ...games.configuration,
      games: games.configuration.games.map((game) => {
        if (game.kind === 'dots') return game;
        const { handicapRule: _removed, ...legacy } = game;
        void _removed;
        return legacy;
      }) } } };
    expect(isRoundScores(removed)).toBe(false);
  });

  it('keeps old unmarked score definitions readable with no implied rule or capability', () => {
    const round = strokeGamesRound();
    expect(isRoundScores(round)).toBe(true);
    expect(gameHandicapRoundScores(round)).toEqual(round);
    expect(decodeRoundScores(leanRoundScores(round))).toEqual(round);
  });

  it('binds a new Skins omitted start to the first captured default-tee hole rather than the sorted result row', () => {
    const f = strokeGameFixture(9);
    const snapshot = { ...f.snapshot, teeProfile: { ...f.snapshot.teeProfile,
      holes: [...f.snapshot.teeProfile.holes.slice(6), ...f.snapshot.teeProfile.holes.slice(0, 6)] } };
    const game = { ...f.skins, carryOrder: 'shared-group-v1' as const };
    const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'strokes' as const, strokes: index === 0 && hole.number === 9 ? 3 : 4 },
    })) }));
    const base = strokeGamesRound({ ...f, snapshot, cards });
    const round = { ...base, gameHandicapRules: 1 as const, games: { configuration: {
      eventId: base.eventId, roundId: base.roundId, etag: 'fictional-games', games: [game],
    }, results: calculateGameResults([game], snapshot, cards) } };
    expect(round.games.results[0]?.players[0]?.strokeGame?.holes[8]?.value).toBe(3);
    expect(isRoundScores(round)).toBe(true);
    expect(decodeRoundScores(leanRoundScores(round, false, false, false, false, false, false, false, false, true))).toEqual(round);
  });
});
