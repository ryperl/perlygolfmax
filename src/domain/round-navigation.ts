import type { CourseHole } from './catalog.js';
import type { RoundGroup } from './setup.js';

export function groupStartingHole(group: RoundGroup | undefined, layout: readonly CourseHole[]): number | undefined {
  return group?.startingHole ?? layout[0]?.number;
}

export function adjacentHole(layout: readonly CourseHole[], holeNumber: number, direction: 1 | -1): CourseHole | undefined {
  const index = layout.findIndex((hole) => hole.number === holeNumber);
  return index < 0 ? undefined : layout[(index + direction + layout.length) % layout.length];
}
