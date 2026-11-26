/**
 * Linked Dots takes its sides and money from a base game instead of settling alone:
 * - Wolf version 2: two pairs that change each hole (the existing model);
 * - Nines: the group's three golfers, each playing alone on every hole.
 * The base game settles once for both, at its own stake.
 */
import type { DotHoleContext } from './dot-context.js';
import type { DotsGameDefinition } from './dots.js';
import type { RoundGameDefinition } from './games.js';
import type { NinesGameDefinition } from './nines.js';
import { ninesPlayerCount } from './nines.js';
import type { RoundGroup } from './setup.js';

/** Specials that need partners or Wolf's High/Low cannot work when every golfer plays alone. */
export function ninesLinkSpecialsSupported(dots: DotsGameDefinition): boolean {
  const kinds = dots.specials.map((special) => special.kind);
  const automaticSweep = kinds.includes('sweep') && dots.sweepRule !== 'manual-v1';
  return !kinds.includes('assassin') && !automaticSweep;
}

/** The Nines game this Dots game is linked to, when the link is complete and valid. */
export function linkedNinesGame(dots: DotsGameDefinition, games: readonly RoundGameDefinition[],
  groups: readonly RoundGroup[]): NinesGameDefinition | undefined {
  if (dots.mode !== 'linked') return undefined;
  const base = games.find((game) => game.id === dots.linkedGameId);
  if (base?.kind !== 'nines') return undefined;
  const sameGolfers = dots.playerIds.length === ninesPlayerCount
    && base.playerIds.every((id) => dots.playerIds.includes(id));
  const onlyLink = games.filter((game) => game.kind === 'dots' && game.mode === 'linked'
    && game.linkedGameId === base.id).length === 1;
  const group = groups.find((entry) => entry.number === base.groupNumber);
  const groupStillMatches = group !== undefined && group.playerIds.length === ninesPlayerCount
    && group.playerIds.every((id) => base.playerIds.includes(id));
  const valid = dots.groupNumber === base.groupNumber && sameGolfers && onlyLink && groupStillMatches
    && ninesLinkSpecialsSupported(dots);
  return valid ? base : undefined;
}

/** Each hole of a Nines-linked Dots game: ready, every golfer alone, single value. */
export function ninesDotsContexts(nines: NinesGameDefinition, holeNumbers: readonly number[]): readonly DotHoleContext[] {
  return holeNumbers.map((number) => ({
    number, status: 'ready', multiplier: 1, sourceGameId: nines.id,
    sides: nines.playerIds.map((playerId) => [playerId]),
  }));
}

/** Contexts that mark every hole unavailable, for a link that is missing, invalid or duplicated. */
export function unavailableLinkedContexts(holeNumbers: readonly number[]): readonly DotHoleContext[] {
  return holeNumbers.map((number) => ({ number, status: 'unavailable', sides: [], multiplier: 1,
    reason: 'Linked game is missing, incompatible or duplicated.' }));
}
