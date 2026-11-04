import { vi } from 'vitest';
import type { CourseData, CourseImportManifest, CourseImportSession, CourseVersion, PlayerProfile, TeeProfile } from '../domain/catalog';
import type { EventSummary } from '../domain/events';
import type { EventSetupInput, EventWorkspace } from '../domain/setup';
import type { CatalogClient } from './catalog';
import type { SetupClient } from './setup';

export const fictionalId = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export const fictionalProfile: TeeProfile = {
  id: 901, name: 'Fictional Teal', category: 'Fictional A', holeCount: 9, totalYardage: 900,
  totalMeters: 823, totalPar: 36, strokeAllocation: true, shorter: false, eligibleSides: 'All',
  holes: Array.from({ length: 9 }, (_, i) => ({ number: i + 1, sourceId: 9000 + i, length: 100, par: 4, allocation: i + 1 })),
  ratings: [
    { type: 'Total', course: 36, slope: 100, bogey: 45 },
    { type: 'Front', course: 36, slope: 100, bogey: 45 },
    { type: 'Back', course: 36, slope: 100, bogey: 45 },
  ],
};
export const fictionalCourse: CourseData = {
  provider: 'usga-ghin', sourceId: 903, name: 'Fictional Meadows', status: 'Active',
  number: 'fictional', city: 'Fictional City', state: 'Fictional State',
  facility: { id: 902, name: 'Fictional Club', status: 'Active', number: 'fictional', golfAssociationId: 904, address: 'Fictional address', longitude: 0, latitude: 0 },
  season: { name: 'All year', start: '01/01', end: '12/31', allYear: true },
  teeProfiles: [fictionalProfile, { ...fictionalProfile, id: 905, category: 'Fictional B' }],
};
export const fictionalVersion: CourseVersion = {
  id: 'a'.repeat(64), courseId: 'ghin:902:903', data: fictionalCourse,
  provenance: { source: 'Fictional organizer export', exportedAt: null }, importedAt: '2026-01-01T00:00:00Z',
};
const { teeProfiles, ...course } = fictionalCourse;
export const fictionalManifest: CourseImportManifest = { course, teeProfileIds: teeProfiles.map((tee) => tee.id), provenance: fictionalVersion.provenance };
export const fictionalImport: CourseImportSession = {
  id: fictionalId(100), courseId: fictionalVersion.courseId, manifest: fictionalManifest, profilesReceived: [], publishedVersionId: null,
};
export const fictionalEntry = {
  id: fictionalVersion.courseId, name: fictionalCourse.name, location: 'Fictional City', currentVersionId: fictionalVersion.id, etag: 'course-v1',
};
export const fictionalPlayers: readonly PlayerProfile[] = Array.from({ length: 4 }, (_, index) => ({
  id: fictionalId(index + 1), displayName: `Fictional Player ${String(index + 1)}`,
  currentIndex: null, etag: 'player-v1', createdAt: '2026-01-01T00:00:00Z',
}));
export const fictionalEvent: EventSummary = {
  id: fictionalId(50), name: 'Fictional Open', role: 'owner', status: 'active', etag: 'workspace-v1', createdAt: '2026-01-01T00:00:00Z',
};
export const fictionalSetup: EventSetupInput = {
  name: fictionalEvent.name, location: 'Fictional County', playerIds: fictionalPlayers.map((player) => player.id),
  rounds: [{ id: fictionalId(70), name: 'Fictional opening round', courseId: fictionalVersion.courseId,
    courseVersionId: fictionalVersion.id, teeProfileId: fictionalProfile.id,
    groups: [{ number: 1, playerIds: fictionalPlayers.map((player) => player.id) }] }],
};
export const emptyWorkspace: EventWorkspace = { event: fictionalEvent, location: '', roster: [], rounds: [], etag: fictionalEvent.etag };
export const fictionalWorkspace: EventWorkspace = {
  ...emptyWorkspace, location: fictionalSetup.location,
  roster: fictionalPlayers.map((player) => ({ playerId: player.id, displayName: player.displayName })),
  rounds: [{ id: fictionalId(70), name: 'Fictional opening round', courseId: fictionalVersion.courseId,
    courseVersionId: fictionalVersion.id, course, teeProfile: fictionalProfile,
    groups: [{ number: 1, playerIds: fictionalPlayers.map((player) => player.id) }],
    players: fictionalPlayers.map((player) => ({ playerId: player.id, displayName: player.displayName, handicapIndex: null })) }],
};
export function fictionalSource() {
  return {
    CourseId: fictionalCourse.sourceId, CourseName: fictionalCourse.name, CourseStatus: fictionalCourse.status,
    CourseNumber: fictionalCourse.number, CourseCity: fictionalCourse.city, CourseState: fictionalCourse.state,
    Facility: {
      FacilityId: fictionalCourse.facility.id, FacilityName: fictionalCourse.facility.name,
      FacilityStatus: fictionalCourse.facility.status, FacilityNumber: fictionalCourse.facility.number,
      GolfAssociationId: fictionalCourse.facility.golfAssociationId, GeoLocationFormattedAddress: fictionalCourse.facility.address,
      GeoLocationLongitude: 0, GeoLocationLatitude: 0,
    },
    Season: { SeasonName: 'All year', SeasonStartDate: '01/01', SeasonEndDate: '12/31', IsAllYear: true },
    TeeSets: fictionalCourse.teeProfiles.map((profile) => ({
      TeeSetRatingId: profile.id, TeeSetRatingName: profile.name, Gender: profile.category, HolesNumber: profile.holeCount,
      TotalYardage: profile.totalYardage, TotalMeters: profile.totalMeters, TotalPar: profile.totalPar,
      StrokeAllocation: profile.strokeAllocation, IsShorter: profile.shorter, EligibleSides: profile.eligibleSides,
      Holes: profile.holes.map((hole) => ({ Number: hole.number, HoleId: hole.sourceId, Length: hole.length, Par: hole.par, Allocation: hole.allocation })),
      Ratings: profile.ratings.map((rating) => ({ RatingType: rating.type, CourseRating: rating.course, SlopeRating: rating.slope, BogeyRating: rating.bogey })),
    })),
  };
}
export function fakeCatalog(): CatalogClient {
  return {
    courses: vi.fn().mockResolvedValue({ courses: [fictionalEntry] }),
    version: vi.fn().mockResolvedValue(fictionalVersion),
    beginImport: vi.fn().mockResolvedValue(fictionalImport),
    importStatus: vi.fn().mockResolvedValue({ ...fictionalImport, profilesReceived: [901, 905] }),
    uploadProfile: vi.fn().mockImplementation((_id: string, profile: TeeProfile) => Promise.resolve({ ...fictionalImport, profilesReceived: [901, profile.id] })),
    publish: vi.fn().mockResolvedValue(fictionalVersion),
    players: vi.fn().mockResolvedValue({ players: fictionalPlayers }),
    createPlayer: vi.fn().mockResolvedValue(fictionalPlayers[0]),
    renamePlayer: vi.fn().mockResolvedValue(fictionalPlayers[0]),
    history: vi.fn().mockResolvedValue({ observations: [] }),
    recordIndex: vi.fn().mockResolvedValue(fictionalPlayers[0]),
  };
}
export function fakeSetup(): SetupClient {
  return { load: vi.fn().mockResolvedValue(emptyWorkspace), save: vi.fn().mockResolvedValue(fictionalWorkspace),
    refreshIndices: vi.fn().mockResolvedValue(fictionalWorkspace) };
}
