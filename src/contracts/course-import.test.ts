import { describe, expect, it } from 'vitest';
import { readCourseSource } from './course-import';
import { isCourseImportManifest, isCourseVersion, isTeeProfile } from './catalog';

function source() {
  const holes = Array.from({ length: 18 }, (_, i) => ({
    Number: i + 1, HoleId: 8000 + i, Length: 100, Par: 4, Allocation: i + 1,
  }));
  const profile = {
    TeeSetRatingId: 701, TeeSetRatingName: 'Fictional Blue', Gender: 'Male', HolesNumber: 18,
    TotalYardage: 1800, TotalMeters: 1646, StrokeAllocation: true, TotalPar: 72,
    IsShorter: false, EligibleSides: 'All', Holes: holes,
    Ratings: [
      { RatingType: 'Total', CourseRating: 70, SlopeRating: 120, BogeyRating: 90 },
      { RatingType: 'Front', CourseRating: 35, SlopeRating: 120, BogeyRating: 45 },
      { RatingType: 'Back', CourseRating: 35, SlopeRating: 120, BogeyRating: 45 },
    ],
  };
  return {
    Facility: {
      FacilityId: 801, FacilityName: 'Fictional Club', FacilityStatus: 'Active',
      FacilityNumber: 'fictional', GolfAssociationId: 802,
      GeoLocationFormattedAddress: 'Fictional location', GeoLocationLongitude: 1, GeoLocationLatitude: 1,
    },
    Season: { SeasonName: 'Fictional season', SeasonStartDate: '03/01', SeasonEndDate: '11/14', IsAllYear: false },
    CourseId: 803, CourseName: 'Fictional Course', CourseStatus: 'Active', CourseNumber: 'fictional',
    CourseCity: 'Fictional City', CourseState: 'Fictional State',
    TeeSets: [
      profile,
      { ...profile, TeeSetRatingId: 702, Gender: 'Female',
        Holes: holes.map((hole) => ({ ...hole, HoleId: hole.HoleId + 100, Allocation: 19 - hole.Allocation })) },
    ],
  };
}

describe('organizer course export boundary', () => {
  it('preserves independent profile categories, hole definitions, ratings, units and season metadata', () => {
    const input = source();
    const result = readCourseSource(input);
    expect(result.teeProfiles).toHaveLength(2);
    expect(result.teeProfiles[0]).toMatchObject({
      id: 701, name: 'Fictional Blue', category: 'Male', totalYardage: 1800, totalMeters: 1646,
      strokeAllocation: true, shorter: false, eligibleSides: 'All',
    });
    expect(result.teeProfiles[1]).toMatchObject({ id: 702, name: 'Fictional Blue', category: 'Female' });
    expect(result.teeProfiles[0]?.holes[0]?.allocation).toBe(1);
    expect(result.teeProfiles[1]?.holes[0]?.allocation).toBe(18);
    expect(result.teeProfiles[0]?.ratings).toEqual([
      { type: 'Total', course: 70, slope: 120, bogey: 90 },
      { type: 'Front', course: 35, slope: 120, bogey: 45 },
      { type: 'Back', course: 35, slope: 120, bogey: 45 },
    ]);
    expect(result.facility.address).toBe(input.Facility.GeoLocationFormattedAddress);
    expect(readCourseSource({ ...input, CourseNumber: 1 }).number).toBe(1);
    expect(readCourseSource({ ...input, CourseNumber: null }).number).toBeNull();
    expect(result.season).toEqual({ name: 'Fictional season', start: '03/01', end: '11/14', allYear: false });
    expect(JSON.stringify(input)).not.toContain('importedAt');
  });

  it('rejects unknown/missing fields and malformed metadata rather than discarding source meaning', () => {
    expect(() => readCourseSource({ ...source(), Unexpected: 'data' })).toThrow(/unsupported fields/);
    expect(() => readCourseSource({ ...source(), CourseId: '803' })).toThrow('CourseId');
    expect(() => readCourseSource({ ...source(), Season: { ...source().Season, SeasonEndDate: '02/31' } })).toThrow(/metadata/);
    expect(() => readCourseSource(null)).toThrow('object');
  });

  it('rejects duplicate IDs, missing rating sections and inconsistent holes/totals', () => {
    const input = source();
    const tee = input.TeeSets[0];
    if (!tee) throw new Error('Fictional fixture is missing a tee.');
    expect(() => readCourseSource({ ...input, TeeSets: [tee, tee] })).toThrow('duplicate TeeSetRatingId');
    expect(() => readCourseSource({ ...input, TeeSets: [{ ...tee, TotalYardage: 1801 }] })).toThrow('inconsistent');
    expect(() => readCourseSource({ ...input, TeeSets: [{ ...tee, Ratings: tee.Ratings.slice(0, 2) }] })).toThrow('invalid profile');
    expect(() => readCourseSource({ ...input, TeeSets: [{ ...tee, Holes: tee.Holes.map((hole) => ({ ...hole, Allocation: 1 })) }] })).toThrow('inconsistent');
  });

  it('validates version identity, profile IDs and unknown provenance dates independently of names', () => {
    const { teeProfiles, ...course } = readCourseSource(source());
    const manifest = { course, teeProfileIds: teeProfiles.map((profile) => profile.id), provenance: { source: 'Fictional organizer', exportedAt: null } };
    expect(isCourseImportManifest(manifest)).toBe(true);
    expect(isCourseImportManifest({ ...manifest, teeProfileIds: [701, 701] })).toBe(false);
    expect(isCourseImportManifest({ ...manifest, provenance: { source: 'Fictional', exportedAt: '2026-02-31' } })).toBe(false);
    const version = { id: 'a'.repeat(64), courseId: 'ghin:801:803', data: { ...course, teeProfiles }, provenance: manifest.provenance, importedAt: '2026-01-01T00:00:00Z' };
    expect(isCourseVersion(version)).toBe(true);
    expect(isCourseVersion({ ...version, courseId: 'ghin:801:804' })).toBe(false);
    const tee = teeProfiles[0];
    expect(isTeeProfile({ ...tee, ratings: [{ type: { toString: () => 'Total' }, course: 70, slope: 120, bogey: 90 }] })).toBe(false);
  });
});
