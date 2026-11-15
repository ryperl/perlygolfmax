import type { KpConfiguration, KpDecision, KpEntry, KpSelection } from '../domain/kp.js';
import { isEventRevision, isRecord, isUuid } from './events.js';

function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).length === allowed.length && allowed.every((key) => Object.hasOwn(value, key));
}
const money = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const ids = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every(isUuid)
  && new Set(value).size === value.length;

export function isKpEntry(value: unknown): value is KpEntry | null {
  return value === null || isRecord(value) && (value.kind === 'no-measurement' && keys(value, ['kind'])
    || value.kind === 'measured' && keys(value, ['kind', 'inches', 'onGreen', 'measurementId'])
      && money(value.inches) && value.onGreen === true && isUuid(value.measurementId));
}
export function isKpDecision(value: unknown): value is KpDecision {
  return isRecord(value) && keys(value, ['holeNumber', 'proof', 'kind', 'playerIds', 'holeAmountMinor', 'extraCentPlayerIds'])
    && typeof value.holeNumber === 'number' && Number.isInteger(value.holeNumber) && value.holeNumber >= 1 && value.holeNumber <= 18
    && typeof value.proof === 'string' && value.proof.length > 0
    && (value.kind === 'winner' || value.kind === 'split') && ids(value.playerIds) && value.playerIds.length > 0
    && (value.kind !== 'winner' || value.playerIds.length === 1) && money(value.holeAmountMinor) && ids(value.extraCentPlayerIds);
}
export function isKpSelection(value: unknown): value is KpSelection {
  return isRecord(value) && keys(value, ['version', 'context', 'status', 'decisions']) && value.version === 1
    && typeof value.context === 'string' && value.context.length > 0
    && (value.status === 'open' || value.status === 'closed')
    && Array.isArray(value.decisions) && value.decisions.length <= 18 && value.decisions.every(isKpDecision)
    && new Set(value.decisions.map((decision: KpDecision) => decision.holeNumber)).size === value.decisions.length;
}
export function isKpConfiguration(value: unknown): value is KpConfiguration {
  if (!isRecord(value) || !isEventRevision(value.etag)) return false;
  const { etag: _etag, ...selection } = value;
  void _etag;
  return isKpSelection(selection);
}
