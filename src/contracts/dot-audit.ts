import type { DotAward } from '../domain/dot-context.js';
import type { DotAwardAudit } from '../domain/dot-audit.js';
import { isRecord, isUuid, isEventRevision } from './events.js';
import { isRoundGameDefinition } from './games.js';
import { hasIndependentSweep } from './sweep-rules.js';

function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 8192; }

export function isDotAward(value: unknown): value is DotAward {
  return isRecord(value)
    && Object.keys(value).length === 13 && ['id', 'number', 'kind', 'source', 'earnedBy', 'recipientIds', 'units',
      'count', 'multiplier', 'dots', 'sourceHoles', 'scores', 'reason'].every((key) => Object.hasOwn(value, key))
    && text(value.id) && (value.number === null || integer(value.number) && value.number >= 1 && value.number <= 18)
    && text(value.kind) && ['automatic', 'manual', 'derived'].some((source) => source === value.source)
    && (value.earnedBy === null || isUuid(value.earnedBy))
    && Array.isArray(value.recipientIds) && value.recipientIds.every(isUuid)
    && value.recipientIds.length > 0 && new Set(value.recipientIds).size === value.recipientIds.length
    && integer(value.units) && integer(value.count) && integer(value.multiplier)
    && [1, 2, 3].includes(value.multiplier) && integer(value.dots)
    && BigInt(value.units) * BigInt(value.count) * BigInt(value.multiplier) === BigInt(value.dots)
    && Array.isArray(value.sourceHoles) && value.sourceHoles.every((hole: unknown) => integer(hole) && hole >= 1 && hole <= 18)
    && Array.isArray(value.scores) && value.scores.every((score: unknown) => isRecord(score) && Object.keys(score).length === 4
      && isUuid(score.playerId) && integer(score.number) && score.number >= 1 && score.number <= 18
      && (score.strokes === null || integer(score.strokes) && score.strokes > 0) && integer(score.par) && score.par > 0)
    && text(value.reason);
}

export function isDotAwardAudit(value: unknown): value is DotAwardAudit {
  return isRecord(value) && Object.keys(value).length === 8
      + (value.stringRulesVersion === undefined ? 0 : 1) + (value.dotsCategorySweepsVersion === undefined ? 0 : 1)
      + (value.sweepRulesVersion === undefined ? 0 : 1)
    && (value.sweepRulesVersion === undefined || value.sweepRulesVersion === 2)
    && (value.dotsCategorySweepsVersion === undefined || value.dotsCategorySweepsVersion === 1)
    && (value.stringRulesVersion === undefined || value.stringRulesVersion === 2) && isUuid(value.gameId)
    && (value.kind === 'dots' || value.kind === 'wolf' || value.kind === 'churchy' && value.version === 3)
    && (value.version === 1 || value.version === 2 || value.version === 3)
    && isRoundGameDefinition(value.configuration) && value.configuration.id === value.gameId
    && (!hasIndependentSweep(value.configuration) || value.sweepRulesVersion === 2)
    && value.configuration.kind === value.kind && value.configuration.version === value.version
    && (value.gameEtag === null || isEventRevision(value.gameEtag))
    && (value.inputRevision === null || isUuid(value.inputRevision))
    && Array.isArray(value.before) && value.before.every(isDotAward)
    && Array.isArray(value.after) && value.after.every(isDotAward);
}
