import type { CourseHole } from './catalog.js';
import type { RoundGroup } from './setup.js';

export function groupStartingHole(group: RoundGroup | undefined, layout: readonly CourseHole[]): number | undefined {
  return group?.startingHole ?? layout[0]?.number;
}

export function adjacentHole(layout: readonly CourseHole[], holeNumber: number, direction: 1 | -1): CourseHole | undefined {
  const index = layout.findIndex((hole) => hole.number === holeNumber);
  return index < 0 ? undefined : layout[(index + direction + layout.length) % layout.length];
}

export function playingCircuit(numbers: readonly number[], startingHole: number | undefined): readonly number[] | null {
  const index = numbers.indexOf(startingHole ?? numbers[0] ?? 0);
  return index < 0 ? null : [...numbers.slice(index), ...numbers.slice(0, index)];
}

/** New Skins carryovers are limited to an entire round containing one saved foursome. */
export function skinsCarryCircuit(
  numbers: readonly number[], groups: readonly RoundGroup[], playerIds: readonly string[],
  defaultStartingHole = numbers[0],
): readonly number[] | null {
  const group = groups[0];
  if (groups.length !== 1 || !group || group.playerIds.length !== 4 || playerIds.length !== 4
    || new Set(group.playerIds).size !== 4 || new Set(playerIds).size !== 4
    || playerIds.some((id) => !group.playerIds.includes(id))) return null;
  return playingCircuit(numbers, group.startingHole ?? defaultStartingHole);
}
