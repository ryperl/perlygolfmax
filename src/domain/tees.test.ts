import { describe, expect, it } from 'vitest';
import type { TeeProfile } from './catalog.js';
import { compatibleTeeLayouts, playerTee, sameTeeSelections, scorecardHoles, scorecardTee } from './tees.js';

function profile(count = 18, id = 1): TeeProfile {
  return {
    id, name: `Fictional tee ${String(id)}`, category: 'Fictional category', holeCount: count,
    totalYardage: count * 350, totalMeters: Math.round(count * 350 * 0.9144), totalPar: count * 4,
    strokeAllocation: true, shorter: null, eligibleSides: null,
    ratings: [{ type: 'Total', course: count * 4, slope: 113, bogey: count * 5 },
      { type: 'Front', course: count * 2, slope: 113, bogey: count * 2.5 },
      { type: 'Back', course: count * 2, slope: 113, bogey: count * 2.5 }],
    holes: Array.from({ length: count }, (_, index) => ({
      number: index + 1, sourceId: 100 + index, length: 350, par: 4, allocation: index + 1,
    })),
  };
}

describe('captured per-golfer tees', () => {
  it('uses the common tee for legacy/unassigned golfers and exact captured overrides for assigned golfers', () => {
    const common = profile();
    const assigned = profile(18, 2);
    const round = { teeProfile: common, playerTees: [{ playerId: 'fictional-a', profile: assigned }] };
    const before = structuredClone(round);
    expect(playerTee(round, 'fictional-a')).toBe(assigned);
    expect(playerTee(round, 'fictional-b')).toBe(common);
    expect(playerTee({ teeProfile: common }, 'fictional-a')).toBe(common);
    expect(scorecardTee(round, 'fictional-a')).toBe(assigned);
    expect(scorecardTee(round, 'fictional-b')).toBeUndefined();
    expect(scorecardHoles({ ...round, layout: common.holes }, 'fictional-a')).toBe(assigned.holes);
    expect(scorecardHoles({ layout: common.holes }, 'fictional-a')).toBe(common.holes);
    expect(round).toEqual(before);
  });
  it('requires matching physical hole numbers/count while allowing different par, ratings, distances and allocation', () => {
    const common = profile();
    const selected = { ...profile(18, 2), holes: [...common.holes].reverse().map((hole) => ({
      ...hole, par: hole.number === 1 ? 5 : 4, length: 300, allocation: 19 - hole.number,
    })) };
    expect(compatibleTeeLayouts(common, selected)).toBe(true);
    expect(compatibleTeeLayouts(common, profile(9))).toBe(false);
    expect(compatibleTeeLayouts(common, { ...selected, holes: selected.holes.map(() => selected.holes[0] ?? common.holes[0]).filter((hole) => hole !== undefined) })).toBe(false);
    expect(compatibleTeeLayouts(common, { ...selected, holes: selected.holes.map((hole) => ({
      ...hole, number: hole.number === 1 ? 19 : hole.number,
    })) })).toBe(false);
  });
  it('compares assignments independently of ordering and treats explicit common-tee choices as defaults', () => {
    const a = [{ playerId: 'fictional-a', teeProfileId: 2 }, { playerId: 'fictional-b', teeProfileId: 1 }];
    expect(sameTeeSelections(a, [{ playerId: 'fictional-a', teeProfileId: 2 }], 1)).toBe(true);
    expect(sameTeeSelections(undefined, [], 1)).toBe(true);
    expect(sameTeeSelections(a, [{ playerId: 'fictional-a', teeProfileId: 3 }], 1)).toBe(false);
    expect(sameTeeSelections(a, [{ playerId: 'fictional-c', teeProfileId: 2 }], 1)).toBe(false);
  });
});
