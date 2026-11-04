import type { CourseMetadata, IndexObservation, TeeProfile } from './catalog.js';
import type { EventSummary } from './events.js';

export interface RoundGroup {
  readonly number: number;
  readonly playerIds: readonly string[];
}

export interface RoundSetupInput {
  readonly id: string;
  readonly name: string;
  readonly courseId: string;
  readonly courseVersionId: string;
  readonly teeProfileId: number;
  readonly groups: readonly RoundGroup[];
}

export interface EventSetupInput {
  readonly name: string;
  readonly location: string;
  readonly playerIds: readonly string[];
  readonly rounds: readonly RoundSetupInput[];
}

export interface EventRosterPlayer {
  readonly playerId: string;
  readonly displayName: string;
}

export interface RoundPlayerSnapshot extends EventRosterPlayer {
  readonly handicapIndex?: IndexObservation | null;
}

export interface RoundSnapshot {
  readonly id: string;
  readonly name: string;
  readonly courseId: string;
  readonly courseVersionId: string;
  readonly course: CourseMetadata;
  readonly teeProfile: TeeProfile;
  readonly groups: readonly RoundGroup[];
  readonly players: readonly RoundPlayerSnapshot[];
}

export interface EventWorkspace {
  readonly event: EventSummary;
  readonly location: string;
  readonly roster: readonly EventRosterPlayer[];
  readonly rounds: readonly RoundSnapshot[];
  readonly etag: string;
}
