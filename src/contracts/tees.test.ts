import { describe, expect, it } from 'vitest';
import type { TeeProfile } from '../domain/catalog.js';
import { isPlayerTeeProfiles, isPlayerTeeSelections } from './tees.js';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const common: TeeProfile = {
  id: 1, name: 'Fictional common', category: 'Fictional category', holeCount: 9,
  totalYardage: 3150, totalMeters: 2880, totalPar: 36, strokeAllocation: true, shorter: null, eligibleSides: null,
  ratings: [{ type: 'Total', course: 36, slope: 113, bogey: 45 },
    { type: 'Front', course: 18, slope: 113, bogey: 22.5 },
    { type: 'Back', course: 18, slope: 113, bogey: 22.5 }],
  holes: Array.from({ length: 9 }, (_, index) => ({
    number: index + 1, sourceId: 100 + index, length: 350, par: 4, allocation: index + 1,
  })),
};
describe('per-golfer tee contracts', () => {
  it('accepts sparse, unique explicit assignments without a golfer-count cap', () => {
    expect(isPlayerTeeSelections([])).toBe(true);
    expect(isPlayerTeeSelections(Array.from({ length: 120 }, (_, index) => ({ playerId: id(index), teeProfileId: 2 })))).toBe(true);
    for (const value of [
      null, [{ playerId: 'bad', teeProfileId: 2 }], [{ playerId: id(1), teeProfileId: 0 }],
      [{ playerId: id(1), teeProfileId: 1.2 }], [{ playerId: id(1), teeProfileId: 2, extra: true }],
      [{ playerId: id(1), teeProfileId: 2 }, { playerId: id(1), teeProfileId: 3 }],
    ]) expect(isPlayerTeeSelections(value)).toBe(false);
  });
  it('rejects unknown golfers, duplicate profiles and incompatible or corrupt tee captures', () => {
    const profile = { ...common, id: 2, name: 'Fictional alternate' };
    expect(isPlayerTeeProfiles([{ playerId: id(1), profile }], common, [id(1), id(2)])).toBe(true);
    expect(isPlayerTeeProfiles([], common, [id(1)])).toBe(true);
    for (const value of [
      [{ playerId: id(3), profile }],
      [{ playerId: id(1), profile }, { playerId: id(1), profile }],
      [{ playerId: id(1), profile: { ...profile, holeCount: 18 } }],
      [{ playerId: id(1), profile: { ...profile, shorter: undefined } }],
      [{ playerId: id(1), profile, extra: true }],
    ]) expect(isPlayerTeeProfiles(value, common, [id(1), id(2)])).toBe(false);
  });
});
