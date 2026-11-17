export interface ChurchyCountTexts {
  readonly sandyCount: string;
  readonly otherDots: string;
}

export function churchyCount(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

export function validChurchyCounts(counts: ChurchyCountTexts): boolean {
  return churchyCount(counts.sandyCount) !== null && churchyCount(counts.otherDots) !== null;
}
