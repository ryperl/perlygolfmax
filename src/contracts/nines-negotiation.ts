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

interface GameScan {
  readonly ninesIds: Set<unknown>;
  readonly linkedTargets: unknown[];
  threeGolferLink: boolean;
}

function scanGames(value: unknown, scan: GameScan): void {
  if (Array.isArray(value)) {
    for (const entry of value) scanGames(entry, scan);
    return;
  }
  if (!isRecord(value)) return;
  if (value.kind === 'nines') scan.ninesIds.add(value.id);
  if (value.kind === 'dots' && value.mode === 'linked') {
    scan.linkedTargets.push(value.linkedGameId);
    // Wolf needs four golfers, so a three-golfer linked Dots can only be a Nines link.
    if (Array.isArray(value.playerIds) && value.playerIds.length === 3) scan.threeGolferLink = true;
  }
  for (const entry of Object.values(value)) scanGames(entry, scan);
}

/**
 * True when a value holds a Dots game linked to Nines: its linked game ID names a Nines game in the
 * same value, whatever its golfer count (so stale or invalid links are covered too), or it has the
 * three golfers only a Nines link can have.
 */
export function containsNinesLinkedDots(value: unknown): boolean {
  const scan: GameScan = { ninesIds: new Set(), linkedTargets: [], threeGolferLink: false };
  scanGames(value, scan);
  return scan.threeGolferLink || scan.linkedTargets.some((target) => scan.ninesIds.has(target));
}

/** Removes `nines` from advertised game kinds, for clients that do not understand it. */
export function withoutNinesGameKind<Kind extends string>(kinds: readonly Kind[]): readonly Exclude<Kind, 'nines'>[] {
  return kinds.filter((kind): kind is Exclude<Kind, 'nines'> => kind !== 'nines');
}
