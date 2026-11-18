export interface EventHandicapRefreshResult {
  readonly eventId: string;
  readonly playerId: string;
  readonly etag: string;
  readonly updatedRoundIds: readonly string[];
  readonly completedRoundIds: readonly string[];
}
