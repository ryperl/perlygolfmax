import type { CourseData, TeeProfile } from '../domain/catalog.js';
import { isCourseMetadata, isTeeProfile } from './catalog.js';
import { isRecord } from './events.js';

export class CourseImportValidationError extends Error {}

function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) throw new CourseImportValidationError(`${path} must be an object.`);
  const unexpected = Object.keys(value).some((key) => !keys.includes(key));
  if (unexpected || keys.some((key) => !(key in value))) {
    throw new CourseImportValidationError(`${path} contains missing or unsupported fields. No fields were imported.`);
  }
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new CourseImportValidationError(`${path} must be text.`);
  return value;
}

function numeric(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new CourseImportValidationError(`${path} must be a finite number.`);
  return value;
}

function flag(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new CourseImportValidationError(`${path} must be true or false.`);
  return value;
}

function sourceNumber(value: unknown, path: string): string | number | null {
  if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
    throw new CourseImportValidationError(`${path} must be a source number, text identifier or null.`);
  }
  return value;
}

function array(value: unknown, path: string, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    throw new CourseImportValidationError(`${path} has an invalid number of entries.`);
  }
  return value;
}

function profile(value: unknown, index: number): TeeProfile {
  const path = `TeeSets[${String(index)}]`;
  const item = record(value, path, [
    'Ratings', 'Holes', 'TeeSetRatingId', 'TeeSetRatingName', 'Gender', 'HolesNumber',
    'TotalYardage', 'TotalMeters', 'StrokeAllocation', 'TotalPar', 'IsShorter', 'EligibleSides',
  ]);
  const ratings = array(item.Ratings, `${path}.Ratings`, 3).map((value, index) => {
    const ratingPath = `${path}.Ratings[${String(index)}]`;
    const rating = record(value, ratingPath, ['RatingType', 'CourseRating', 'SlopeRating', 'BogeyRating']);
    const type = text(rating.RatingType, `${ratingPath}.RatingType`);
    if (type !== 'Total' && type !== 'Front' && type !== 'Back') {
      throw new CourseImportValidationError(`${ratingPath}.RatingType must be Total, Front or Back.`);
    }
    return {
      type, course: numeric(rating.CourseRating, `${ratingPath}.CourseRating`),
      slope: numeric(rating.SlopeRating, `${ratingPath}.SlopeRating`),
      bogey: numeric(rating.BogeyRating, `${ratingPath}.BogeyRating`),
    };
  });
  const holes = array(item.Holes, `${path}.Holes`, 18).map((value, index) => {
    const holePath = `${path}.Holes[${String(index)}]`;
    const hole = record(value, holePath, ['Number', 'HoleId', 'Length', 'Par', 'Allocation']);
    return {
      number: numeric(hole.Number, `${holePath}.Number`),
      sourceId: numeric(hole.HoleId, `${holePath}.HoleId`),
      length: numeric(hole.Length, `${holePath}.Length`),
      par: numeric(hole.Par, `${holePath}.Par`),
      allocation: numeric(hole.Allocation, `${holePath}.Allocation`),
    };
  });
  const result = {
    id: numeric(item.TeeSetRatingId, `${path}.TeeSetRatingId`),
    name: text(item.TeeSetRatingName, `${path}.TeeSetRatingName`),
    category: text(item.Gender, `${path}.Gender`),
    holeCount: numeric(item.HolesNumber, `${path}.HolesNumber`),
    totalYardage: numeric(item.TotalYardage, `${path}.TotalYardage`),
    totalMeters: numeric(item.TotalMeters, `${path}.TotalMeters`),
    totalPar: numeric(item.TotalPar, `${path}.TotalPar`),
    strokeAllocation: flag(item.StrokeAllocation, `${path}.StrokeAllocation`),
    shorter: flag(item.IsShorter, `${path}.IsShorter`),
    eligibleSides: text(item.EligibleSides, `${path}.EligibleSides`),
    ratings, holes,
  };
  if (!isTeeProfile(result)) {
    throw new CourseImportValidationError(`${path} has invalid profile values, duplicate holes/ratings, or inconsistent par, yardage or allocation totals.`);
  }
  return result;
}

export function readCourseSource(value: unknown): CourseData {
  const source = record(value, 'Course export', [
    'Facility', 'Season', 'TeeSets', 'CourseId', 'CourseName', 'CourseStatus', 'CourseNumber', 'CourseCity', 'CourseState',
  ]);
  const facility = record(source.Facility, 'Facility', [
    'FacilityId', 'FacilityStatus', 'FacilityName', 'FacilityNumber', 'GolfAssociationId',
    'GeoLocationFormattedAddress', 'GeoLocationLongitude', 'GeoLocationLatitude',
  ]);
  const season = record(source.Season, 'Season', ['SeasonName', 'SeasonStartDate', 'SeasonEndDate', 'IsAllYear']);
  const metadata = {
    provider: 'usga-ghin',
    sourceId: numeric(source.CourseId, 'CourseId'),
    name: text(source.CourseName, 'CourseName'),
    status: text(source.CourseStatus, 'CourseStatus'),
    number: sourceNumber(source.CourseNumber, 'CourseNumber'),
    city: text(source.CourseCity, 'CourseCity'),
    state: text(source.CourseState, 'CourseState'),
    facility: {
      id: numeric(facility.FacilityId, 'Facility.FacilityId'),
      status: text(facility.FacilityStatus, 'Facility.FacilityStatus'),
      name: text(facility.FacilityName, 'Facility.FacilityName'),
      number: sourceNumber(facility.FacilityNumber, 'Facility.FacilityNumber'),
      golfAssociationId: numeric(facility.GolfAssociationId, 'Facility.GolfAssociationId'),
      address: text(facility.GeoLocationFormattedAddress, 'Facility.GeoLocationFormattedAddress'),
      longitude: numeric(facility.GeoLocationLongitude, 'Facility.GeoLocationLongitude'),
      latitude: numeric(facility.GeoLocationLatitude, 'Facility.GeoLocationLatitude'),
    },
    season: {
      name: text(season.SeasonName, 'Season.SeasonName'),
      start: text(season.SeasonStartDate, 'Season.SeasonStartDate'),
      end: text(season.SeasonEndDate, 'Season.SeasonEndDate'),
      allYear: flag(season.IsAllYear, 'Season.IsAllYear'),
    },
  };
  if (!isCourseMetadata(metadata)) throw new CourseImportValidationError('Course, Facility or Season metadata has invalid values.');
  const teeProfiles = array(source.TeeSets, 'TeeSets', 32).map(profile);
  if (new Set(teeProfiles.map((tee) => tee.id)).size !== teeProfiles.length) {
    throw new CourseImportValidationError('TeeSets contains duplicate TeeSetRatingId values. Profiles cannot be merged.');
  }
  return { ...metadata, teeProfiles };
}
