export function compareHighLow(kind: 'high' | 'low', a: readonly number[], aSize: number,
  b: readonly number[], bSize: number): {
  readonly status: 'won' | 'tied' | 'unavailable';
  readonly winner: 'a' | 'b' | null;
  readonly aScore: number | null;
  readonly bScore: number | null;
} {
  const high = kind === 'high';
  const aScore = a.length ? high && a.length === aSize ? Math.max(...a) : !high ? Math.min(...a) : null : null;
  const bScore = b.length ? high && b.length === bSize ? Math.max(...b) : !high ? Math.min(...b) : null : null;
  if (aScore === null && bScore === null || !high && (aScore === null || bScore === null)) {
    return { status: 'unavailable', winner: null, aScore, bScore };
  }
  const winner = aScore === null ? 'b' : bScore === null ? 'a' : aScore === bScore ? null : aScore < bScore ? 'a' : 'b';
  return { status: winner === null ? 'tied' : 'won', winner, aScore, bScore };
}
