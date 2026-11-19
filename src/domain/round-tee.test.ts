import { describe, expect, it } from 'vitest';
import type { TeeProfile } from './catalog';
import { isTeeProfile } from '../contracts/catalog';
import { calculateCourseHandicap } from './stableford';
import { roundTee } from './round-tee';

const tee: TeeProfile = {
  id: 101, name: 'Fictional Blue', category: 'Fictional category', holeCount: 18, totalYardage: 6300, totalMeters: 5760, totalPar: 72,
  strokeAllocation: true, shorter: false, eligibleSides: 'All',
  holes: Array.from({ length: 18 }, (_, index) => ({
    number: index + 1, sourceId: index + 201, length: 350, par: 4, allocation: 18 - index,
  })),
  ratings: [
    { type: 'Total' as const, course: 72, slope: 130, bogey: 95 },
    { type: 'Front' as const, course: 35, slope: 113, bogey: 47 },
    { type: 'Back' as const, course: 37, slope: 126, bogey: 48 },
  ],
};

describe('nine-hole round capture', () => {
  it.each(['front', 'back'] as const)('captures the %s without changing source identities or mutating the catalog', (side) => {
    const captured = roundTee(tee, side);
    expect(captured).toBeDefined();
    if (!captured) throw new Error('Missing fictional side');
    expect(isTeeProfile(captured)).toBe(true);
    expect(captured.id).toBe(tee.id);
    expect(captured.holes.map((hole) => hole.number)).toEqual(side === 'front'
      ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(captured.holes.map((hole) => hole.sourceId)).toEqual(tee.holes.slice(side === 'front' ? 0 : 9, side === 'front' ? 9 : 18).map((hole) => hole.sourceId));
    expect(captured.holes.map((hole) => hole.allocation)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(captured).toMatchObject({ holeCount: 9, totalYardage: 3150, totalPar: 36 });
    expect(captured.ratings.find((rating) => rating.type === 'Total')).toMatchObject(side === 'front'
      ? { course: 35, slope: 113 } : { course: 37, slope: 126 });
    expect(calculateCourseHandicap('20', captured)).toBe(side === 'front' ? 9 : 12);
    expect(calculateCourseHandicap('+4', captured)).toBe(side === 'front' ? -3 : -1);
    expect(tee.holes).toHaveLength(18);
    expect(roundTee(tee)).toBe(tee);
  });
  it('retains native nine-hole tees and refuses unsupported slicing or missing side ratings', () => {
    const native = { ...tee, holeCount: 9, holes: tee.holes.slice(0, 9) };
    expect(roundTee(native)).toBe(native);
    expect(roundTee(native, 'back')).toBeUndefined();
    expect(roundTee({ ...tee, ratings: tee.ratings.filter((rating) => rating.type !== 'Back') }, 'back')).toBeUndefined();
  });
});
