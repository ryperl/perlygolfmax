import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fictionalProfile } from '../../client/catalog.test-support';
import { TeeProfilePreview, TeeProfileSelector } from './TeeProfilePreview';

describe('tee profile hole preview', () => {
  it('requires an explicit tee selection and renders only that profile, not every tee', async () => {
    const second = { ...fictionalProfile, id: 905, category: 'Fictional B', totalYardage: 1800,
      holes: fictionalProfile.holes.map((hole) => ({ ...hole, length: 200 })) };
    const { container } = render(<TeeProfileSelector profiles={[fictionalProfile, second]} />);
    expect(screen.getByLabelText('Preview tee')).toHaveValue('');
    expect(container.querySelectorAll('.tee-preview')).toHaveLength(0);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Preview tee'), '905');
    expect(container.querySelectorAll('.tee-preview')).toHaveLength(1);
    const summary = screen.getByText(/Fictional Teal \/ Fictional B/, { selector: 'summary' });
    expect(summary).toHaveTextContent('1800 yards');
    expect(summary).toHaveTextContent('Rating 36 / Slope 100');
    await user.click(summary);
    expect(within(screen.getByRole('table', { name: 'Hole yardage, par and stroke index' })).getAllByRole('cell')[0]).toHaveTextContent('200');
    await user.selectOptions(screen.getByLabelText('Preview tee'), '901');
    expect(container.querySelectorAll('.tee-preview')).toHaveLength(1);
    expect(screen.getByText(/Fictional Teal \/ Fictional A/, { selector: 'summary' })).toHaveTextContent('900 yards');
    expect(screen.queryByText(/Fictional Teal \/ Fictional B/, { selector: 'summary' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Preview tee'), '');
    expect(container.querySelectorAll('.tee-preview')).toHaveLength(0);
  });

  it('does not retain an unavailable tee after the profile set changes, and handles an empty course', async () => {
    const { rerender, container } = render(<TeeProfileSelector profiles={[fictionalProfile]} />);
    await userEvent.setup().selectOptions(screen.getByLabelText('Preview tee'), String(fictionalProfile.id));
    rerender(<TeeProfileSelector profiles={[]} />);
    expect(screen.getByLabelText('Preview tee')).toHaveValue('');
    expect(screen.getByText('No tee profiles available.')).toBeVisible();
    expect(container.querySelectorAll('.tee-preview')).toHaveLength(0);
  });
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
