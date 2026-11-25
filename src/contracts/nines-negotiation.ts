/**
 * Browsers built before Nines reject unknown game kinds, so the API only sends Nines data to
 * clients that ask for it with `nines=1`. Older clients reading a round that contains Nines get a
 * clear "refresh to update" (426) instead of a broken page, and never see `nines` advertised.
 */
import { isRecord } from './events.js';

export const ninesQuery = 'nines=1';

export const ninesClientUpdateMessage = 'Refresh to update before using Nines.';
export const ninesClientUpdateCode = 'NINES_CLIENT_UPDATE_REQUIRED';

/** True when a value holds a Nines game definition or result anywhere inside it. */
export function containsNinesGame(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsNinesGame);
  if (!isRecord(value)) return false;
  if (value.kind === 'nines') return true;
  return Object.values(value).some(containsNinesGame);
}

/** Removes `nines` from advertised game kinds, for clients that do not understand it. */
export function withoutNinesGameKind<Kind extends string>(kinds: readonly Kind[]): readonly Exclude<Kind, 'nines'>[] {
  return kinds.filter((kind): kind is Exclude<Kind, 'nines'> => kind !== 'nines');
}
