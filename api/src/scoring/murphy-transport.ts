import type { HttpRequest } from '@azure/functions';
import { isRecord } from '../../../src/contracts/events.js';
import { isRoundScores, isScoreChange } from '../../../src/contracts/scoring.js';
import { DotsCallsClientUpdateRequired, murphyRoundScores, murphyScoreChange } from '../../../src/domain/murphy-transport.js';
import { stringRoundScores, StringRulesClientUpdateRequired } from '../../../src/contracts/string-rules.js';
import { categorySweepRoundScores, CategorySweepsClientUpdateRequired } from '../../../src/contracts/category-sweeps.js';

export const supportsMurphyTargets = (request: HttpRequest): boolean => request.query.get('murphy') === 'score-v1';
export const supportsPareeTargets = (request: HttpRequest): boolean => request.query.get('paree') === 'score-v1';
export const supportsDotsCalls = (request: HttpRequest): boolean => {
  const modes = request.query.getAll('dotsCalls');
  if (modes.length === 0) return false;
  if (modes.length !== 1 || modes[0] !== 'score-v1') throw new DotsCallsClientUpdateRequired();
  return true;
};
export function supportsStringRules(request: HttpRequest): boolean {
  const versions = request.query.getAll('stringRules');
  if (versions.length === 0) return false;
  if (versions.length !== 1 || versions[0] !== '2') throw new StringRulesClientUpdateRequired();
  return true;
}

export function supportsCategorySweeps(request: HttpRequest): boolean {
  const versions = request.query.getAll('categorySweeps');
  if (versions.length === 0) return false;
  if (versions.length !== 1 || versions[0] !== '1') throw new CategorySweepsClientUpdateRequired();
  return true;
}

/** Also covers nested leaderboard/source wrappers without assuming that every response is a bare round. */
export function murphyTransport(value: unknown, negotiated: boolean, pareeTargets = false, stringRules = false, dotsCalls = false, categorySweeps = false): unknown {
  if (Array.isArray(value)) return value.map((entry: unknown) => murphyTransport(entry, negotiated, pareeTargets, stringRules, dotsCalls, categorySweeps));
  if (!isRecord(value)) return value;
  if (isRoundScores(value)) return categorySweepRoundScores(stringRoundScores(murphyRoundScores(value, negotiated, pareeTargets, dotsCalls), stringRules), categorySweeps);
  if (isRecord(value.round) && isRoundScores(value.round)) return {
    ...value, round: categorySweepRoundScores(stringRoundScores(murphyRoundScores(value.round, negotiated, pareeTargets, dotsCalls), stringRules), categorySweeps),
    ...(isScoreChange(value.change) ? { change: murphyScoreChange(value.change, negotiated, value.round, pareeTargets, dotsCalls) } : {}),
  };
  if (isScoreChange(value)) {
    if (!categorySweeps && value.dotAwardAudit?.some((audit) => audit.dotsCategorySweepsVersion === 1)) {
      throw new CategorySweepsClientUpdateRequired();
    }
    if (!stringRules && value.dotAwardAudit?.some((audit) => audit.stringRulesVersion === 2)) {
      throw new StringRulesClientUpdateRequired();
    }
    return murphyScoreChange(value, negotiated, undefined, pareeTargets, dotsCalls);
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, murphyTransport(entry, negotiated, pareeTargets, stringRules, dotsCalls, categorySweeps)]));
}
