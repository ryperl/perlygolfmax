import type { DotHoleContext, DotRoundInput } from './dot-context.js';
import type { DotsGameDefinition, DotsHoleRecord, DotsRotationStart } from './dots.js';

export interface DotsRotationContext {
  readonly firstHole: number | null;
  readonly rotation?: DotsRotationStart;
  readonly contexts: readonly DotHoleContext[];
}

function circuit(round: DotRoundInput, groupNumber: number): readonly number[] {
  const group = round.groups.find((entry) => entry.number === groupNumber);
  const numbers = round.layout.map((hole) => hole.number);
  const start = numbers.indexOf(group?.startingHole ?? numbers[0] ?? 0);
  return start < 0 ? [] : [...numbers.slice(start), ...numbers.slice(0, start)];
}

export function dotsFirstPlayedHole(round: DotRoundInput, groupNumber: number): number | null {
  const group = round.groups.find((entry) => entry.number === groupNumber);
  return circuit(round, groupNumber).find((number) => round.cards.some((card) =>
    group?.playerIds.includes(card.playerId) && card.holes.some((hole) =>
      hole.number === number && hole.score.kind !== 'unplayed'))) ?? null;
}

/** A saved receipt fixes the cycle origin even when earlier raw scores are later corrected. */
export function dotsRotationContext(
  game: DotsGameDefinition, round: DotRoundInput, records: readonly DotsHoleRecord[],
): DotsRotationContext {
  const numbers = circuit(round, game.groupNumber);
  const receipts = records.filter((record) => record.gameId === game.id && record.rotation !== undefined);
  const receipt = receipts[0];
  const rotation = receipt?.rotation;
  const firstHole = receipt?.number ?? dotsFirstPlayedHole(round, game.groupNumber);
  const group = round.groups.find((entry) => entry.number === game.groupNumber);
  const valid = game.mode === 'rotating' && receipts.length <= 1 && numbers.length > 0
    && new Set(numbers).size === numbers.length
    && group?.playerIds.length === 4 && new Set(group.playerIds).size === 4
    && game.playerIds.length === 4 && new Set(game.playerIds).size === 4
    && game.playerIds.every((id) => group.playerIds.includes(id))
    && (!rotation || rotation.playerIds.length === 4 && new Set(rotation.playerIds).size === 4
      && rotation.playerIds.every((id) => game.playerIds.includes(id)) && numbers.includes(receipt.number));
  const offset = firstHole === null ? 0 : numbers.indexOf(firstHole);
  const order = offset < 0 ? numbers : [...numbers.slice(offset), ...numbers.slice(0, offset)];
  const contexts: DotHoleContext[] = order.map((number, index) => {
    if (!valid) return { number, status: 'unavailable', sides: [], multiplier: 1, reason: 'invalid-dots-rotation' };
    if (!rotation) return { number, status: 'pending', sides: [], multiplier: 1, reason: 'missing-dots-rotation' };
    const [p1, p2, p3, p4] = rotation.playerIds;
    if (!p1 || !p2 || !p3 || !p4) return { number, status: 'unavailable', sides: [], multiplier: 1, reason: 'invalid-dots-rotation' };
    const cycle = Math.floor(index / game.rotationHoles) % 3;
    const block = game.version === 3 && game.orderMode === 'approach' ? 2 - cycle : cycle;
    const sides = block === 0 ? [[p1, p2], [p3, p4]] : block === 1 ? [[p1, p3], [p2, p4]] : [[p1, p4], [p2, p3]];
    return { number, status: 'ready', sides, multiplier: 1 };
  });
  return { firstHole, ...(rotation ? { rotation } : {}), contexts };
}
