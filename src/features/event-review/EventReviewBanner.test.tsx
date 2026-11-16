import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EventReviewBanner } from './EventReviewBanner';

describe('compact organizer attention notice', () => {
  it('announces the issue count, exposes actionable reasons on demand and disappears when resolved', async () => {
    const view = render(<EventReviewBanner notices={[
      { code: 'kp-tie', label: 'Fictional round' }, { code: 'budget-exceeded', label: 'Event purse' },
    ]} />);
    expect(screen.getByRole('status')).toHaveTextContent('Organizer review needed · 2');
    expect(screen.getByText(/Resolve the closest-to-pin tie/)).not.toBeVisible();
    await userEvent.click(screen.getByText('Organizer review needed · 2'));
    expect(screen.getByText(/Resolve the closest-to-pin tie/)).toBeVisible();
    expect(screen.getByText(/Purse exceeds its budget/)).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    view.rerender(<EventReviewBanner notices={[]} />);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });
});
