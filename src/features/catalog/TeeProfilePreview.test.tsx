import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fictionalProfile } from '../../client/catalog.test-support';
import { TeeProfilePreview } from './TeeProfilePreview';

describe('tee profile hole preview', () => {
  it('opens an accessible preview with source yardage, par, allocation and all rating sections', async () => {
    const user = userEvent.setup();
    render(<TeeProfilePreview profile={fictionalProfile} />);
    const summary = screen.getByText(/Fictional Teal \/ Fictional A/);
    expect(summary.closest('details')).not.toHaveAttribute('open');
    await user.click(summary);
    expect(summary.closest('details')).toHaveAttribute('open');
    const holes = screen.getByRole('table', { name: 'Hole yardage, par and stroke index' });
    const rows = within(holes).getAllByRole('row');
    expect(rows).toHaveLength(11);
    expect(within(rows[1] ?? holes).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['100', '4', '1']);
    expect(within(rows[10] ?? holes).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['900', '36', 'Not applicable']);
    const ratings = screen.getByRole('table', { name: 'Course and slope ratings' });
    expect(within(ratings).getByRole('rowheader', { name: 'Total' })).toBeVisible();
    expect(within(ratings).getByRole('rowheader', { name: 'Front' })).toBeVisible();
    expect(within(ratings).getByRole('rowheader', { name: 'Back' })).toBeVisible();
    expect(screen.getByText(/not a golfer's Handicap Index/)).toBeVisible();
  });

  it('sorts source hole numbers without mutating input or borrowing another profile allocation', async () => {
    const profile = {
      ...fictionalProfile, category: 'Fictional B',
      holes: [...fictionalProfile.holes].reverse().map((hole) => ({ ...hole, allocation: 10 - hole.number })),
    };
    const user = userEvent.setup();
    render(<TeeProfilePreview profile={profile} />);
    await user.click(screen.getByText(/Fictional Teal \/ Fictional B/));
    const rows = within(screen.getByRole('table', { name: 'Hole yardage, par and stroke index' })).getAllByRole('row');
    expect(within(rows[1] ?? document.body).getByRole('rowheader', { name: '1' })).toBeVisible();
    expect(within(rows[1] ?? document.body).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['100', '4', '9']);
    expect(profile.holes[0]?.number).toBe(9);
  });
});
