export const differentialExplanation = '18-hole estimate · PCC assumed 0 · Not official; no GHIN posting or Handicap Index update.';

export function formatDifferential(tenths: number): string {
  const integer = BigInt(tenths);
  const magnitude = integer < 0n ? -integer : integer;
  return `${integer < 0n ? '−' : ''}${String(magnitude / 10n)}.${String(magnitude % 10n)}`;
}
