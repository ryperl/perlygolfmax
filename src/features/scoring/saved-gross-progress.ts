import type { CourseHole } from '../../domain/catalog';
import type { Scorecard } from '../../domain/scoring';

export interface SavedGrossProgress {
  readonly holesScored: number;
  readonly toPar: number | null;
}

export function savedGrossProgress(
  card: Pick<Scorecard, 'holes'>,
  layout: readonly Pick<CourseHole, 'number' | 'par'>[],
): SavedGrossProgress {
  const numeric = card.holes.filter((hole) => hole.score.kind === 'strokes');
  const holesScored = numeric.length;
  if (layout.length === 0 || new Set(layout.map((hole) => hole.number)).size !== layout.length
    || layout.some((hole) => !Number.isSafeInteger(hole.number) || hole.number < 1
      || !Number.isSafeInteger(hole.par) || hole.par < 1)
    || new Set(card.holes.map((hole) => hole.number)).size !== card.holes.length) return { holesScored, toPar: null };
  let total = 0;
  for (const hole of numeric) {
    const par = layout.find((entry) => entry.number === hole.number)?.par;
    if (hole.score.kind !== 'strokes' || par === undefined
      || !Number.isSafeInteger(hole.score.strokes) || hole.score.strokes < 1) return { holesScored, toPar: null };
    const relative = hole.score.strokes - par;
    total += relative;
    if (!Number.isSafeInteger(relative) || !Number.isSafeInteger(total)) return { holesScored, toPar: null };
  }
  return { holesScored, toPar: holesScored === 0 ? null : total };
}

export function savedGrossProgressLabel(progress: SavedGrossProgress): string {
  const score = progress.toPar === null ? '—' : progress.toPar === 0 ? 'E'
    : progress.toPar > 0 ? `+${String(progress.toPar)}` : String(progress.toPar);
  return `Thru ${String(progress.holesScored)} ${score}`;
}
