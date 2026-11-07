import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScoreActionIcon } from './ScoreActionIcon';

describe('scoring action icons', () => {
  it.each(['cards', 'entry', 'games', 'leaderboard', 'refresh'] as const)('keeps the %s icon decorative and uses its button color', (kind) => {
    const { container } = render(<ScoreActionIcon kind={kind} />);
    const icon = container.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('focusable', 'false');
    expect(icon).toHaveAttribute('stroke', 'currentColor');
    expect(icon).toHaveAttribute('viewBox', '0 0 24 24');
    expect(icon?.querySelectorAll('path, rect').length).toBeGreaterThan(0);
  });
});
