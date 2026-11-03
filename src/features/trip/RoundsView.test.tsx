import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { demoTrip } from '../../demo/trip';
import { RoundsView } from './RoundsView';

describe('RoundsView', () => {
  it('renders every sample round in fixture order with a non-booking disclosure', () => {
    render(<RoundsView rounds={demoTrip.rounds} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent)).toEqual(demoTrip.rounds.map(({ courseName }) => courseName));
    expect(screen.getAllByText('Sample tee time')).toHaveLength(5);
    expect(screen.getByText(/not confirmed bookings/)).toBeVisible();
  });

  it('shows a meaningful empty state rather than a blank list', () => {
    render(<RoundsView rounds={[]} />);
    expect(screen.getByText('No rounds scheduled yet.')).toBeVisible();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
