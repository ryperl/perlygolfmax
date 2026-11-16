import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fictionalPurse } from '../../../tests/smoke/purse-fixture-data';
import { publicPurseSummary } from '../../domain/public-purse';
import { purseTestId } from '../../domain/purse.test-support';
import { PublicPurseResults } from './PublicPurseResults';

describe('compact public purse', () => {
  it('shows only player, awarded amount and winning pools, retaining zero winners without projected/budget fields', () => {
    render(<PublicPurseResults value={publicPurseSummary(fictionalPurse())} />);
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Player / pools won', 'Won (USD)']);
    const table = screen.getByRole('table');
    expect(within(table).getByRole('row', { name: /Fictional golfer 1/ })).toHaveTextContent('1.00');
    const zero = within(table).getByRole('row', { name: /Fictional golfer 4/ });
    expect(zero).toHaveTextContent('0.00');
    expect(within(zero).queryByRole('list', { name: 'Pools won' })).not.toBeInTheDocument();
    expect(screen.queryByText(/projected|planned budget|reserved|remaining unscheduled|per-pool breakdown/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit purse|Save purse/ })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Results calculated' })).toBeVisible();
  });
  it('filters pools by course or event-wide, keeping event winnings stable and selected course across refresh', () => {
    const summary = publicPurseSummary(fictionalPurse());
    const first = summary.pools[0];
    if (!first) throw new Error('Missing fictional pool');
    const secondId = purseTestId(2001);
    const next = { ...summary, rounds: [...summary.rounds, { id: secondId, label: 'Fictional second course' }],
      pools: [...summary.pools, { ...first, id: purseTestId(5001), name: 'Fictional second prizes', roundId: secondId },
        { ...first, id: purseTestId(5002), name: 'Fictional overall prizes', roundId: null }] };
    const view = render(<PublicPurseResults value={next} />);
    const picker = screen.getByRole('combobox', { name: 'Course' });
    const region = screen.getByRole('region', { name: 'Course prize pools' });
    expect(within(region).getByText('Fictional awards')).toBeVisible();
    expect(within(region).queryByText('Fictional second prizes')).not.toBeInTheDocument();
    fireEvent.change(picker, { target: { value: secondId } });
    expect(within(region).getByText('Fictional second prizes')).toBeVisible();
    expect(within(region).queryByText('Fictional awards')).not.toBeInTheDocument();
    view.rerender(<PublicPurseResults value={{ ...next, needsReview: true }} />);
    expect(picker).toHaveValue(secondId);
    expect(within(screen.getByRole('table')).getByRole('row', { name: /Fictional golfer 1/ })).toHaveTextContent('1.00');
    fireEvent.change(picker, { target: { value: 'event' } });
    expect(within(region).getByText('Fictional overall prizes')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('known awards only');
  });
  it('keeps pending/unavailable and missing pools explicit, without inventing prizes or currency', () => {
    const summary = publicPurseSummary(fictionalPurse());
    const view = render(<PublicPurseResults value={{ ...summary,
      pools: summary.pools.map((pool) => ({ ...pool, status: 'pending' })) }} />);
    expect(screen.getByRole('img', { name: 'Awaiting results' })).toBeVisible();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'event' } });
    expect(screen.getByText('No purse pools configured for the event.')).toBeVisible();
    view.rerender(<PublicPurseResults value={{ ...summary, needsReview: true,
      pools: summary.pools.map((pool) => ({ ...pool, status: 'unavailable' })) }} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: summary.rounds[0]?.id } });
    expect(screen.getByRole('img', { name: 'Results unavailable' })).toBeVisible();
    view.rerender(<PublicPurseResults value={{ ...summary, currency: null, pools: [] }} />);
    expect(screen.getByText('No purse configured.')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
