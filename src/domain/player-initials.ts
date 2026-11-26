import { displayNameParts } from './player-order';

interface NamedPlayer {
  readonly playerId: string;
  readonly displayName: string;
}

function letters(text: string): string[] {
  return Array.from(text.trim()).filter((character) => /[\p{L}\p{N}]/u.test(character));
}

/** Given-name initial, then the family name's first `familyLength` letters: RP, then RPe. */
function initials(displayName: string, familyLength: number): string {
  const { given, family } = displayNameParts(displayName);
  const first = letters(given)[0] ?? '';
  const [familyInitial = '', ...rest] = letters(family);
  const extra = rest.slice(0, familyLength - 1).join('').toLocaleLowerCase('en');
  return `${first}${familyInitial}`.toLocaleUpperCase('en') + extra;
}

function familyLetterCount(displayName: string): number {
  return letters(displayNameParts(displayName).family).length;
}

/** Players whose current short name is shared with someone else in the same set. */
function clashingIds(shortNames: ReadonlyMap<string, string>): Set<string> {
  const owners = new Map<string, string[]>();
  for (const [playerId, short] of shortNames) owners.set(short, [...(owners.get(short) ?? []), playerId]);
  return new Set([...owners.values()].filter((ids) => ids.length > 1).flat());
}

/**
 * Short initials for each player in one compact view, unique within that view. Clashing golfers take more
 * letters of their family name (RPe and RPa); identical names fall back to a number in the order given.
 */
export function playerInitials(players: readonly NamedPlayer[]): ReadonlyMap<string, string> {
  const shortNames = new Map(players.map((player) => [player.playerId, initials(player.displayName, 1)]));
  const longestFamily = Math.max(1, ...players.map((player) => familyLetterCount(player.displayName)));
  for (let familyLength = 2; familyLength <= longestFamily; familyLength += 1) {
    const clashing = clashingIds(shortNames);
    if (clashing.size === 0) return shortNames;
    for (const player of players) {
      if (clashing.has(player.playerId)) shortNames.set(player.playerId, initials(player.displayName, familyLength));
    }
  }
  numberRemainingClashes(players, shortNames);
  return shortNames;
}

/** Golfers with identical names can never be told apart by letters, so number them in the order shown. */
function numberRemainingClashes(players: readonly NamedPlayer[], shortNames: Map<string, string>) {
  const clashing = clashingIds(shortNames);
  const seen = new Map<string, number>();
  for (const player of players) {
    if (!clashing.has(player.playerId)) continue;
    const short = shortNames.get(player.playerId) ?? '';
    const position = (seen.get(short) ?? 0) + 1;
    seen.set(short, position);
    shortNames.set(player.playerId, `${short}${String(position)}`);
  }
}
