import type { ChurchyGameDefinitionV3, ChurchyHoleReceipt, ChurchyLane, ChurchyPlayerInput, ChurchySpecialsV3 } from './churchy.js';
import { calculateChurchyInternalSettlement } from './churchy.js';
import { calculateDots, dotsDeclarationIssues, dotsDefinitionMatchesRound, dotsRecordsMatchGame, dotsSpecialCatalog } from './dots.js';
import type { DotsGameDefinition, DotsHoleRecord, DotsRotationContext } from './dots.js';
import type { DotAward, DotRoundInput } from './dot-context.js';
import type { GamePlayerResult, RoundGameResult } from './games.js';
import type { RoundGroup } from './setup.js';
import type { Scorecard } from './scoring.js';
import { handicapStrokesForHole } from './stableford.js';
import type { CourseHole } from './catalog.js';

/** An internal adapter consumes neutral pairs/High/Low, not a persisted linked game. */
export function churchyDotsDefinition(game: ChurchyGameDefinitionV3): DotsGameDefinition {
  return { id: game.id, name: game.name, kind: 'dots', version: 1, mode: 'linked',
    linkedGameId: game.id, groupNumber: game.groupNumber, playerIds: game.playerIds, specials: game.specials };
}

export function churchyV3Records(game: ChurchyGameDefinitionV3, groups: readonly RoundGroup[],
  cards: readonly Scorecard[]): readonly ChurchySpecialsV3[] {
  const anchor = groups.find((group) => group.number === game.groupNumber)?.playerIds[0];
  return cards.find((card) => card.playerId === anchor)?.holes.flatMap((hole) => {
    const record = hole.score.churchy;
    return record?.version === 3 && record.gameId === game.id ? [record] : [];
  }) ?? [];
}

export function churchyV3Context(game: ChurchyGameDefinitionV3, round: DotRoundInput,
  records: readonly ChurchySpecialsV3[] = churchyV3Records(game, round.groups, round.cards)): DotsRotationContext {
  const group = round.groups.find((entry) => entry.number === game.groupNumber);
  const numbers = [...round.layout].sort((a, b) => a.number - b.number).map((hole) => hole.number);
  const firstHole = group?.startingHole ?? numbers[0] ?? null;
  const start = firstHole === null ? -1 : numbers.indexOf(firstHole);
  const circuit = start < 0 ? numbers : [...numbers.slice(start), ...numbers.slice(0, start)];
  const receipts = records.filter((record) => record.rotation !== undefined);
  const receipt = receipts[0];
  const rotation = game.orderMode === 'tee' ? { playerIds: game.playerIds } : receipt?.rotation;
  const valid = start >= 0 && dotsDefinitionMatchesRound(churchyDotsDefinition(game), round)
    && (game.orderMode === 'tee' ? receipts.length === 0 : receipts.length <= 1)
    && (game.orderMode === 'tee' || !rotation || receipt?.number === firstHole
      && rotation.playerIds.length === 4 && new Set(rotation.playerIds).size === 4
      && rotation.playerIds.every((id) => game.playerIds.includes(id)));
  return { firstHole, ...(rotation ? { rotation } : {}), contexts: circuit.map((number, index) => {
    const common = { number, multiplier: 1 as const, sourceGameId: game.id };
    if (!valid) return { ...common, status: 'unavailable' as const, sides: [], reason: 'invalid-churcie-order' };
    if (!rotation) return { ...common, status: 'pending' as const, sides: [], reason: 'missing-churcie-order' };
    const [a, b, c, d] = rotation.playerIds;
    if (!a || !b || !c || !d) return { ...common, status: 'unavailable' as const, sides: [], reason: 'invalid-churcie-order' };
    const block = Math.floor(index / 3) % 3;
    return { ...common, status: 'ready' as const,
      sides: block === 0 ? [[a, d], [b, c]] : block === 1 ? [[a, c], [b, d]] : [[a, b], [c, d]] };
  }) };
}

function dotRecords(records: readonly ChurchySpecialsV3[]): readonly DotsHoleRecord[] {
  return records.map(({ number, gameId, gameEtag, players, contests }) => ({ number, gameId, gameEtag, players, contests }));
}

export function churchyV3RecordsMatchGame(records: readonly ChurchySpecialsV3[], game: ChurchyGameDefinitionV3,
  round: DotRoundInput): boolean {
  return !churchyV3Context(game, round, records).contexts.some((entry) => entry.status === 'unavailable')
    && records.every((record) => record.players.every((player) => dotsDeclarationIssues(player).conflicts.length === 0))
    && dotsRecordsMatchGame(dotRecords(records), churchyDotsDefinition(game), round);
}

const sum = (values: readonly number[]) => {
  const value = values.reduce((total, entry) => total + BigInt(entry), 0n);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
};

export function calculateChurchyV3Results(game: ChurchyGameDefinitionV3, inputs: readonly ChurchyPlayerInput[],
  cards: readonly Scorecard[], groups: readonly RoundGroup[], defaultLayout: readonly CourseHole[],
  groupValid: boolean, stringRulesVersion: 1 | 2 = 2): RoundGameResult {
  const round: DotRoundInput = { groups, cards, layout: defaultLayout, stringRulesVersion,
    playerLayouts: inputs.map((input) => ({ playerId: input.playerId, layout: input.layout })) };
  const records = churchyV3Records(game, groups, cards);
  const rotation = churchyV3Context(game, round, records);
  const validRecords = churchyV3RecordsMatchGame(records, game, round);
  const selected = game.playerIds.map((id) => inputs.find((entry) => entry.playerId === id));
  const handicaps = selected.flatMap((input) => input && typeof input.handicap === 'number' && Number.isSafeInteger(input.handicap)
    && input.layout.length === round.layout.length && new Set(input.layout.map((hole) => hole.allocation)).size === round.layout.length
    && input.layout.every((hole) => Number.isSafeInteger(hole.allocation) && hole.allocation >= 1
      && hole.allocation <= round.layout.length) ? [input.handicap] : []);
  const lowest = handicaps.length === 4 ? Math.min(...handicaps) : null;
  const relative = new Map(selected.flatMap((input) => input && typeof input.handicap === 'number'
    && lowest !== null && Number.isSafeInteger(input.handicap - lowest) ? [[input.playerId, input.handicap - lowest] as const] : []));
  let highCarry: number | null = 0, lowCarry: number | null = 0;
  const base: ChurchyHoleReceipt[] = [];
  for (const [index, context] of rotation.contexts.entries()) {
    const stake = index % 3 + 1;
    const [left, right] = context.sides;
    const [a, b] = left ?? [], [c, d] = right ?? [];
    const pairs = a && b && c && d ? [[a, b] as const, [c, d] as const] : [];
    const entries = game.playerIds.map((id) => {
      const input = inputs.find((entry) => entry.playerId === id);
      const hole = input?.layout.find((entry) => entry.number === context.number);
      const score = cards.find((card) => card.playerId === id)?.holes.find((entry) => entry.number === context.number)?.score;
      const handicap = relative.get(id);
      const strokes = hole && handicap !== undefined ? handicapStrokesForHole(handicap, hole.allocation, round.layout.length) : null;
      return { id, score, net: score?.kind === 'strokes' && strokes !== null ? BigInt(score.strokes) - BigInt(strokes) : null };
    });
    const pending = entries.some((entry) => !entry.score || entry.score.kind === 'unplayed');
    function lane(which: 'high' | 'low', carry: number | null): ChurchyLane {
      if (!groupValid || !validRecords || context.status === 'unavailable' || relative.size !== 4) {
        return { status: 'unavailable', winners: [], dots: null, carry: null };
      }
      if (context.status === 'pending' || pending || carry === null) return { status: 'pending', winners: [], dots: null, carry: null };
      const values = pairs.map((pair) => {
        const numeric = entries.filter((entry) => pair.includes(entry.id)).flatMap((entry) => entry.net === null ? [] : [entry.net]);
        return which === 'high' ? numeric.length === 2 ? numeric.reduce((a, b) => a > b ? a : b) : null
          : numeric.length ? numeric.reduce((a, b) => a < b ? a : b) : null;
      });
      const [x, y] = values;
      if (which === 'low' && (x == null || y == null) || x == null && y == null) {
        return { status: 'unavailable', winners: [], dots: null, carry: null };
      }
      if (x === y) return { status: 'tied', winners: [], dots: 0, carry: carry + stake };
      return { status: 'won', winners: pairs[x == null ? 1 : y == null || x < y ? 0 : 1] ?? [], dots: carry + stake, carry: 0 };
    }
    const high = lane('high', highCarry), low = lane('low', lowCarry);
    highCarry = high.carry; lowCarry = low.carry;
    base.push({ number: context.number, stake, pairs, high, low, specials: [], specialStatus: 'pending',
      dotStatus: 'pending', awards: [] });
  }
  const contexts = rotation.contexts.map((context, index) => {
    const hole = base[index];
    return { ...context, sweepMultiplier: hole?.stake === 2 ? 2 as const : hole?.stake === 3 ? 3 as const : 1 as const,
      ...(hole && ['won', 'tied'].includes(hole.high.status) ? { highWinnerIds: hole.high.winners } : {}),
      ...(hole && ['won', 'tied'].includes(hole.low.status) ? { lowWinnerIds: hole.low.winners } : {}) };
  });
  const dots = calculateDots(churchyDotsDefinition(game), round, dotRecords(records), contexts, 'churcie-v3');
  const holes: ChurchyHoleReceipt[] = base.map((hole) => {
    const special = dots.holes.find((entry) => entry.number === hole.number);
    const specials = [...(special?.awards ?? []), ...dots.awards.filter((award) =>
      award.number === null && hole.number === base.at(-1)?.number)].map((award) => ({
      special: award.kind === 'dime' ? 'Sticky' : dotsSpecialCatalog.find((entry) => entry.kind === award.kind)?.label ?? award.kind,
      playerId: award.earnedBy, outcome: 'made' as const, winners: award.recipientIds, dots: award.dots,
    }));
    const specialStatus = !validRecords ? 'unavailable' : special?.status ?? 'unavailable';
    const complete = hole.high.dots !== null && hole.low.dots !== null && specialStatus === 'complete';
    const awards = game.playerIds.map((playerId) => {
      const value = sum([hole.high.winners.includes(playerId) ? hole.high.dots ?? 0 : 0,
        hole.low.winners.includes(playerId) ? hole.low.dots ?? 0 : 0,
        ...specials.filter((entry) => entry.winners.includes(playerId)).map((entry) => entry.dots)]);
      return { playerId, dots: complete || value !== null && value > 0 ? value : null };
    });
    const unavailable = hole.high.status === 'unavailable' || hole.low.status === 'unavailable'
      || specialStatus === 'unavailable' || awards.some((award) => award.dots === null && complete);
    return { ...hole, specials, specialStatus, awards, dotStatus: unavailable ? 'unavailable' : complete ? 'complete'
      : awards.some((award) => award.dots !== null) ? 'partial' : 'pending' };
  });
  let status: 'complete' | 'in-progress' | 'unavailable' = holes.some((hole) => hole.dotStatus === 'unavailable')
    || !groupValid || !validRecords ? 'unavailable' : holes.every((hole) => hole.dotStatus === 'complete') ? 'complete' : 'in-progress';
  const subtotal = (playerId: string, selected: readonly ChurchyHoleReceipt[]) => {
    if (selected.some((hole) => sum([hole.high.winners.includes(playerId) ? hole.high.dots ?? 0 : 0,
      hole.low.winners.includes(playerId) ? hole.low.dots ?? 0 : 0,
      ...hole.specials.filter((entry) => entry.winners.includes(playerId)).map((entry) => entry.dots)]) === null)) return null;
    const values = selected.flatMap((hole) => hole.awards.filter((entry) => entry.playerId === playerId && entry.dots !== null)
      .map((entry) => entry.dots ?? 0));
    return values.length ? sum(values) : null;
  };
  const players: readonly GamePlayerResult[] = game.playerIds.map((playerId) => {
    const input = inputs.find((entry) => entry.playerId === playerId);
    return { playerId, displayName: input?.displayName ?? 'Golfer unavailable', playingHandicap: relative.get(playerId) ?? null,
      status, holes: holes.map((hole) => ({ number: hole.number,
        points: hole.awards.find((entry) => entry.playerId === playerId)?.dots ?? null,
        strokesReceived: relative.has(playerId) && input ? handicapStrokesForHole(relative.get(playerId) ?? 0,
          input.layout.find((entry) => entry.number === hole.number)?.allocation ?? 1, input.layout.length) : null })),
      holesScored: cards.find((card) => card.playerId === playerId)?.holes.filter((hole) => hole.score.kind !== 'unplayed').length ?? 0,
      totalHoles: holes.length, frontPoints: subtotal(playerId, holes.filter((hole) => hole.number <= 9)),
      backPoints: subtotal(playerId, holes.filter((hole) => hole.number > 9)), totalPoints: subtotal(playerId, holes) };
  });
  if (players.some((player) => player.totalPoints === null && holes.some((hole) =>
    hole.awards.some((award) => award.playerId === player.playerId && award.dots !== null)))) status = 'unavailable';
  const output = players.map((player) => ({ ...player, status }));
  const internalSettlement = calculateChurchyInternalSettlement(game, output, holes, status);
  const baseAwards: DotAward[] = [];
  for (const kind of ['high', 'low'] as const) {
    let sourceHoles: number[] = [];
    for (const hole of holes) {
      sourceHoles.push(hole.number);
      const lane = hole[kind];
      if (lane.status !== 'won' || lane.dots === null) continue;
      baseAwards.push({ id: `${game.id}:${String(hole.number)}:${kind}`, number: hole.number, kind, source: 'derived',
        earnedBy: null, recipientIds: lane.winners, units: lane.dots, count: 1, multiplier: 1, dots: lane.dots,
        sourceHoles, scores: game.playerIds.flatMap((playerId) => sourceHoles.flatMap((number) => {
          const personal = inputs.find((entry) => entry.playerId === playerId)?.layout.find((entry) => entry.number === number);
          const score = cards.find((entry) => entry.playerId === playerId)?.holes.find((entry) => entry.number === number)?.score;
          return personal ? [{ playerId, number, strokes: score?.kind === 'strokes' ? score.strokes : null, par: personal.par }] : [];
        })), reason: `Saved Churchie ${kind} with its independent carry in actual playing order.` });
      sourceHoles = [];
    }
  }
  return { gameId: game.id, kind: 'churchy', version: 3, players: output, churchy: {
    holes, status, unawardedHigh: highCarry, unawardedLow: lowCarry, internalSettlement, awards: [...baseAwards, ...dots.awards],
    ...(rotation.rotation ? { order: rotation.rotation } : {}),
    settlement: internalSettlement.players.map((player) => ({ playerId: player.playerId,
      paysMinor: player.netMinor === null ? null : Math.max(0, -player.netMinor),
      collectsMinor: player.netMinor === null ? null : Math.max(0, player.netMinor) })),
  } };
}
