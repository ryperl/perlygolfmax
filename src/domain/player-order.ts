const names = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const suffix = /^(?:jr\.?|sr\.?|ii|iii|iv|v)$/i;

/** A display name split for presentation only: "Last, First" or the final component is the family name. */
export interface DisplayNameParts {
  readonly given: string;
  readonly family: string;
}

/** Display names have no structured surname, so this is a best-effort presentation split, never profile data. */
export function displayNameParts(displayName: string): DisplayNameParts {
  const [beforeComma, afterComma] = displayName.split(',');
  if (afterComma !== undefined && !suffix.test(afterComma.trim())) {
    return { given: afterComma.trim(), family: beforeComma?.trim() ?? displayName };
  }
  const parts = (beforeComma ?? displayName).trim().split(/\s+/);
  if (parts.length > 1 && suffix.test(parts.at(-1) ?? '')) parts.pop();
  const family = parts.pop() ?? displayName;
  return { given: parts.join(' '), family };
}

function familyName(displayName: string): string {
  return displayNameParts(displayName).family;
}

/** Display names have no structured surname; use Last, First or the final name component. */
export function comparePlayerNames(
  left: { readonly id: string; readonly displayName: string },
  right: { readonly id: string; readonly displayName: string },
): number {
  return names.compare(familyName(left.displayName), familyName(right.displayName))
    || names.compare(left.displayName, right.displayName) || left.id.localeCompare(right.id, 'en');
}
