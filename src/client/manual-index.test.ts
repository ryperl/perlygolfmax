import { describe, expect, it } from 'vitest';
import { defaultManualIndex } from './manual-index';

describe('manual HI entry defaults', () => {
  it('uses the operator local calendar day, preserves explicit plus and scratch, and labels the manual source GHIN', () => {
    expect(defaultManualIndex(' +1.2 ', new Date(2026, 0, 2, 23, 59))).toEqual({
      value: '+1.2', effectiveDate: '2026-01-02', source: 'GHIN',
    });
    expect(defaultManualIndex('0', new Date(2026, 0, 3, 0, 1))).toEqual({
      value: '0', effectiveDate: '2026-01-03', source: 'GHIN',
    });
  });
});
