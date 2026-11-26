import { describe, expect, it } from 'vitest';
import { savedGameKindChangeAllowed } from './internal-game-management.js';

describe('savedGameKindChangeAllowed', () => {
  it('keeps a saved game on its own kind', () => {
    for (const kind of ['stableford', 'wolf', 'dots', 'churchy', 'nines'] as const) {
      expect(savedGameKindChangeAllowed(kind, kind)).toBe(true);
    }
  });

  it('never lets an existing game become Wolf, Dots or Churchie', () => {
    expect(savedGameKindChangeAllowed('stableford', 'wolf')).toBe(false);
    expect(savedGameKindChangeAllowed('nines', 'dots')).toBe(false);
    expect(savedGameKindChangeAllowed('wolf', 'churchy')).toBe(false);
  });

  it('never turns Wolf, Dots or Churchie into Nines, but other games may become Nines', () => {
    expect(savedGameKindChangeAllowed('wolf', 'nines')).toBe(false);
    expect(savedGameKindChangeAllowed('dots', 'nines')).toBe(false);
    expect(savedGameKindChangeAllowed('stableford', 'nines')).toBe(true);
  });

  it('still lets saved Wolf, Dots and Nines games become ordinary games, as before', () => {
    expect(savedGameKindChangeAllowed('wolf', 'stableford')).toBe(true);
    expect(savedGameKindChangeAllowed('dots', 'skins')).toBe(true);
    expect(savedGameKindChangeAllowed('nines', 'stroke-play')).toBe(true);
  });
});
