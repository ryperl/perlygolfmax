import type { EventSkinsHole, EventSkinsResults } from './event-skins.js';

export interface EventSkinComparison {
  readonly playerId: string;
  readonly disposition: 'strokes' | 'unplayed' | 'picked-up' | 'did-not-finish' | 'unavailable';
  readonly par: number | null;
  readonly gross: number | null;
  readonly net: number | null;
  readonly strokesReceived: number | null;
  readonly outcome: 'won' | 'covered' | 'beaten' | 'pending' | 'ineligible' | 'unavailable';
  readonly reason?: EventSkinsHole['reason'];
}
export interface EventSkinsDetails {
  readonly version: 1;
  readonly eventId: string;
  readonly eventName: string;
  readonly status: EventSkinsResults['status'];
  readonly rounds: readonly { readonly id: string; readonly name: string }[];
  readonly players: readonly { readonly playerId: string; readonly displayName: string }[];
  readonly holes: readonly {
    readonly roundId: string;
    readonly number: number;
    readonly status: EventSkinsHole['status'];
    readonly winnerId: string | null;
    readonly contenderIds: readonly string[];
    readonly grossUnderParPriority: boolean;
    readonly reason?: EventSkinsHole['reason'];
    readonly players: readonly EventSkinComparison[];
  }[];
}
