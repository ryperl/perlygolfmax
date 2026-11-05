import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fictionalPurse } from '../../../tests/smoke/purse-fixture-data';
import { calculatePurse } from '../../domain/purse';
import type { PursePlan } from '../../domain/purse';
import { purseTestId } from '../../domain/purse.test-support';
import { PurseResults } from './PurseResults';

describe('PurseResults', () => {
  it('explains money conservation, overcommitment and pooled occupied-place tie remainder without pretending payment', () => {
    const value = fictionalPurse(4, undefined, [4, 5, 5, 6]);
    const original = value.configuration.plan;
    const pool = original?.pools[0];
    if (!original || !pool || !('prizes' in pool)) throw new Error('Missing fictional pool.');
    const plan: PursePlan = { ...original, pools: [{ ...pool, prizes: [
      { place: 1, amountMinor: 100 }, { place: 2, amountMinor: 51 }, { place: 3, amountMinor: 50 },
    ] }] };
    const calculation = calculatePurse(plan, value.workspace, value.roundScores);
    render(<PurseResults value={value} plan={plan} calculation={calculation} />);
    expect(screen.getByText(/exceed the planned budget by USD/)).toHaveTextContent('0.01');
    expect(screen.getByText('Tie remainder').nextElementSibling).toHaveTextContent('0.01');
    expect(screen.getByText('Unallocated').nextElementSibling).toHaveTextContent('0.01');
    expect(screen.getByText(/not payments, transfers, or finalization/)).toBeVisible();
    const table = screen.getByRole('table');
    const second = within(table).getByRole('row', { name: /Fictional golfer 2/ });
    expect(second).toHaveTextContent('0.50');
    expect(within(table).getByRole('row', { name: /Fictional golfer 4/ })).toHaveTextContent('0.00');
    expect(screen.queryByText(purseTestId(9001))).not.toBeInTheDocument();
  });
  it('retains known partial shares while unavailable total differs from a known zero', () => {
    const value = fictionalPurse();
    const original = value.configuration.plan;
    const ranked = original?.pools[0];
    if (!original || !ranked) throw new Error('Missing fictional pool.');
    const plan: PursePlan = { ...original, pools: [ranked, {
      id: purseTestId(5100), name: 'Fictional known side pot', source: { kind: 'manual' }, awardUnit: 'pot',
      amountMinor: 101, recipientIds: value.workspace.roster.slice(0, 3).map((player) => player.playerId),
    }] };
    const calculation = calculatePurse(plan, value.workspace, []);
    render(<PurseResults value={value} plan={plan} calculation={calculation} />);
    expect(screen.getByText(/Some awards are unavailable/)).toBeVisible();
    expect(screen.getByText('Member remainder').nextElementSibling).toHaveTextContent('0.02');
    const first = within(screen.getByRole('table')).getByRole('row', { name: /Fictional golfer 1/ });
    expect(within(first).getAllByRole('cell')[0]).toHaveTextContent('0.33');
    expect(within(first).getAllByRole('cell')[2]).toHaveTextContent('Unavailable');
    expect(first).toHaveTextContent('Fictional awards: Unavailable');
  });
  it.each(['two-net-better-ball', 'four-two-net'] as const)('attributes %s awards to each member and labels team units', (format) => {
    const value = fictionalPurse(8, format, [4]);
    const plan = value.configuration.plan;
    if (!plan) throw new Error('Missing fictional plan.');
    render(<PurseResults value={value} plan={plan} calculation={calculatePurse(plan, value.workspace, value.roundScores)} />);
    expect(screen.getByText('Each place is a team pot, split equally among its members.')).toBeInTheDocument();
    expect(screen.getAllByText(/team pot member share/)).toHaveLength(8);
  });
  it('shows projected future sources with reserves, supports every golfer through search and paging', () => {
    const value = fictionalPurse(40);
    const plan = value.configuration.plan;
    if (!plan) throw new Error('Missing fictional plan.');
    const rounds = value.roundScores.map((round) => ({ ...round, games: round.games ? {
      ...round.games, results: round.games.results.map((result) => ({ ...result, players: result.players.map((player) => ({
        ...player, status: 'in-progress' as const, totalPoints: null, holesScored: 0,
      })) })),
    } : undefined }));
    // Keep exact optional properties absent rather than introducing undefined.
    const pending = rounds.map(({ games, ...round }) => ({ ...round, ...(games ? { games } : {}) }));
    render(<PurseResults value={value} plan={plan} calculation={calculatePurse(plan, value.workspace, pending)} />);
    expect(screen.getByRole('heading', { name: 'Individual winnings · projected' })).toBeVisible();
    expect(screen.getByText('Reserved').nextElementSibling).toHaveTextContent('1.50');
    fireEvent.click(screen.getByRole('button', { name: 'Next winnings golfers' }));
    expect(screen.getByRole('row', { name: /Fictional golfer 13/ })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Find winnings golfer'), { target: { value: '40' } });
    expect(screen.getByRole('row', { name: /Fictional golfer 40/ })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Find winnings golfer'), { target: { value: 'no match' } });
    expect(screen.getByText('No golfers match this search.')).toBeVisible();
  });
});
