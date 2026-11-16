import type { PublicPurseSummary } from '../domain/public-purse';
import type { PurseClient } from './purse';

export interface PublicPurseClient {
  readonly load: (eventId: string, signal: AbortSignal) => Promise<PublicPurseSummary>;
  readonly save: PurseClient['save'];
}
