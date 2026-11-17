import { describe, expect, it } from 'vitest';
import { churchyCount, validChurchyCounts } from './churchy-counts';

describe('Churchy count draft validation', () => {
  it.each(['', '-1', '1.5', 'many', '1e2', 'Infinity', '9007199254740992'])('retains invalid %s as invalid rather than zero', (text) => {
    expect(churchyCount(text)).toBeNull();
    expect(validChurchyCounts({ sandyCount: text, otherDots: '0' })).toBe(false);
    expect(validChurchyCounts({ sandyCount: '0', otherDots: text })).toBe(false);
  });
  it('accepts safe nonnegative whole counts including repeated occurrences', () => {
    expect(churchyCount('0')).toBe(0);
    expect(churchyCount('3')).toBe(3);
    expect(churchyCount(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(validChurchyCounts({ sandyCount: '2', otherDots: '4' })).toBe(true);
  });
});
