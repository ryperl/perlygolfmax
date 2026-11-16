import type { PublicPurseSummary } from '../domain/public-purse';
import type { PurseClient } from './purse';
import type { PlayerWinningsBreakdown } from '../domain/winnings-breakdown';

export interface PublicPurseClient {
  readonly player?: (eventId: string, playerId: string, signal: AbortSignal) => Promise<PlayerWinningsBreakdown>;
  readonly load: (eventId: string, signal: AbortSignal) => Promise<PublicPurseSummary>;
  readonly save: PurseClient['save'];
}
