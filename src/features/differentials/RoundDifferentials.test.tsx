import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RoundDifferential } from '../../domain/round-differential';
import { RoundDifferentials } from './RoundDifferentials';

const players = [
  { playerId: 'fictional-a', displayName: 'Fictional Aspen' },
  { playerId: 'fictional-b', displayName: 'Fictional Birch' },
  { playerId: 'fictional-c', displayName: 'Fictional Cedar' },
  { playerId: 'fictional-d', displayName: 'Fictional Dogwood' },
];
const available: RoundDifferential = {
  playerId: 'fictional-a', method: 'estimated-18-hole', pcc: 0, status: 'available', adjustedGross: 88, differentialTenths: 139,
};

describe('RoundDifferentials', () => {
  it('shows every golfer in roster order without ranking, partial totals or fake zeroes', () => {
    const values: readonly RoundDifferential[] = [
      { ...available, playerId: 'fictional-c', status: 'unavailable', adjustedGross: null,
        differentialTenths: null, reason: 'missing-handicap-index' },
      { ...available, playerId: 'fictional-b', status: 'pending', adjustedGross: null,
        differentialTenths: null, reason: 'incomplete-card' },
      available,
    ];
    const { container } = render(<RoundDifferentials values={values} players={players} />);
    const table = screen.getByRole('table', { name: 'Round differentials' });
    expect(within(table).getAllByRole('columnheader').map((header) => header.getAttribute('aria-label') ?? header.textContent))
      .toEqual(['Golfer', 'Adjusted gross', 'Estimated differential']);
    expect(within(table).getAllByRole('rowheader').map((header) => header.textContent))
      .toEqual(players.map((player) => player.displayName));
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('88');
    expect(rows[0]).toHaveTextContent('13.9');
    expect(rows[1]).toHaveTextContent('—');
    expect(rows[2]).toHaveTextContent('—');
    expect(rows[3]).toHaveTextContent('—');
    expect(within(table).getAllByLabelText('Estimated differential unavailable')).toHaveLength(3);
    expect(table).not.toHaveTextContent(/Pending|Unavailable|numeric hole scores|captured Handicap Index/);
    expect(screen.getAllByLabelText('Adjusted gross unavailable')).toHaveLength(3);
    expect(screen.getAllByText(/18-hole estimate · PCC assumed 0 · Not official/)).toHaveLength(1);
    expect(table).toHaveAccessibleDescription(/no GHIN posting or Handicap Index update/);
    expect(container.textContent).not.toContain('fictional-a');
    expect(screen.queryByRole('columnheader', { name: /rank|position/i })).toBeNull();
    expect(screen.queryByText('0.0')).toBeNull();
  });

  it('uses supplied saved results only and updates incomplete rows after fresh server props', () => {
    const { rerender } = render(<RoundDifferentials values={[available]} players={players.slice(0, 1)} />);
    expect(screen.getByText('13.9')).toBeVisible();
    rerender(<RoundDifferentials values={[{ ...available, differentialTenths: -15, adjustedGross: 70 }]} players={players.slice(0, 1)} />);
    expect(screen.getByText('−1.5')).toBeVisible();
    expect(screen.queryByText('13.9')).toBeNull();
    rerender(<RoundDifferentials values={[{ ...available, differentialTenths: 0 }]} players={players.slice(0, 1)} />);
    expect(screen.getByText('0.0')).toBeVisible();
  });

  it('uses the same dash for unavailable inputs without repeating explanations', () => {
    const values: readonly RoundDifferential[] = [
      { playerId: 'fictional-a', method: 'estimated-18-hole', pcc: 0, status: 'unavailable',
        differentialTenths: null, adjustedGross: null, reason: 'missing-stroke-index' },
      { playerId: 'fictional-b', method: 'estimated-18-hole', pcc: 0, status: 'unavailable',
        differentialTenths: null, adjustedGross: null, reason: 'unsupported-hole-count' },
    ];
    render(<RoundDifferentials values={values} players={players.slice(0, 2)} />);
    expect(screen.getAllByLabelText('Estimated differential unavailable')).toHaveLength(2);
    expect(screen.queryByText(/Captured stroke allocation|Requires an 18-hole round/)).toBeNull();
  });
});
