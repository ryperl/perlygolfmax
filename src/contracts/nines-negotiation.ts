/**
 * Browsers built before Nines reject unknown game kinds, so the API only sends Nines data to
 * clients that ask for it with `nines=1` or `nines=2`. Older clients reading a round that contains Nines get a
 * clear "refresh to update" (426) instead of a broken page, and never see `nines` advertised.
 */
import { isRecord } from './events.js';

/**
 * `nines=1`: the client understands Nines. `nines=2`: it also understands Dots linked to Nines,
 * whose three-golfer linked definition older Nines clients would reject.
 */
export const ninesQuery = 'nines=2';

export const ninesClientUpdateMessage = 'Refresh to update before using Nines.';
export const ninesClientUpdateCode = 'NINES_CLIENT_UPDATE_REQUIRED';

/** True when a value holds a Nines game definition or result anywhere inside it. */
export function containsNinesGame(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsNinesGame);
  if (!isRecord(value)) return false;
  if (value.kind === 'nines') return true;
  return Object.values(value).some(containsNinesGame);
}

/** True when a value holds a Dots game linked to Nines (the only linked Dots with three golfers). */
export function containsNinesLinkedDots(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsNinesLinkedDots);
  if (!isRecord(value)) return false;
  if (value.kind === 'dots' && value.mode === 'linked' && Array.isArray(value.playerIds) && value.playerIds.length === 3) return true;
  return Object.values(value).some(containsNinesLinkedDots);
}

/** Removes `nines` from advertised game kinds, for clients that do not understand it. */
export function withoutNinesGameKind<Kind extends string>(kinds: readonly Kind[]): readonly Exclude<Kind, 'nines'>[] {
  return kinds.filter((kind): kind is Exclude<Kind, 'nines'> => kind !== 'nines');
}
