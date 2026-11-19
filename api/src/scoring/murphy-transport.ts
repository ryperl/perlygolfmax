import type { HttpRequest } from '@azure/functions';
import { isRecord } from '../../../src/contracts/events.js';
import { isRoundScores, isScoreChange } from '../../../src/contracts/scoring.js';
import { murphyRoundScores, murphyScoreChange } from '../../../src/domain/murphy-transport.js';

export const supportsMurphyTargets = (request: HttpRequest): boolean => request.query.get('murphy') === 'score-v1';
export const supportsPareeTargets = (request: HttpRequest): boolean => request.query.get('paree') === 'score-v1';

/** Also covers nested leaderboard/source wrappers without assuming that every response is a bare round. */
export function murphyTransport(value: unknown, negotiated: boolean, pareeTargets = false): unknown {
  if (Array.isArray(value)) return value.map((entry: unknown) => murphyTransport(entry, negotiated, pareeTargets));
  if (!isRecord(value)) return value;
  if (isRoundScores(value)) return murphyRoundScores(value, negotiated, pareeTargets);
  if (isRecord(value.round) && isRoundScores(value.round)) return {
    ...value, round: murphyRoundScores(value.round, negotiated, pareeTargets),
    ...(isScoreChange(value.change) ? { change: murphyScoreChange(value.change, negotiated, value.round, pareeTargets) } : {}),
  };
  if (isScoreChange(value)) return murphyScoreChange(value, negotiated, undefined, pareeTargets);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, murphyTransport(entry, negotiated, pareeTargets)]));
}
