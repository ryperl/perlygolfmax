import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { demoTrip } from '../../demo/trip';
import { GroupView } from './GroupView';

describe('GroupView', () => {
  it('renders all fictional golfers without real identity or handicap fields', () => {
    render(<GroupView golfers={demoTrip.golfers} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
    expect(screen.getByRole('heading', { name: 'Alex Fairway' })).toBeVisible();
    expect(screen.getByText(/No real identities/)).toBeVisible();
    expect(screen.getByText(/planned, not connected/)).toBeVisible();
  });

  it('handles an empty group without invitation controls', () => {
    render(<GroupView golfers={[]} />);
    expect(screen.getByText('No golfers in this demo group.')).toBeVisible();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
