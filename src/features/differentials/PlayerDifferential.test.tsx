import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RoundDifferential } from '../../domain/round-differential';
import { PlayerDifferential } from './PlayerDifferential';

const value: RoundDifferential = {
  playerId: 'fictional-private-player-id', method: 'estimated-18-hole', pcc: 0,
  status: 'available', differentialTenths: -15, adjustedGross: 70,
};

describe('PlayerDifferential', () => {
  it('presents the supplied signed one-decimal estimate and adjusted gross, not raw audit data or official posting', () => {
    const { container } = render(<PlayerDifferential value={value} />);
    const group = within(screen.getByRole('group', { name: 'Estimated round differential' }));
    expect(group.getByText('−1.5')).toBeVisible();
    expect(group.getByText(/Adjusted gross 70/)).toBeVisible();
    expect(group.getByText(/18-hole estimate · PCC assumed 0 · Not official/)).toBeVisible();
    expect(group.getByText(/no GHIN posting or Handicap Index update/)).toBeVisible();
    expect(container.textContent).not.toContain(value.playerId);
  });

  it('distinguishes a genuine zero from missing, pending and unavailable values through refreshed props', () => {
    const { rerender } = render(<PlayerDifferential value={{ ...value, differentialTenths: 0 }} />);
    expect(screen.getByText('0.0')).toBeVisible();
    rerender(<PlayerDifferential />);
    expect(screen.getByLabelText('Estimated differential unavailable')).toHaveTextContent('—');
    expect(screen.queryByText('0.0')).toBeNull();
    rerender(<PlayerDifferential value={{ ...value, status: 'pending',
      differentialTenths: null, adjustedGross: null, reason: 'incomplete-card' }} />);
    expect(screen.getByLabelText('Estimated differential unavailable')).toHaveTextContent('—');
    rerender(<PlayerDifferential value={{ ...value, status: 'unavailable',
      differentialTenths: null, adjustedGross: null, reason: 'non-numeric-score' }} />);
    expect(screen.getByLabelText('Estimated differential unavailable')).toHaveTextContent('—');
    expect(screen.queryByText(/Pending|Unavailable|Pickup or DNF/)).toBeNull();
    expect(screen.queryByText(/Adjusted gross 70/)).toBeNull();
  });

});
