import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fictionalPurse } from '../../../tests/smoke/purse-fixture-data';
import { publicPurseSummary } from '../../domain/public-purse';
import { purseTestId } from '../../domain/purse.test-support';
import { PublicPurseResults } from './PublicPurseResults';

describe('compact public purse', () => {
  it('orders money won highest first with stable ties, zero amounts before unavailable, without changing the source order', () => {
    const summary = publicPurseSummary(fictionalPurse());
    const [winner, second, zero, otherZero] = summary.players;
    if (!winner || !second || !zero || !otherZero) throw new Error('Missing fictional winnings');
    const unavailable = { ...otherZero, playerId: purseTestId(99), displayName: 'Fictional unavailable', amountMinor: null };
    const players = Object.freeze([zero, second, unavailable, winner, otherZero]);
    render(<PublicPurseResults value={{ ...summary, players }} />);
    const rows = within(screen.getByRole('list', { name: 'Player winnings' })).getAllByRole('article');
    for (const [index, player] of [winner, second, zero, otherZero, unavailable].entries()) {
      expect(rows[index]).toHaveTextContent(player.displayName);
    }
    expect(rows[4]).toHaveTextContent('Unavailable');
    expect(within(screen.getByRole('article', { name: 'Winnings for Fictional unavailable' })).queryByText('No winning pools')).not.toBeInTheDocument();
    expect(players[0]).toBe(zero);
  });
  it('shows only player, awarded amount and winning pools, retaining zero winners without projected/budget fields', () => {
    render(<PublicPurseResults value={publicPurseSummary(fictionalPurse())} />);
    const cards = screen.getByRole('list', { name: 'Player winnings' });
    expect(within(cards).getByRole('article', { name: 'Winnings for Fictional golfer 1' })).toHaveTextContent('1.00');
    const zero = within(cards).getByRole('article', { name: 'Winnings for Fictional golfer 4' });
    expect(zero).toHaveTextContent('0.00');
    expect(within(zero).queryByRole('list', { name: 'Pools won' })).not.toBeInTheDocument();
    expect(within(zero).getByText('No winning pools')).toBeVisible();
    expect(screen.queryByRole('button', { name: /View winnings breakdown/ })).not.toBeInTheDocument();
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
    expect(screen.getByRole('article', { name: 'Winnings for Fictional golfer 1' })).toHaveTextContent('1.00');
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
    expect(screen.queryByRole('list', { name: 'Player winnings' })).not.toBeInTheDocument();
  });
});
