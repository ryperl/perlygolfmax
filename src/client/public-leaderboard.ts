import type { PublicLeaderboardKind, PublicLeaderboardSummary } from '../domain/public-leaderboard';
import type { EventSkinsDetails } from '../domain/event-skins-details';

export interface PublicLeaderboardClient {
  readonly details?: (eventId: string, signal: AbortSignal) => Promise<EventSkinsDetails>;
  readonly load: (eventId: string, signal: AbortSignal, kind?: PublicLeaderboardKind) => Promise<PublicLeaderboardSummary>;
}
