import type { HttpRequest } from '@azure/functions';
import { isRecord } from '../../../src/contracts/events.js';
import { isRoundScores, isScoreChange } from '../../../src/contracts/scoring.js';
import { DotsCallsClientUpdateRequired, murphyRoundScores, murphyScoreChange } from '../../../src/domain/murphy-transport.js';
import { stringRoundScores, StringRulesClientUpdateRequired } from '../../../src/contracts/string-rules.js';
import { categorySweepRoundScores, CategorySweepsClientUpdateRequired } from '../../../src/contracts/category-sweeps.js';
import { ChurchyNamesClientUpdateRequired, churchyNamesRoundScores, requireChurchyNamesInValue } from '../../../src/contracts/churchy-names.js';
import { SweepRulesClientUpdateRequired, sweepRulesRoundScores, requireSweepRulesInValue } from '../../../src/contracts/sweep-rules.js';
import { coexistenceRoundScores, DotsCoexistenceClientUpdateRequired } from '../../../src/contracts/dot-coexistence.js';
import { gameHandicapRoundScores, GameHandicapClientUpdateRequired, requireGameHandicapRulesInValue } from '../../../src/contracts/game-handicaps.js';
import { GameCalculationsClientUpdateRequired, gameCalculationRoundScores } from '../../../src/contracts/game-calculations.js';
import { requirePullyMurphyTargets } from '../../../src/contracts/pully-murphy.js';
import { WolfOrdersClientUpdateRequired, requireWolfOrdersInValue, wolfOrderRoundScores } from '../../../src/contracts/wolf-orders.js';
import { DotsHighLowClientUpdateRequired, requireDotsHighLowInValue, dotsHighLowRoundScores } from '../../../src/contracts/dots-high-low-rules.js';
import { DotsRulesV3ClientUpdateRequired, requireDotsRulesV3InValue, dotsRulesV3RoundScores } from '../../../src/contracts/dots-rules-v3.js';

export function supportsDotsHighLow(request: HttpRequest): boolean {
  const versions = request.query.getAll('dotsHighLow');
  if (versions.length === 0) return false;
  if (versions.length !== 1 || !['1', '2'].includes(versions[0] ?? '')) throw new DotsHighLowClientUpdateRequired();
  return true;
}

export function supportsDotsRulesV3(request: HttpRequest): boolean {
  const versions = request.query.getAll('dotsRules');
  if (versions.length !== 0 && (versions.length !== 1 || versions[0] !== '3')) throw new DotsRulesV3ClientUpdateRequired();
  supportsDotsHighLow(request);
  return versions.length === 1 && request.query.get('dotsHighLow') === '2';
}

export function supportsWolfOrders(request: HttpRequest): boolean {
  const versions = request.query.getAll('wolfOrders');
  if (versions.length === 0) return false;
  if (versions.length !== 1 || versions[0] !== '1') throw new WolfOrdersClientUpdateRequired();
  return true;
}

export function supportsGameCalculations(request: HttpRequest): boolean {
  const versions = request.query.getAll('gameCalculations');
  if (versions.length === 0) return false;
  if (versions.length !== 1 || versions[0] !== '2') throw new GameCalculationsClientUpdateRequired();
  return true;
}

export function supportsGameHandicaps(request: HttpRequest): boolean {
  const versions = request.query.getAll('gameHandicaps');
  if (versions.length === 0) return false;
  if (versions.length !== 1 || versions[0] !== '1') throw new GameHandicapClientUpdateRequired();
  return true;
}

export function supportsDotCoexistence(request: HttpRequest): boolean {
  const versions = request.query.getAll('dotCoexistence');
  if (versions.length === 0) return false;
  if (versions.length !== 1 || versions[0] !== '2') throw new DotsCoexistenceClientUpdateRequired();
  return true;
}

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

export function supportsChurchyNames(request: HttpRequest): boolean {
  const versions = request.query.getAll('churchyNames');
  if (versions.length === 0) return false;
  if (versions.length !== 1 || versions[0] !== '1') throw new ChurchyNamesClientUpdateRequired();
  return true;
}

export function supportsSweepRules(request: HttpRequest): boolean {
  const versions = request.query.getAll('sweepRules');
  if (versions.length === 0) return false;
  if (versions.length !== 1 || versions[0] !== '2') throw new SweepRulesClientUpdateRequired();
  return true;
}

/** Also covers nested leaderboard/source wrappers without assuming that every response is a bare round. */
export function murphyTransport(value: unknown, negotiated: boolean, pareeTargets = false, stringRules = false, dotsCalls = false, categorySweeps = false, churchyNames = false, sweepRules = false, dotCoexistence = false, gameHandicaps = false, gameCalculations = false, wolfOrders = false, dotsHighLow = false, dotsRulesV3 = false): unknown {
  requireDotsRulesV3InValue(value, dotsRulesV3);
  requireWolfOrdersInValue(value, wolfOrders);
  requireDotsHighLowInValue(value, dotsHighLow);
  requirePullyMurphyTargets(value, gameCalculations);
  if (!gameHandicaps) requireGameHandicapRulesInValue(value);
  if (!sweepRules) requireSweepRulesInValue(value);
  if (!churchyNames) requireChurchyNamesInValue(value);
  return projectTransport(value, negotiated, pareeTargets, stringRules, dotsCalls, categorySweeps, churchyNames, sweepRules, dotCoexistence, gameHandicaps, gameCalculations, wolfOrders, dotsHighLow, dotsRulesV3);
}

function projectTransport(value: unknown, negotiated: boolean, pareeTargets: boolean, stringRules: boolean, dotsCalls: boolean, categorySweeps: boolean, churchyNames: boolean, sweepRules: boolean, dotCoexistence: boolean, gameHandicaps: boolean, gameCalculations: boolean, wolfOrders: boolean, dotsHighLow: boolean, dotsRulesV3: boolean): unknown {
  if (Array.isArray(value)) return value.map((entry: unknown) => projectTransport(entry, negotiated, pareeTargets, stringRules, dotsCalls, categorySweeps, churchyNames, sweepRules, dotCoexistence, gameHandicaps, gameCalculations, wolfOrders, dotsHighLow, dotsRulesV3));
  if (!isRecord(value)) return value;
  if (isRoundScores(value)) return gameHandicapRoundScores(coexistenceRoundScores(sweepRulesRoundScores(churchyNamesRoundScores(categorySweepRoundScores(stringRoundScores(murphyRoundScores(gameCalculationRoundScores(dotsHighLowRoundScores(wolfOrderRoundScores(dotsRulesV3RoundScores(value, dotsRulesV3), wolfOrders), dotsHighLow), gameCalculations), negotiated, pareeTargets, dotsCalls), stringRules), categorySweeps), churchyNames), sweepRules), dotCoexistence), gameHandicaps);
  if (isRecord(value.round) && isRoundScores(value.round)) return {
    ...value, round: gameHandicapRoundScores(coexistenceRoundScores(sweepRulesRoundScores(churchyNamesRoundScores(categorySweepRoundScores(stringRoundScores(murphyRoundScores(gameCalculationRoundScores(dotsHighLowRoundScores(wolfOrderRoundScores(dotsRulesV3RoundScores(value.round, dotsRulesV3), wolfOrders), dotsHighLow), gameCalculations), negotiated, pareeTargets, dotsCalls), stringRules), categorySweeps), churchyNames), sweepRules), dotCoexistence), gameHandicaps),
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
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, projectTransport(entry, negotiated, pareeTargets, stringRules, dotsCalls, categorySweeps, churchyNames, sweepRules, dotCoexistence, gameHandicaps, gameCalculations, wolfOrders, dotsHighLow, dotsRulesV3)]));
}
