import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { calculateEventSkinsDetails } from '../../domain/event-skins';
import type { EventSkinsDetails } from '../../domain/event-skins-details';
import { eventSkinsFixture } from '../../domain/event-skins.test-support';
import { EventSkinsDetailsView } from './EventSkinsDetailsView';
import type { EventSkinsHoleSelection } from './EventSkinsDetailsView';

function Details({ value }: { readonly value: EventSkinsDetails }) {
  const [selection, setSelection] = useState<EventSkinsHoleSelection>();
  return <EventSkinsDetailsView value={value} selection={selection} onSelect={setSelection} />;
}

describe('saved skins hole navigator', () => {
  it('shows a compact authoritative tie summary and every saved comparison without row outcomes', () => {
    const f = eventSkinsFixture([4, 4, 6].map((strokes) => ({ kind: 'strokes' as const, strokes })), ['0', '0', '0']);
    render(<Details value={calculateEventSkinsDetails(f.workspace, f.rounds)} />);
    expect(screen.getByRole('heading', { name: '2 tied · no skin' })).toBeVisible();
    expect(screen.queryByText(/Covered by Fictional/)).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Round' })).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Hole' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);
    const table = within(screen.getByRole('table', { name: 'Hole 1 skins comparison' }));
    expect(table.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Player', 'Par', 'Gross', 'Shots', 'Net']);
    expect(table.getByRole('columnheader', { name: 'Strokes received' })).toBeVisible();
    const cells = within(table.getByRole('row', { name: /Fictional golfer 3/ })).getAllByRole('cell');
    expect(cells).toHaveLength(4);
    expect(cells[1]).toHaveTextContent('6');
    expect(cells[3]).toHaveTextContent('6');
    expect(table.queryByText(/won|beaten|covered|tied/i)).not.toBeInTheDocument();
  });
  it('highlights only saved final contenders after gross priority, not every equal-net golfer', () => {
    const f = eventSkinsFixture([2, 2, 3].map((strokes) => ({ kind: 'strokes' as const, strokes })), ['0', '0', '18']);
    render(<Details value={calculateEventSkinsDetails(f.workspace, f.rounds)} />);
    expect(screen.getByRole('heading', { name: '2 tied · no skin' })).toBeVisible();
    expect(screen.getByText(/actual gross birdie-or-better priority/)).toBeVisible();
    const table = within(screen.getByRole('table'));
    expect(table.getByRole('row', { name: /Fictional golfer 1/ })).toHaveAttribute('data-contender');
    expect(table.getByRole('row', { name: /Fictional golfer 2/ })).toHaveAttribute('data-contender');
    expect(table.getByRole('row', { name: /Fictional golfer 3/ })).not.toHaveAttribute('data-contender');
  });
  it('keeps only captured holes, wraps by hole order, resets on round change and repairs refreshed selections', async () => {
    const f = eventSkinsFixture(undefined, undefined, 2, 3);
    const value = calculateEventSkinsDetails(f.workspace, f.rounds);
    const unordered = { ...value, holes: [...value.holes].reverse() };
    const before = JSON.stringify(unordered);
    const view = render(<Details value={unordered} />);
    const user = userEvent.setup();
    const nav = within(screen.getByRole('navigation', { name: 'Skins holes' }));
    expect(nav.getAllByRole('button').map((button) => button.textContent)).toEqual(['1Skin', '2None', '3None']);
    await user.click(screen.getByRole('button', { name: 'Previous hole' }));
    expect(screen.getByRole('table', { name: 'Hole 3 skins comparison' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Next hole' }));
    expect(screen.getByRole('table', { name: 'Hole 1 skins comparison' })).toBeVisible();
    await user.click(nav.getByRole('button', { name: /^Hole 2:/ }));
    expect(nav.getByRole('button', { name: /^Hole 2:/ })).toHaveAttribute('aria-pressed', 'true');
    view.rerender(<Details value={{ ...unordered }} />);
    expect(screen.getByRole('table', { name: 'Hole 2 skins comparison' })).toBeVisible();
    const nextRound = value.rounds[1];
    if (!nextRound) throw new Error('Missing fixture round');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Round' }), nextRound.id);
    expect(screen.getByRole('table', { name: 'Hole 1 skins comparison' })).toBeVisible();
    view.rerender(<Details value={{ ...unordered, holes: unordered.holes.filter((hole) => hole.roundId !== nextRound.id || hole.number !== 1) }} />);
    expect(screen.getByRole('table', { name: 'Hole 2 skins comparison' })).toBeVisible();
    view.rerender(<Details value={{ ...unordered, rounds: unordered.rounds.filter((round) => round.id !== nextRound.id) }} />);
    expect(screen.getByRole('table', { name: 'Hole 1 skins comparison' })).toBeVisible();
    expect(JSON.stringify(unordered)).toBe(before);
  });
  it('keeps pickup, DNF, unplayed and unavailable values distinct instead of inventing net zero or an award', async () => {
    const f = eventSkinsFixture([{ kind: 'picked-up', reportedStrokes: 7 }, { kind: 'did-not-finish' }, { kind: 'unplayed' }], ['0', '0', '0']);
    const view = render(<Details value={calculateEventSkinsDetails(f.workspace, f.rounds)} />);
    expect(screen.getByRole('heading', { name: 'Awaiting the field' })).toBeVisible();
    const table = within(screen.getByRole('table'));
    expect(table.getByRole('row', { name: /Fictional golfer 1/ })).toHaveTextContent('X7');
    expect(table.getByRole('row', { name: /Fictional golfer 2/ })).toHaveTextContent('DNF');
    expect(table.getByRole('row', { name: /Fictional golfer 3/ })).toHaveTextContent('—');
    expect(screen.queryByText('low net')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Hole 2:/ }));
    expect(screen.getByRole('heading', { name: 'No eligible scores' })).toBeVisible();
    const missing = eventSkinsFixture(undefined, [null, '0']);
    view.rerender(<Details value={calculateEventSkinsDetails(missing.workspace, missing.rounds)} />);
    await userEvent.click(screen.getByRole('button', { name: /^Hole 1:/ }));
    expect(screen.getByRole('heading', { name: 'Result unavailable' })).toBeVisible();
    expect(screen.getByText('missing net inputs')).toBeVisible();
    expect(screen.queryByText('low net')).not.toBeInTheDocument();
  });
  it('shows saved net zero as a valid winning score and disables wrap controls for a single captured hole', () => {
    const f = eventSkinsFixture([{ kind: 'strokes', strokes: 1 }], ['18']);
    const value = calculateEventSkinsDetails(f.workspace, f.rounds);
    const view = render(<Details value={{ ...value, holes: value.holes.filter((hole) => hole.number === 1) }} />);
    expect(screen.getByRole('heading', { name: 'Fictional golfer 1' })).toBeVisible();
    expect(view.container.querySelector('.skins-hole-net strong')).toHaveTextContent(/^0$/);
    expect(screen.getByRole('button', { name: 'Previous hole' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next hole' })).toBeDisabled();
    view.rerender(<Details value={{ ...value, holes: [] }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('No hole details available');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    view.rerender(<Details value={{ ...value, status: 'disabled' }} />);
    expect(screen.getByText('Event skins is no longer configured.')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
