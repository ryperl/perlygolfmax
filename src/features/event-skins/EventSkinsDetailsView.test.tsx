import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { calculateEventSkinsDetails } from '../../domain/event-skins';
import { eventSkinsFixture } from '../../domain/event-skins.test-support';
import { EventSkinsDetailsView } from './EventSkinsDetailsView';

describe('saved skins detail summaries', () => {
  it('names every covering golfer in the collapsed summary, excluding worse scores', async () => {
    const f = eventSkinsFixture([4, 4, 6].map((strokes) => ({ kind: 'strokes' as const, strokes })), ['0', '0', '0']);
    render(<EventSkinsDetailsView value={calculateEventSkinsDetails(f.workspace, f.rounds)} />);
    const summary = screen.getByText('Hole 1 · Covered by Fictional golfer 1, Fictional golfer 2 — no skin');
    expect(summary).toBeVisible();
    expect(summary).not.toHaveTextContent('Fictional golfer 3');
    expect(screen.getByRole('combobox', { name: 'Round' })).toBeVisible();
    await userEvent.click(summary);
    const table = within(screen.getByRole('table', { name: 'Hole 1 skins comparison' }));
    expect(table.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Player', 'Par', 'Gross', 'Received', 'Net']);
    const cells = within(table.getByRole('row', { name: /Fictional golfer 3/ })).getAllByRole('cell');
    expect(cells).toHaveLength(4);
    expect(cells[1]).toHaveTextContent('6');
    expect(cells[3]).toHaveTextContent('6');
    expect(table.queryByText(/won|beaten|covered|tied/i)).not.toBeInTheDocument();
  });
  it('uses the saved final contenders after gross priority, not every golfer sharing the lowest net', () => {
    const f = eventSkinsFixture([2, 2, 3].map((strokes) => ({ kind: 'strokes' as const, strokes })), ['0', '0', '18']);
    render(<EventSkinsDetailsView value={calculateEventSkinsDetails(f.workspace, f.rounds)} />);
    const summary = screen.getByText(/^Hole 1 · Covered by/);
    expect(summary).toHaveTextContent('Covered by Fictional golfer 1, Fictional golfer 2 — no skin');
    expect(summary).not.toHaveTextContent('Fictional golfer 3');
  });
  it('does not describe pending or ineligible holes as covered', () => {
    const f = eventSkinsFixture([{ kind: 'unplayed' }, { kind: 'strokes', strokes: 4 }], ['0', '0']);
    render(<EventSkinsDetailsView value={calculateEventSkinsDetails(f.workspace, f.rounds)} />);
    expect(screen.getByText('Hole 1 · pending')).toBeVisible();
    expect(screen.getByText('Hole 2 · ineligible')).toBeVisible();
    expect(screen.queryByText(/Covered by/)).not.toBeInTheDocument();
  });
});
