import { describe, expect, it } from 'vitest';
import type { HoleScore } from '../../domain/scoring';
import { savedGrossProgress, savedGrossProgressLabel } from './saved-gross-progress';

const layout = [{ number: 1, par: 4 }, { number: 2, par: 3 }, { number: 3, par: 5 }];
const card = (scores: readonly { readonly number: number; readonly score: HoleScore }[]) => ({ holes: scores });
const numeric = (number: number, strokes: number) => ({ number, score: { kind: 'strokes' as const, strokes } });

describe('saved numeric gross progress', () => {
  it.each([[4, 'Thru 1 E'], [6, 'Thru 1 +2'], [2, 'Thru 1 -2']] as const)(
    'formats %i saved strokes against par without a game allowance', (strokes, expected) => {
      expect(savedGrossProgressLabel(savedGrossProgress(card([numeric(1, strokes)]), layout))).toBe(expected);
    },
  );
  it('counts noncontiguous numeric holes, not missing holes or the selected entry cursor', () => {
    expect(savedGrossProgress(card([numeric(3, 4), numeric(1, 4)]), layout)).toEqual({ holesScored: 2, toPar: -1 });
    expect(savedGrossProgress(card([numeric(1, 4)]), [{ number: 1, par: 5 }])).toEqual({ holesScored: 1, toPar: -1 });
  });
  it('omits pickup, X7, DNF and unplayed holes without inventing strokes or par', () => {
    const saved = card([numeric(1, 6), { number: 2, score: { kind: 'picked-up', reportedStrokes: 7 } },
      { number: 3, score: { kind: 'did-not-finish' } }]);
    expect(savedGrossProgressLabel(savedGrossProgress(saved, layout))).toBe('Thru 1 +2');
    expect(savedGrossProgressLabel(savedGrossProgress(card([{ number: 1, score: { kind: 'unplayed' } },
      { number: 2, score: { kind: 'picked-up' } }]), layout))).toBe('Thru 0 —');
    expect(savedGrossProgressLabel(savedGrossProgress(card([]), layout))).toBe('Thru 0 —');
  });
  it('does not present malformed or missing personal layouts as even par', () => {
    const saved = card([numeric(1, 4)]);
    for (const invalid of [[], [{ number: 2, par: 3 }], [{ number: 1, par: NaN }],
      [{ number: 1, par: 0 }], [{ number: 1, par: 4 }, { number: 1, par: 4 }]]) {
      expect(savedGrossProgress(saved, invalid)).toEqual({ holesScored: 1, toPar: null });
    }
    expect(savedGrossProgress(card([numeric(1, 4), numeric(1, 5)]), layout).toPar).toBeNull();
  });
  it('fails closed on unsafe strokes or arithmetic overflow rather than publishing a rounded total', () => {
    expect(savedGrossProgress(card([numeric(1, Number.MAX_SAFE_INTEGER + 1)]), layout).toPar).toBeNull();
    expect(savedGrossProgress(card([numeric(1, Number.MAX_SAFE_INTEGER), numeric(2, 20)]), layout).toPar).toBeNull();
    expect(savedGrossProgress(card([numeric(1, -1)]), layout).toPar).toBeNull();
  });
});
