import type { CourseMetadata, CourseProvenance, CourseRating, TeeProfile } from '../../../src/domain/catalog.js';

const ratingOrder: Readonly<Record<CourseRating['type'], number>> = { Total: 0, Front: 1, Back: 2 };

export function metadata(course: CourseMetadata): CourseMetadata {
  return {
    provider: course.provider, sourceId: course.sourceId, name: course.name, status: course.status,
    number: course.number, city: course.city, state: course.state,
    facility: {
      id: course.facility.id, status: course.facility.status, name: course.facility.name,
      number: course.facility.number, golfAssociationId: course.facility.golfAssociationId,
      address: course.facility.address, longitude: course.facility.longitude, latitude: course.facility.latitude,
    },
    season: { name: course.season.name, start: course.season.start, end: course.season.end, allYear: course.season.allYear },
  };
}

export function profile(tee: TeeProfile): TeeProfile {
  return {
    id: tee.id, name: tee.name, category: tee.category, holeCount: tee.holeCount,
    totalYardage: tee.totalYardage, totalMeters: tee.totalMeters, totalPar: tee.totalPar,
    strokeAllocation: tee.strokeAllocation, shorter: tee.shorter, eligibleSides: tee.eligibleSides,
    ratings: tee.ratings.map((rating) => ({ type: rating.type, course: rating.course, slope: rating.slope, bogey: rating.bogey }))
      .sort((left, right) => ratingOrder[left.type] - ratingOrder[right.type]),
    holes: tee.holes.map((hole) => ({
      number: hole.number, sourceId: hole.sourceId, length: hole.length, par: hole.par, allocation: hole.allocation,
    })).sort((left, right) => left.number - right.number),
  };
}

export function provenance(value: CourseProvenance): CourseProvenance {
  return { source: value.source, exportedAt: value.exportedAt };
}
