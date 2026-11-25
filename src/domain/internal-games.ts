import type { RoundGameDefinition, RoundGameResult } from './games.js';
import { calculateNinesSettlement } from './nines.js';
import type { DotsGameDefinition, DotsResults } from './dots.js';
import { calculateDots } from './dots.js';
import { calculateWolf } from './wolf.js';
import { dotsInputFromScores, dotsRecordsFor, wolfInputFromScores, wolfRecordsFor, wolfResultPlayers } from './game-declarations.js';
import type { RoundGameScoringContext } from './game-declarations.js';
import { calculateDotSettlement } from './dot-settlement.js';
import type { InternalGameSettlement } from './dot-settlement.js';
import type { DotPrefixPoints } from './dot-context.js';
import { groupStartingHole } from './round-navigation.js';
import { calculateDotsHighLow, combinedDotsPlayers } from './dots-high-low.js';

export function hasConflictingSweep(games: readonly RoundGameDefinition[], wolfId: string): boolean {
  return games.some((game) => game.kind === 'wolf' && game.id === wolfId && game.highLowSweep === true)
    && games.some((game) => game.kind === 'dots' && game.mode === 'linked' && game.linkedGameId === wolfId
      && game.sweepRule === undefined && game.specials.some((special) => special.kind === 'sweep'));
}
function prefixPoints(game: DotsGameDefinition, result: DotsResults, context: RoundGameScoringContext): readonly DotPrefixPoints[] {
  const layout = [...context.layout].sort((a, b) => a.number - b.number);
  const start = groupStartingHole(context.groups.find((group) => group.number === game.groupNumber), layout);
  const offset = layout.findIndex((hole) => hole.number === start);
  const prefix = [...layout.slice(offset), ...layout.slice(0, offset)].slice(0, -2);
  return game.playerIds.map((playerId) => {
    let sum = 0n;
    for (const hole of prefix) {
      const saved = result.holes.find((entry) => entry.number === hole.number);
      const points = saved?.points.find((entry) => entry.playerId === playerId)?.dots;
      if (saved?.status !== 'complete' || points === undefined || points === null || !Number.isSafeInteger(points)) return { playerId, dots: null };
      sum += BigInt(points);
    }
    return { playerId, dots: sum <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(sum) : null };
  });
}

/** Optional composition only: neither rules engine depends on the other game. */
export function calculateInternalGameResults(
  games: readonly RoundGameDefinition[], context: RoundGameScoringContext,
): ReadonlyMap<string, RoundGameResult> {
  const output = new Map<string, RoundGameResult>();
  const round = dotsInputFromScores(context);
  for (const game of games) {
    if (game.kind !== 'wolf') continue;
    const linked = games.filter((candidate): candidate is DotsGameDefinition =>
      candidate.kind === 'dots' && candidate.mode === 'linked' && candidate.linkedGameId === game.id);
    const input = wolfInputFromScores(context);
    const records = wolfRecordsFor(game, context.groups, context.cards);
    if (hasConflictingSweep(games, game.id)) {
      const unavailable = calculateWolf(game, { ...input, groups: [] }, context.cards, records);
      const reason = 'conflicting-sweep-configuration' as const;
      const wolf = { ...unavailable, reason, holes: unavailable.holes.map((hole) => ({ ...hole, reason })),
        ...(unavailable.comeback ? { comeback: { ...unavailable.comeback, reason } } : {}) };
      output.set(game.id, { gameId: game.id, kind: 'wolf', version: game.version, wolf, players: wolfResultPlayers(wolf) });
      continue;
    }
    let wolf = calculateWolf(game, { ...input, ...(linked.length ? { comebackRequired: true } : {}) }, context.cards, records);
    const dots = linked[0];
    if (game.version === 2 && dots && linked.length === 1 && dots.groupNumber === game.groupNumber
      && dots.playerIds.length === game.playerIds.length && dots.playerIds.every((id) => game.playerIds.includes(id))) {
      const preliminary = calculateDots(dots, round, dotsRecordsFor(dots, context.groups, context.cards), wolf.contexts);
      wolf = calculateWolf(game, { ...input, comebackRequired: true, comebackPoints: prefixPoints(dots, preliminary, context) }, context.cards, records);
    }
    output.set(game.id, { gameId: game.id, kind: 'wolf', version: game.version, wolf, players: wolfResultPlayers(wolf) });
  }
  for (const game of games) {
    if (game.kind !== 'dots') continue;
    const linked = game.mode === 'linked' ? games.find((candidate) => candidate.id === game.linkedGameId) : undefined;
    const compatible = linked?.kind === 'wolf' && linked.version === 2 && linked.groupNumber === game.groupNumber
      && linked.playerIds.length === game.playerIds.length && linked.playerIds.every((id) => game.playerIds.includes(id))
      && games.filter((candidate) => candidate.kind === 'dots' && candidate.mode === 'linked'
        && candidate.linkedGameId === linked.id).length === 1 && !hasConflictingSweep(games, linked.id);
    const contexts = game.mode !== 'linked' ? undefined : compatible ? output.get(linked.id)?.wolf?.contexts
      : context.layout.map((hole) => ({ number: hole.number, status: 'unavailable' as const, sides: [],
        multiplier: 1 as const, reason: 'Linked game is missing, incompatible or duplicated.' }));
    const dots = calculateDots(game, round, dotsRecordsFor(game, context.groups, context.cards), contexts);
    const highLow = game.highLow ? calculateDotsHighLow(game, context, dotsRecordsFor(game, context.groups, context.cards)) : undefined;
    output.set(game.id, { gameId: game.id, kind: 'dots', version: game.version, dots,
      players: highLow ? combinedDotsPlayers(dots, highLow) : dots.players, ...(highLow ? { dotsHighLow: highLow } : {}) });
  }
  return output;
}

export function calculateInternalSettlements(
  games: readonly RoundGameDefinition[], results: readonly RoundGameResult[], context: RoundGameScoringContext,
): readonly InternalGameSettlement[] {
  const settlements: InternalGameSettlement[] = [];
  for (const game of games) {
    if (game.kind === 'nines') {
      const result = results.find((entry) => entry.gameId === game.id);
      const name = (playerId: string) => context.cards.find((card) => card.playerId === playerId)?.displayName ?? 'Golfer unavailable';
      settlements.push(calculateNinesSettlement(game, result, name));
      continue;
    }
    if (game.kind !== 'wolf' && game.kind !== 'dots' || game.kind === 'wolf' && game.version !== 2
      || game.kind === 'dots' && game.mode === 'linked') continue;
    const linked = game.kind === 'wolf' ? games.filter((candidate): candidate is DotsGameDefinition =>
      candidate.kind === 'dots' && candidate.mode === 'linked' && candidate.linkedGameId === game.id) : [];
    const dots = game.kind === 'dots' ? game : linked[0];
    const base = game.kind === 'wolf' ? results.find((result) => result.gameId === game.id) : undefined;
    const special = dots ? results.find((result) => result.gameId === dots.id) : undefined;
    const sourceResults = [...(base ? [base] : []), ...(special ? [special] : [])];
    const ids = [game.id, ...linked.map((entry) => entry.id)];
    settlements.push(calculateDotSettlement({ groupNumber: game.groupNumber, gameIds: ids, stakeMinor: game.stakeMinor ?? null,
      complete: sourceResults.length === ids.length && sourceResults.every((result) =>
        (result.dots?.status === 'complete' || result.wolf?.status === 'complete')
        && (!result.dotsHighLow || result.dotsHighLow.status === 'complete')),
      unavailable: linked.length > 1 || sourceResults.length !== ids.length
        || sourceResults.some((result) => result.dots?.status === 'unavailable' || result.wolf?.status === 'unavailable'
          || result.dotsHighLow?.status === 'unavailable' || result.players.some((player) => player.status === 'unavailable')),
      players: game.playerIds.map((playerId) => ({ playerId,
        displayName: context.cards.find((card) => card.playerId === playerId)?.displayName ?? 'Golfer unavailable',
        baseDots: game.kind === 'wolf' ? base?.players.find((player) => player.playerId === playerId)?.totalPoints ?? null
          : special?.dotsHighLow ? special.dotsHighLow.players.find((player) => player.playerId === playerId)?.totalPoints ?? null : 0,
        specialDots: dots ? special?.dots?.players.find((player) => player.playerId === playerId)?.totalPoints ?? null : 0 })) }));
  }
  return settlements;
}
