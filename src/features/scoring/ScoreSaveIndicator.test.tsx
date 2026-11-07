import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScoreSaveIndicator } from './ScoreSaveIndicator';

describe('compact score feedback', () => {
  it.each([
    ['idle', 0, 'No unsaved scores'],
    ['saved', 0, 'Scores saved'],
    ['unsaved', 2, '2 unsaved scores'],
    ['working', 1, 'Updating scores; 1 unsaved score'],
    ['attention', 0, 'Scores need attention'],
  ] as const)('labels %s feedback without implying a completed round', (state, unsavedCount, label) => {
    render(<ScoreSaveIndicator state={state} unsavedCount={unsavedCount} />);
    const indicator = screen.getByRole('status', { name: label });
    expect(indicator).toHaveAttribute('data-state', state);
    expect(indicator).toHaveAttribute('aria-live', 'polite');
    expect(indicator.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(indicator.querySelector('.score-indicator-count')?.textContent ?? '').toBe(unsavedCount > 0 ? String(unsavedCount) : '');
  });
});
