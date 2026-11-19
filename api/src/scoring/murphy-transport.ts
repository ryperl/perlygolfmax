import type { HttpRequest } from '@azure/functions';
import { isRecord } from '../../../src/contracts/events.js';
import { isRoundScores, isScoreChange } from '../../../src/contracts/scoring.js';
import { murphyRoundScores, murphyScoreChange } from '../../../src/domain/murphy-transport.js';

export const supportsMurphyTargets = (request: HttpRequest): boolean => request.query.get('murphy') === 'score-v1';

/** Also covers nested leaderboard/source wrappers without assuming that every response is a bare round. */
export function murphyTransport(value: unknown, negotiated: boolean): unknown {
  if (Array.isArray(value)) return value.map((entry: unknown) => murphyTransport(entry, negotiated));
  if (!isRecord(value)) return value;
  if (isRoundScores(value)) return murphyRoundScores(value, negotiated);
  if (isRecord(value.round) && isRoundScores(value.round)) return {
    ...value, round: murphyRoundScores(value.round, negotiated),
    ...(isScoreChange(value.change) ? { change: murphyScoreChange(value.change, negotiated, value.round) } : {}),
  };
  if (isScoreChange(value)) return murphyScoreChange(value, negotiated);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, murphyTransport(entry, negotiated)]));
}
