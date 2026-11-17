export function handicapStrokesForHole(handicap: number, allocation: number, count: number): number {
  const quotient = Math.floor(handicap / count);
  const remainder = handicap - quotient * count;
  return quotient + (allocation <= remainder ? 1 : 0);
}
