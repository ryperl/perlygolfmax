import { describe, expect, it } from 'vitest';
import { maximumExactHoleStrokes, sameHoleScore, summarizeGross } from './scoring';
import type { HoleScore } from './scoring';

function holes(scores: readonly HoleScore[]) {
  return scores.map((score, index) => ({ number: index + 1, score }));
}

describe('gross score summaries', () => {
  it('distinguishes recorded numeric strokes from an incomplete final result', () => {
    expect(summarizeGross(holes([
      { kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 5 }, { kind: 'unplayed' },
      { kind: 'picked-up' }, { kind: 'did-not-finish' },
    ]))).toEqual({
      recordedStrokes: 9, numericHoles: 2, recordedHoles: 2, totalHoles: 5,
      unplayedHoles: 1, pickedUpHoles: 1, didNotFinishHoles: 1, completeGross: null,
    });
  });

  it('only declares complete gross when every hole has numeric strokes', () => {
    expect(summarizeGross(holes(Array.from({ length: 18 }, () => ({ kind: 'strokes', strokes: 4 }))))).toMatchObject({
      recordedStrokes: 72, numericHoles: 18, completeGross: 72,
    });
    expect(summarizeGross(holes([{ kind: 'picked-up' }]))).toMatchObject({ recordedStrokes: 0, completeGross: null });
    expect(summarizeGross(holes([{ kind: 'did-not-finish' }]))).toMatchObject({ recordedStrokes: 0, completeGross: null });
    expect(summarizeGross(holes([{ kind: 'unplayed' }]))).toMatchObject({ recordedStrokes: 0, completeGross: null });
    expect(summarizeGross(holes([
      ...Array.from({ length: 17 }, (): HoleScore => ({ kind: 'strokes', strokes: 4 })),
      { kind: 'picked-up' },
    ]))).toMatchObject({ recordedStrokes: 68, numericHoles: 17, pickedUpHoles: 1, completeGross: null });
    expect(summarizeGross([]).completeGross).toBeNull();
  });

  it('keeps accepted numeric summaries exact without defining a golf scoring cap', () => {
    const result = summarizeGross(holes(Array.from({ length: 18 }, () => ({ kind: 'strokes', strokes: maximumExactHoleStrokes }))));
    expect(Number.isSafeInteger(result.recordedStrokes)).toBe(true);
    expect(result.completeGross).toBe(maximumExactHoleStrokes * 18);
  });

  it('compares explicit score states rather than conflating unplayed, pickup, DNF or zero', () => {
    expect(sameHoleScore({ kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 4 })).toBe(true);
    expect(sameHoleScore({ kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 5 })).toBe(false);
    expect(sameHoleScore({ kind: 'unplayed' }, { kind: 'picked-up' })).toBe(false);
    expect(sameHoleScore({ kind: 'picked-up' }, { kind: 'did-not-finish' })).toBe(false);
    expect(sameHoleScore({ kind: 'unplayed' }, { kind: 'unplayed' })).toBe(true);
    expect(sameHoleScore({ kind: 'picked-up', reportedStrokes: 7 }, { kind: 'picked-up', reportedStrokes: 8 })).toBe(false);
    expect(sameHoleScore({ kind: 'picked-up', reportedStrokes: 7 }, { kind: 'strokes', strokes: 7 })).toBe(false);
    expect(sameHoleScore({ kind: 'picked-up' }, { kind: 'picked-up', reportedStrokes: 7 })).toBe(false);
  });

  it('includes X7 in recorded totals but never treats it as a completed numeric hole', () => {
    const result = summarizeGross(holes([
      ...Array.from({ length: 17 }, (): HoleScore => ({ kind: 'strokes', strokes: 4 })),
      { kind: 'picked-up', reportedStrokes: 7 },
    ]));
    expect(result).toMatchObject({
      recordedStrokes: 75, numericHoles: 17, recordedHoles: 18, pickedUpHoles: 1, completeGross: null,
    });
    expect(summarizeGross(holes([{ kind: 'picked-up' }]))).toMatchObject({ recordedStrokes: 0, recordedHoles: 0, completeGross: null });
  });
});
