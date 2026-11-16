import { purseTestContext, purseTestId } from '../../src/domain/purse.test-support';
import type { CourseData, CourseVersion, PlayerProfile, TeeProfile } from '../../src/domain/catalog';

const source = purseTestContext();
const round = source.workspace.rounds[0];
if (!round) throw new Error('Missing fictional catalog course');
const profile: TeeProfile = { ...round.teeProfile, holeCount: 18, totalPar: 72, totalYardage: 6300, totalMeters: 5760, strokeAllocation: true,
  holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, sourceId: 300 + index, length: 350, par: 4, allocation: index + 1 })),
  ratings: [{ type: 'Total', course: 72, slope: 113, bogey: 90 }, { type: 'Front', course: 36, slope: 113, bogey: 45 },
    { type: 'Back', course: 36, slope: 113, bogey: 45 }] };
const names = ['Cedar Dunes', 'Copper Ridge', 'Lake Nine', 'Orchard Links', 'Pine Meadow', 'West Coast'];
export const catalogVersions: readonly CourseVersion[] = names.map((name, index) => {
  const data: CourseData = { ...round.course, sourceId: round.course.sourceId + index, name: `Fictional ${name}`,
    teeProfiles: [profile, { ...profile, id: profile.id + 100, name: 'Fictional alternate tees' }] };
  return { courseId: `ghin:${String(data.facility.id)}:${String(data.sourceId)}`, id: String(index + 1).repeat(64), data,
    provenance: { source: 'Fictional organizer export', exportedAt: null }, importedAt: '2026-01-01T00:00:00Z' };
});

export const catalogPlayers: readonly PlayerProfile[] = Array.from({ length: 8 }, (_, index) => ({
  id: purseTestId(index + 1), displayName: `Fictional golfer ${String(index + 1)}`, etag: 'player-initial', createdAt: '2026-01-01T00:00:00Z',
  currentIndex: index === 0 ? null : { id: purseTestId(500 + index), value: index === 1 ? '0' : index === 2 ? '+1.2' : '12.4',
    effectiveDate: '2026-01-01', source: 'Fictional manual report', recordedAt: '2026-01-02T00:00:00Z',
    recordedBy: { tenantId: purseTestId(900), objectId: purseTestId(901) }, previousObservationId: null },
}));

export function catalogExport(data: CourseData) {
  return {
    CourseId: data.sourceId, CourseName: data.name, CourseStatus: data.status, CourseNumber: data.number,
    CourseCity: data.city, CourseState: data.state,
    Facility: { FacilityId: data.facility.id, FacilityName: data.facility.name, FacilityStatus: data.facility.status,
      FacilityNumber: data.facility.number, GolfAssociationId: data.facility.golfAssociationId,
      GeoLocationFormattedAddress: data.facility.address, GeoLocationLongitude: data.facility.longitude, GeoLocationLatitude: data.facility.latitude },
    Season: { SeasonName: data.season.name, SeasonStartDate: data.season.start, SeasonEndDate: data.season.end, IsAllYear: data.season.allYear },
    TeeSets: data.teeProfiles.map((tee) => ({
      TeeSetRatingId: tee.id, TeeSetRatingName: tee.name, Gender: tee.category, HolesNumber: tee.holeCount,
      TotalYardage: tee.totalYardage, TotalMeters: tee.totalMeters, TotalPar: tee.totalPar,
      StrokeAllocation: tee.strokeAllocation, IsShorter: tee.shorter, EligibleSides: tee.eligibleSides,
      Holes: tee.holes.map((hole) => ({ Number: hole.number, HoleId: hole.sourceId, Length: hole.length, Par: hole.par, Allocation: hole.allocation })),
      Ratings: tee.ratings.map((rating) => ({ RatingType: rating.type, CourseRating: rating.course, SlopeRating: rating.slope, BogeyRating: rating.bogey })),
    })),
  };
}
