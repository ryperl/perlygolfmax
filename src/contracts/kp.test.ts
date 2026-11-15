import { describe, expect, it } from 'vitest';
import { isHoleScore } from './scoring';
import { isKpEntry, isKpSelection } from './kp';
import { preserveScoreExtras, sameHoleScore } from '../domain/scoring';

const measured = { kind: 'measured', inches: 0, onGreen: true, measurementId: '10000000-0000-4000-8000-000000000001' } as const;
describe('KP transport and raw-only compatibility', () => {
  it('accepts explicit hole-in-one, clear and no measurement, but rejects off-green/fractional/untrusted fields', () => {
    expect(isKpEntry(measured)).toBe(true);
    expect(isKpEntry({ ...measured, onGreen: false })).toBe(false);
    expect(isKpEntry({ ...measured, inches: .5 })).toBe(false);
    expect(isKpEntry({ ...measured, inches: Number.MAX_SAFE_INTEGER + 1 })).toBe(false);
    expect(isKpEntry({ kind: 'no-measurement', inches: 0 })).toBe(false);
    expect(isHoleScore({ kind: 'picked-up', reportedStrokes: 7, kp: measured })).toBe(true);
    expect(isHoleScore({ kind: 'unplayed', kp: null })).toBe(true);
  });
  it('preserves hidden KP on raw edits and differentiates explicit clearing', () => {
    const saved = { kind: 'strokes', strokes: 4, kp: measured } as const;
    expect(preserveScoreExtras({ kind: 'strokes', strokes: 5 }, saved).kp).toEqual(measured);
    expect(preserveScoreExtras({ kind: 'strokes', strokes: 5, kp: null }, saved).kp).toBeNull();
    expect(sameHoleScore(saved, { ...saved, kp: { kind: 'no-measurement' } })).toBe(false);
    expect(isKpSelection({ version: 1, context: 'saved', status: 'closed', decisions: [] })).toBe(true);
    expect(isKpSelection({ version: 1, context: 'saved', status: 'final', decisions: [] })).toBe(false);
  });
});
