import type { AccountIdentity } from './events.js';
import type { PursePlan, PurseTieResolution, PurseView } from './purse.js';
import type { RoundScores } from './scoring.js';
import type { EventWorkspace } from './setup.js';

export const maximumPurseRequestBytes = 12 * 1024;

export interface PurseSelection {
  readonly plan: PursePlan | null;
  readonly resolutions: readonly PurseTieResolution[];
}

export interface PurseConfiguration extends PurseSelection {
  readonly eventId: string;
  readonly etag: string | null;
}

export interface EventPurseView {
  readonly workspace: EventWorkspace;
  readonly roundScores: readonly RoundScores[];
  readonly configuration: PurseConfiguration;
  readonly view: PurseView | null;
}

export interface PurseChange {
  readonly id: string;
  readonly eventId: string;
  readonly expectedEtag: string | null;
  readonly before: PurseSelection;
  readonly after: { readonly plan: PursePlan; readonly resolutions: readonly PurseTieResolution[] };
  readonly recordedAt: string;
  readonly recordedBy: AccountIdentity;
}

export interface PurseWriteResult {
  readonly current: EventPurseView;
  readonly change: PurseChange;
}
