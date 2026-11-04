import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fictionalChange, fictionalRoundScores, scoreResult } from '../../client/scoring.test-support';
import { SavedScorecards } from './SavedScorecards';

function props() {
  return { round: fictionalRoundScores, groupNumber: 1, busy: false, onGroupChange: vi.fn(), onEnterScores: vi.fn() };
}
describe('golfer-facing round scorecards', () => {
  it('immediately shows a paper-style group grid in hole and group order, not an audit list', () => {
    const round = scoreResult().round;
    const { container } = render(<SavedScorecards {...props()} round={{
      ...round, layout: [...round.layout].reverse(), cards: [...round.cards].reverse(),
    }} />);
    const table = screen.getByRole('table', { name: 'Front nine scorecard' });
    expect(table).toBeVisible();
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Hole', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Out', 'Total',
    ]);
    expect(within(table).getAllByRole('button').map((button) => button.textContent)).toEqual(round.cards.map((card) => card.displayName));
    const playerRow = within(table).getByRole('button', { name: 'Open scorecard for Fictional Player 1' }).closest('tr');
    if (!playerRow) throw new Error('Missing fictional player row.');
    expect(within(playerRow).getAllByRole('cell').at(-1)).toHaveTextContent('4*');
    expect(screen.queryByText(/history|request|revision|actor/i)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    expect(container.textContent).not.toContain(fictionalChange.recordedAt);
    expect(screen.queryByRole('columnheader', { name: /pickup/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /net|stableford/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Recorded strokes:|Saved card updated|No net or Stableford|unplayed · X/)).not.toBeInTheDocument();
  });
  it('opens an individual card directly from a golfer name and returns to the group', async () => {
    render(<SavedScorecards {...props()} round={scoreResult({ ...fictionalChange, after: { kind: 'picked-up', reportedStrokes: 7 } }).round} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open scorecard for Fictional Player 1' }));
    const card = screen.getByRole('region', { name: 'Fictional Player 1 full scorecard' });
    expect(card).toBeVisible();
    expect(within(card).getByRole('table', { name: 'Front nine scorecard' })).toBeVisible();
    expect(card).toHaveTextContent('X7');
    expect(within(card).getByText('Incomplete')).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to group scorecard' }));
    expect(screen.getByRole('table', { name: 'Front nine scorecard' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Fictional Player 1 full scorecard' })).not.toBeInTheDocument();
  });
  it('provides explicit entry and group navigation and resets a player selection when changing groups', async () => {
    const input = props();
    const extra = fictionalRoundScores.cards.map((card, index) => ({ ...card, playerId: `00000000-0000-4000-8000-00000000010${String(index)}`, displayName: `Fictional Guest ${String(index + 1)}` }));
    const round = { ...input.round, cards: [...input.round.cards, ...extra], groups: [
      ...input.round.groups, { number: 2, playerIds: extra.map((card) => card.playerId) },
    ] };
    const { rerender } = render(<SavedScorecards {...input} round={round} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Scorecard'), fictionalChange.playerId);
    await user.selectOptions(screen.getByLabelText('Group'), '2');
    expect(input.onGroupChange).toHaveBeenCalledWith(2);
    rerender(<SavedScorecards {...input} round={round} groupNumber={2} />);
    expect(screen.getByLabelText('Scorecard')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Open scorecard for Fictional Guest 1' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Open scorecard for Fictional Player 1' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enter scores · Group 2' }));
    expect(input.onEnterScores).toHaveBeenCalledOnce();
  });
  it('switches front/back/full nines without inventing back-nine data on a nine-hole round', async () => {
    const input = props();
    const layout = Array.from({ length: 18 }, (_, index) => ({ number: index + 1, sourceId: 300 + index, length: 100, par: 4, allocation: index + 1 }));
    const round = { ...input.round, layout, cards: input.round.cards.map((card) => ({
      ...card, holes: layout.map((hole) => ({ number: hole.number, score: { kind: 'strokes' as const, strokes: 4 } })),
    })) };
    const { rerender } = render(<SavedScorecards {...input} round={round} />);
    const user = userEvent.setup();
    expect(screen.getAllByRole('table')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Back 9' }));
    expect(screen.queryByRole('table', { name: 'Front nine scorecard' })).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Back nine scorecard' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'In' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Total' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Front 9' }));
    expect(screen.queryByRole('table', { name: 'Back nine scorecard' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Full card' }));
    expect(screen.getAllByRole('table')).toHaveLength(2);
    rerender(<SavedScorecards {...input} />);
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Back 9' })).not.toBeInTheDocument();
  });
});
