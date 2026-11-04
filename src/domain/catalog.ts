import type { AccountIdentity } from './events.js';

export interface CourseFacility {
  readonly id: number;
  readonly status: string;
  readonly name: string;
  readonly number: string | number | null;
  readonly golfAssociationId: number;
  readonly address: string;
  readonly longitude: number;
  readonly latitude: number;
}

export interface CourseSeason {
  readonly name: string;
  readonly start: string;
  readonly end: string;
  readonly allYear: boolean;
}

export interface CourseRating {
  readonly type: 'Total' | 'Front' | 'Back';
  readonly course: number;
  readonly slope: number;
  readonly bogey: number;
}

export interface CourseHole {
  readonly number: number;
  readonly sourceId: number;
  readonly length: number;
  readonly par: number;
  readonly allocation: number;
}

export interface TeeProfile {
  readonly id: number;
  readonly name: string;
  readonly category: string;
  readonly holeCount: number;
  readonly totalYardage: number;
  readonly totalMeters: number;
  readonly totalPar: number;
  readonly strokeAllocation: boolean;
  readonly shorter: boolean;
  readonly eligibleSides: string;
  readonly ratings: readonly CourseRating[];
  readonly holes: readonly CourseHole[];
}

export interface CourseMetadata {
  readonly provider: 'usga-ghin';
  readonly sourceId: number;
  readonly name: string;
  readonly status: string;
  readonly number: string | number | null;
  readonly city: string;
  readonly state: string;
  readonly facility: CourseFacility;
  readonly season: CourseSeason;
}

export interface CourseData extends CourseMetadata {
  readonly teeProfiles: readonly TeeProfile[];
}

export interface CourseProvenance {
  readonly source: string;
  readonly exportedAt: string | null;
}

export interface CourseImportManifest {
  readonly course: CourseMetadata;
  readonly teeProfileIds: readonly number[];
  readonly provenance: CourseProvenance;
}

export interface CourseImportSession {
  readonly id: string;
  readonly courseId: string;
  readonly manifest: CourseImportManifest;
  readonly profilesReceived: readonly number[];
  readonly publishedVersionId: string | null;
}

export interface CourseCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly location: string;
  readonly currentVersionId: string;
  readonly etag: string;
}

export interface CourseVersion {
  readonly id: string;
  readonly courseId: string;
  readonly data: CourseData;
  readonly provenance: CourseProvenance;
  readonly importedAt: string;
}

export interface CourseCatalogPage {
  readonly courses: readonly CourseCatalogEntry[];
  readonly continuationToken?: string;
}

export interface IndexObservation {
  readonly id: string;
  readonly value: string;
  readonly effectiveDate: string;
  readonly source: string;
  readonly recordedAt: string;
  readonly recordedBy: AccountIdentity;
  readonly previousObservationId: string | null;
}

export interface ManualIndexInput {
  readonly value: string;
  readonly effectiveDate: string;
  readonly source: string;
}

export interface PlayerProfile {
  readonly id: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly currentIndex: IndexObservation | null;
  readonly etag: string;
}

export interface PlayerCatalogPage {
  readonly players: readonly PlayerProfile[];
  readonly continuationToken?: string;
}

export interface PlayerIndexHistory {
  readonly observations: readonly IndexObservation[];
  readonly continuationToken?: string;
}
