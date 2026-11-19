import type { CourseHole } from './catalog.js';
import type { RoundGroup } from './setup.js';
import type { Scorecard } from './scoring.js';

export type DotMultiplier = 1 | 2 | 3;
export interface DotHoleContext {
  readonly number: number;
  readonly status: 'ready' | 'pending' | 'unavailable';
  readonly sides: readonly (readonly string[])[];
  readonly multiplier: DotMultiplier;
  readonly highWinnerIds?: readonly string[];
  readonly lowWinnerIds?: readonly string[];
  readonly sweepMultiplier?: DotMultiplier;
  readonly sourceGameId?: string;
  readonly reason?: string;
}

export interface DotAward {
  readonly id: string;
  readonly number: number | null;
  readonly kind: string;
  readonly source: 'automatic' | 'manual' | 'derived';
  readonly earnedBy: string | null;
  readonly recipientIds: readonly string[];
  readonly units: number;
  readonly count: number;
  readonly multiplier: DotMultiplier;
  readonly dots: number;
  readonly sourceHoles: readonly number[];
  readonly scores: readonly {
    readonly playerId: string;
    readonly number: number;
    readonly strokes: number | null;
    readonly par: number;
  }[];
  readonly reason: string;
}

export interface DotRoundInput {
  readonly dotsCategorySweepsVersion?: 0 | 1;
  readonly stringRulesVersion?: 1 | 2;
  readonly layout: readonly CourseHole[];
  readonly groups: readonly RoundGroup[];
  readonly cards: readonly Scorecard[];
  readonly playerLayouts?: readonly {
    readonly playerId: string;
    readonly layout: readonly CourseHole[];
  }[];
}

export interface DotPrefixPoints {
  readonly playerId: string;
  readonly dots: number | null;
}
