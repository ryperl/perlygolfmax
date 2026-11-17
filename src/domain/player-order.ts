const names = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const suffix = /^(?:jr\.?|sr\.?|ii|iii|iv|v)$/i;

function familyName(displayName: string): string {
  const [beforeComma, afterComma] = displayName.split(',');
  if (afterComma !== undefined && !suffix.test(afterComma.trim())) return beforeComma?.trim() ?? displayName;
  const parts = (beforeComma ?? displayName).trim().split(/\s+/);
  if (parts.length > 1 && suffix.test(parts.at(-1) ?? '')) parts.pop();
  return parts.at(-1) ?? displayName;
}

/** Display names have no structured surname; use Last, First or the final name component. */
export function comparePlayerNames(
  left: { readonly id: string; readonly displayName: string },
  right: { readonly id: string; readonly displayName: string },
): number {
  return names.compare(familyName(left.displayName), familyName(right.displayName))
    || names.compare(left.displayName, right.displayName) || left.id.localeCompare(right.id, 'en');
}
