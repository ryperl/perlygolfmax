import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { demoTrip } from '../../demo/trip';
import { TripOverview } from './TripOverview';

describe('TripOverview', () => {
  it('shows the provided trip and opening round without calculating results', () => {
    render(<TripOverview trip={demoTrip} />);
    expect(screen.getByRole('heading', { name: demoTrip.name })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Windward Dunes' })).toBeVisible();
    expect(screen.getByText(/Sample tee time/)).toBeVisible();
    expect(screen.getByRole('region', { name: 'Demo trip at a glance' })).toHaveTextContent('12golfers05rounds');
  });

  it('handles an empty itinerary and group without assuming a first round', () => {
    render(<TripOverview trip={{ ...demoTrip, rounds: [], golfers: [] }} />);
    expect(screen.getByRole('heading', { name: 'No rounds scheduled' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Demo trip at a glance' })).toHaveTextContent('00golfers00rounds');
    expect(screen.queryByText(/Sample tee time/)).not.toBeInTheDocument();
  });
});
