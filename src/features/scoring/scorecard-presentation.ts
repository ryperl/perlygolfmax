import type { CourseHole } from '../../domain/catalog';
import type { Scorecard } from '../../domain/scoring';
import { summarizeGross } from '../../domain/scoring';

export function summarizeCard(card: Scorecard, layout: readonly CourseHole[]) {
  const saved = new Map(card.holes.map((hole) => [hole.number, hole]));
  const entries = layout.flatMap((hole) => {
    const entry = saved.get(hole.number);
    return entry ? [entry] : [];
  });
  const summary = summarizeGross(entries);
  return {
    total: summary.recordedHoles === 0 ? null : summary.recordedStrokes,
    completed: summary.numericHoles,
    missing: entries.length !== layout.length,
    complete: entries.length === layout.length && summary.completeGross !== null,
  };
}

export function cardTotalText(card: Scorecard, layout: readonly CourseHole[]): string {
  const summary = summarizeCard(card, layout);
  return summary.total === null ? '—' : `${String(summary.total)}${summary.complete ? '' : '*'}`;
}
