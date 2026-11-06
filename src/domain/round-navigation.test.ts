import { describe, expect, it } from 'vitest';
import { adjacentHole, groupStartingHole } from './round-navigation';

const layout = Array.from({ length: 18 }, (_, index) => ({ number: index + 1, sourceId: index + 1, par: 4, length: 300, allocation: index + 1 }));

describe('playing group hole navigation', () => {
  it.each([1, 7, 10, 18])('visits exactly one circuit from starting hole %i', (startingHole) => {
    let hole = startingHole;
    const visited = [hole];
    for (let count = 1; count < layout.length; count++) {
      const next = adjacentHole(layout, hole, 1);
      if (!next) throw new Error('Missing fictional next hole.');
      hole = next.number;
      visited.push(hole);
    }
    expect(new Set(visited).size).toBe(18);
    expect(adjacentHole(layout, hole, 1)?.number).toBe(startingHole);
    expect(adjacentHole(layout, startingHole, -1)?.number).toBe(hole);
  });
  it('uses the captured layout for legacy, nine-hole and non-one starts without inventing holes', () => {
    const backNine = layout.slice(9);
    expect(groupStartingHole({ number: 1, playerIds: [] }, backNine)).toBe(10);
    expect(groupStartingHole({ number: 1, playerIds: [], startingHole: 14 }, backNine)).toBe(14);
    expect(adjacentHole(backNine, 18, 1)?.number).toBe(10);
    expect(adjacentHole(backNine, 10, -1)?.number).toBe(18);
    expect(adjacentHole(backNine, 1, 1)).toBeUndefined();
    expect(adjacentHole([], 1, 1)).toBeUndefined();
    expect(groupStartingHole(undefined, [])).toBeUndefined();
  });
});
