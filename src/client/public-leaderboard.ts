import type { PublicLeaderboardKind, PublicLeaderboardSummary } from '../domain/public-leaderboard';

export interface PublicLeaderboardClient {
  readonly load: (eventId: string, signal: AbortSignal, kind?: PublicLeaderboardKind) => Promise<PublicLeaderboardSummary>;
}
