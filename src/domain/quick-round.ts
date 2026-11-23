import type { CourseData } from './catalog.js';

export interface QuickCourse {
  readonly id: string;
  readonly name: string;
  readonly latestVersionId: string;
}

export interface QuickPlayer {
  readonly id: string;
  readonly displayName: string;
  readonly handicapIndexValue: string | null;
}

export interface QuickCourseVersion {
  readonly courseId: string;
  readonly id: string;
  readonly data: CourseData;
}

export interface QuickPage<T> {
  readonly items: readonly T[];
  readonly continuationToken?: string;
}

export interface QuickPlayerPage extends QuickPage<QuickPlayer> {
  readonly publicPlayerCreation?: boolean;
}

export interface PublicPlayerInput {
  readonly displayName: string;
  readonly handicapIndexValue: string;
}

