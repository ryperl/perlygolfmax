import { describe, expect, it } from 'vitest';
import type { DotsGameDefinition } from '../domain/dots.js';
import { sameGameDefinitions } from '../domain/games.js';
import { leanScoresFixture } from './lean-round-scores.test-support.js';
import { DotsRulesV3ClientUpdateRequired, dotsRulesV3RoundScores, requireDotsRulesV3, requireDotsRulesV3InValue } from './dots-rules-v3.js';
import { isRoundScores } from './scoring.js';
import { calculateInternalGameResults } from '../domain/internal-games.js';
import { supportsDotsGameRules } from '../domain/scoring.js';
import { isDotAward, isDotAwardAudit } from './dot-audit.js';

const ids = Array.from({ length: 4 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
const game: DotsGameDefinition = {
  id: '00000000-0000-4000-8000-000000000005', name: 'Fictional rotating game', kind: 'dots',
  version: 3, mode: 'rotating', orderMode: 'approach', rotationHoles: 6,
  groupNumber: 1, playerIds: ids, stakeMinor: 100, specials: [],
  highLow: { version: 2, handicapRule: 'group-low-v1' },
};

describe('composite rotating Dots v3 compatibility', () => {
  it('shares preflight for legacy, v2 opt-in High/Low and the composite v3 bundle', () => {
    const round = leanScoresFixture();
    const legacy: DotsGameDefinition = { id: game.id, name: game.name, kind: 'dots', version: 1, mode: 'individual',
      groupNumber: 1, playerIds: ids, specials: [], stakeMinor: null };
    const v2: DotsGameDefinition = { ...legacy, version: 2, mode: 'rotating', rotationHoles: 6 };
    const highLow: DotsGameDefinition = { ...v2, rotationHoles: 3, highLow: { version: 1, handicapRule: 'group-low-v1' } };
    expect(supportsDotsGameRules(round, legacy)).toBe(true);
    expect(supportsDotsGameRules(round, v2)).toBe(true);
    expect(supportsDotsGameRules({ ...round, dotsRulesVersions: [] }, v2)).toBe(false);
    expect(supportsDotsGameRules(round, highLow)).toBe(false);
    for (const version of [1, 2] as const) expect(supportsDotsGameRules({ ...round, dotsHighLowVersion: version }, highLow)).toBe(true);
    const { highLow: omitted, ...specialsOnly } = game;
    expect(omitted?.version).toBe(2);
    for (const definition of [game, specialsOnly]) {
      expect(supportsDotsGameRules({ ...round, dotsHighLowVersion: 2 }, definition)).toBe(false);
      expect(supportsDotsGameRules({ ...round, dotsRulesVersions: [1, 2, 3], dotsHighLowVersion: 1 }, definition)).toBe(false);
      expect(supportsDotsGameRules({ ...round, dotsRulesVersions: [1, 2, 3], dotsHighLowVersion: 2 }, definition)).toBe(true);
    }
  });
  it('rejects affected definitions and nested fragments before publication unless explicitly supported', () => {
    expect(() => { requireDotsRulesV3([game], false); }).toThrow(DotsRulesV3ClientUpdateRequired);
    for (const value of [game, { publication: { games: [game] } },
      { highLow: { version: 2, handicapRule: 'full-course-v1' } }]) {
      expect(() => { requireDotsRulesV3InValue(value); }).toThrow(DotsRulesV3ClientUpdateRequired);
      expect(() => { requireDotsRulesV3InValue(value, true); }).not.toThrow();
    }
    try {
      requireDotsRulesV3([game], false);
      throw new Error('Expected compatibility rejection');
    } catch (error) {
      expect(error).toMatchObject({ status: 426, code: 'DOTS_RULES_V3_CLIENT_UPDATE_REQUIRED' });
    }
    expect(() => { requireDotsRulesV3([game], true); }).not.toThrow();
  });

  it('preserves unaffected legacy definitions while pruning only newly advertised metadata', () => {
    const saved = leanScoresFixture();
    const round = { ...saved, dotsRulesVersions: [1, 2, 3] as const, dotsHighLowVersion: 2 as const };
    const projected = dotsRulesV3RoundScores(round);
    expect(projected).toEqual({ ...round, dotsRulesVersions: [1, 2], dotsHighLowVersion: 1 });
    expect(round.dotsRulesVersions).toEqual([1, 2, 3]);
    expect(dotsRulesV3RoundScores(round, true)).toBe(round);
    const legacy: DotsGameDefinition = { id: game.id, name: game.name, kind: 'dots', groupNumber: game.groupNumber,
      playerIds: ids, specials: [], stakeMinor: 100, mode: 'rotating', version: 2, rotationHoles: 3,
      highLow: { version: 1, handicapRule: 'group-low-v1' } };
    expect(() => { requireDotsRulesV3([legacy], false); }).not.toThrow();
    expect(() => { requireDotsRulesV3InValue({ nested: legacy }); }).not.toThrow();
    expect(() => { requireDotsRulesV3InValue({ dotsHighLowVersion: 2, dotsRulesVersions: [3] }); }).not.toThrow();
    const differentMode: DotsGameDefinition = { ...game, orderMode: 'tee-flip' };
    expect(sameGameDefinitions([game], [differentMode])).toBe(false);
    expect(sameGameDefinitions([game], [legacy])).toBe(false);
  });

  it('requires coherent v3 capabilities and validates received base Sweep evidence against saved scores', () => {
    const saved = leanScoresFixture();
    const etag = 'fictional-v3-game';
    const cards = saved.cards.map((card, index) => ({ ...card,
      holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'strokes' as const, strokes: index < 2 ? 3 : 6,
        ...(index === 0 && hole.number === 1 ? { dots: [{
          number: 1, gameId: game.id, gameEtag: etag, players: [], contests: [], rotation: { playerIds: ids },
        }] } : {}),
      } })) }));
    const zero = ids.map((playerId) => ({ playerId, courseHandicap: 0 }));
    const context = { ...saved, cards, courseHandicaps: zero, groups: [{ number: 1, playerIds: ids }] };
    const games = { configuration: { eventId: saved.eventId, roundId: saved.roundId, etag, games: [game] },
      results: [...calculateInternalGameResults([game], context).values()] };
    const round = { ...context, games, dotsRulesVersions: [1, 2, 3] as const, dotsHighLowVersion: 2 as const };
    delete round.internalSettlements;
    expect(isRoundScores(round)).toBe(true);
    expect(isRoundScores({ ...round, dotsHighLowVersion: 1 })).toBe(false);
    expect(isRoundScores({ ...round, dotsRulesVersions: [1, 2] })).toBe(false);
    expect(() => dotsRulesV3RoundScores(round)).toThrow(DotsRulesV3ClientUpdateRequired);
    const { highLow: configuredBase, ...specialsOnly } = game;
    expect(configuredBase?.version).toBe(2);
    const noBase = { ...round, games: {
      configuration: { ...games.configuration, games: [specialsOnly] },
      results: [...calculateInternalGameResults([specialsOnly], context).values()],
    } };
    expect(isRoundScores(noBase)).toBe(true);
    expect(isRoundScores({ ...noBase, dotsHighLowVersion: 1 })).toBe(false);
    const result = games.results[0];
    if (!result?.dotsHighLow) throw new Error('Missing fictional net result');
    expect(result.dotsHighLow.awards.every(isDotAward)).toBe(true);
    expect(isDotAwardAudit({ gameId: game.id, kind: 'dots', version: 3, configuration: game,
      gameEtag: etag, inputRevision: null, before: [], after: result.dotsHighLow.awards })).toBe(true);
    expect(isRoundScores({ ...round, games: { ...games, results: [{
      ...result, dotsHighLow: { ...result.dotsHighLow, awards: [...result.dotsHighLow.awards, {
        ...result.dotsHighLow.awards[0], kind: 'high-low-sweep', dots: 2,
      }] },
    }] } })).toBe(false);
  });
});
