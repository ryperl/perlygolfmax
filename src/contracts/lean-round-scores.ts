import type { RoundScores, ScoreWriteResult } from '../domain/scoring.js';
import type { RoundGameScoringContext } from '../domain/game-declarations.js';
import { calculateInternalGameResults } from '../domain/internal-games.js';
import { calculateChurchyResults } from '../domain/churchy.js';
import { isRecord } from './events.js';
import { isGameConfiguration } from './games.js';
import type { WolfGameDefinition, WolfResults } from '../domain/wolf.js';
import { wolfRecordsFor } from '../domain/game-declarations.js';
import { sameJsonValue } from './round-context.js';
import { murphyRoundScores, murphyScoreChange } from '../domain/murphy-transport.js';
import { stringRoundScores } from './string-rules.js';
import { categorySweepRoundScores } from './category-sweeps.js';
import { churchyNamesRoundScores } from './churchy-names.js';
import { sweepRulesRoundScores, requireSweepRulesInValue } from './sweep-rules.js';
import { coexistenceRoundScores } from './dot-coexistence.js';

function without(value: object, ...keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => !keys.includes(name)));
}

function leanWolf(value: WolfResults, game: WolfGameDefinition | undefined, round: RoundScores) {
  const comeback = value.comeback;
  const saved = comeback?.status === 'saved' && comeback.receipt && game
    ? wolfRecordsFor(game, round.groups, round.cards).find((record) => sameJsonValue(record.comeback, comeback.receipt))
    : undefined;
  return { ...without(value, 'awards', 'players', 'contexts'),
    // Available pre-write proofs stay inline; only an identical canonical saved receipt is referenced.
    ...(saved ? { comeback: { ...comeback, receipt: { savedHole: saved.number } } } : {}) };
}

/** Omit evidence and duplicate derived views, never captured inputs or canonical write receipts. */
export function leanRoundScores(input: RoundScores, murphyTargets = false, pareeTargets = false, stringRules = false, dotsCalls = false, categorySweeps = false, churchyNames = false, sweepRules = false, dotCoexistence = false) {
  const round = coexistenceRoundScores(sweepRulesRoundScores(churchyNamesRoundScores(categorySweepRoundScores(stringRoundScores(murphyRoundScores(input, murphyTargets, pareeTargets, dotsCalls), stringRules), categorySweeps), churchyNames), sweepRules), dotCoexistence);
  const games = round.games;
  return {
    version: 1, kind: 'round-scores-lean', round: {
      ...round,
      ...(games ? { games: {
        configuration: games.configuration,
        results: games.results.map((result) => ({
          ...result,
          ...(result.dots ? { dots: { ...without(result.dots, 'awards', 'players'),
            holes: result.dots.holes.map((hole) => without(hole, 'awards')) } } : {}),
          ...(result.wolf?.rulesVersion === 2 ? { wolf: leanWolf(result.wolf,
            games.configuration.games.find((game): game is WolfGameDefinition => game.kind === 'wolf' && game.id === result.gameId), round) } : {}),
          ...(result.churchy ? { churchy: { ...without(result.churchy, 'awards'),
            holes: result.churchy.holes.map((hole) => without(hole, 'specials')) } } : {}),
        })),
      } } : {}),
    },
  };
}

export function leanScoreWriteResult(value: ScoreWriteResult, murphyTargets = false, pareeTargets = false, stringRules = false, dotsCalls = false, categorySweeps = false, churchyNames = false, sweepRules = false, dotCoexistence = false) {
  if (!sweepRules) requireSweepRulesInValue(value.change);
  return { round: leanRoundScores(value.round, murphyTargets, pareeTargets, stringRules, dotsCalls, categorySweeps, churchyNames, sweepRules, dotCoexistence),
    change: without(murphyScoreChange(value.change, murphyTargets, value.round, pareeTargets, dotsCalls), 'dotAwardAudit') };
}

/**
 * Restore omitted evidence/duplicates after the enclosing round's inputs pass validation.
 * The ordinary full validator still checks every transmitted numerical/result field.
 */
export function restoreLeanRoundGames(value: unknown, context: RoundGameScoringContext): unknown {
  if (!isRecord(value) || !isGameConfiguration(value.configuration) || !Array.isArray(value.results)) return null;
  const configuration = value.configuration;
  const internal = calculateInternalGameResults(configuration.games, context);
  const results: unknown[] = [];
  for (const result of value.results) {
    if (!isRecord(result)) return null;
    const game = configuration.games.find((entry) => entry.id === result.gameId);
    if (game?.kind === 'dots') {
      const expected = internal.get(game.id)?.dots;
      if (!expected || !isRecord(result.dots) || Object.hasOwn(result.dots, 'awards') || !Array.isArray(result.dots.holes)) return null;
      const holes: unknown[] = [];
      for (const hole of result.dots.holes) {
        if (!isRecord(hole) || Object.hasOwn(hole, 'awards')) return null;
        holes.push({ ...hole, awards: expected.holes.find((entry) => entry.number === hole.number)?.awards });
      }
      results.push({ ...result, dots: { ...result.dots, awards: expected.awards, holes,
        players: Object.hasOwn(result.dots, 'players') ? result.dots.players : result.players } });
    } else if (game?.kind === 'wolf' && game.version === 2) {
      const expected = internal.get(game.id)?.wolf;
      if (!expected || !isRecord(result.wolf) || Object.hasOwn(result.wolf, 'awards')) return null;
      let comeback = result.wolf.comeback;
      if (isRecord(comeback) && isRecord(comeback.receipt) && Object.hasOwn(comeback.receipt, 'savedHole')) {
        const reference = comeback.receipt;
        if (comeback.status !== 'saved' || Object.keys(reference).length !== 1) return null;
        const saved = wolfRecordsFor(game, context.groups, context.cards)
          .find((record) => record.number === reference.savedHole);
        if (!saved?.comeback) return null;
        comeback = { ...comeback, receipt: saved.comeback };
      }
      results.push({ ...result, wolf: { ...result.wolf, awards: expected.awards,
        players: Object.hasOwn(result.wolf, 'players') ? result.wolf.players : expected.players,
        contexts: Object.hasOwn(result.wolf, 'contexts') ? result.wolf.contexts : expected.contexts,
        ...(comeback === undefined ? {} : { comeback }) } });
    } else if (game?.kind === 'churchy') {
      if (!isRecord(result.churchy) || !Array.isArray(result.churchy.holes)) return null;
      const group = context.groups.find((entry) => entry.number === game.groupNumber);
      const expected = calculateChurchyResults(game, context.cards.map((card) => {
        const published = context.courseHandicaps?.find((entry) => entry.playerId === card.playerId);
        const personal = context.playerTees?.find((entry) => entry.playerId === card.playerId)?.profile;
        return { playerId: card.playerId, displayName: card.displayName, layout: personal?.holes ?? context.layout,
          handicap: !(personal?.strokeAllocation ?? context.teeStrokeAllocation)
            ? 'missing-stroke-index' : published?.courseHandicap ?? 'missing-handicap-index' };
      }), context.cards, group?.playerIds.length === 4 && group.playerIds.every((id) => game.playerIds.includes(id)),
      context.groups, context.layout, context.stringRulesVersion);
      const holes: unknown[] = [];
      for (const hole of result.churchy.holes) {
        if (!isRecord(hole) || Object.hasOwn(hole, 'specials')) return null;
        holes.push({ ...hole, specials: expected.churchy?.holes.find((entry) => entry.number === hole.number)?.specials });
      }
      if (game.version === 3 && Object.hasOwn(result.churchy, 'awards')) return null;
      results.push({ ...result, churchy: { ...result.churchy, holes,
        ...(game.version === 3 ? { awards: expected.churchy?.awards } : {}) } });
    } else results.push(result);
  }
  return { ...value, results };
}
