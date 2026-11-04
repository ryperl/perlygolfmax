import { render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fictionalRoundScores } from '../../client/scoring.test-support';
import { GroupHoleEntry } from './GroupHoleEntry';
import type { GroupHoleEntryProps } from './GroupHoleEntry';

function props(): GroupHoleEntryProps {
  const hole = fictionalRoundScores.layout[0];
  if (!hole) throw new Error('Missing fictional source hole');
  return {
    groups: fictionalRoundScores.groups, groupNumber: 1, layout: fictionalRoundScores.layout, hole,
    rows: fictionalRoundScores.cards.map((card) => ({
      playerId: card.playerId, displayName: card.displayName, saved: { kind: 'unplayed' }, canReview: false,
    })),
    busy: false, readOnly: false, unsavedCount: 0,
    onGroupChange: vi.fn(), onHoleChange: vi.fn(), onEdit: vi.fn(), onReview: vi.fn(), onDiscard: vi.fn(), onSave: vi.fn(),
  };
}
describe('pure mobile group hole entry', () => {
  it('supports SSR with blank boxes, one form and no more than four player rows, without auto-par', () => {
    const input = props();
    const markup = renderToStaticMarkup(<GroupHoleEntry {...input} />);
    expect(markup).toContain('Save &amp; Next Hole');
    render(<GroupHoleEntry {...input} rows={[...input.rows, ...input.rows]} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(4);
    expect(screen.getAllByRole('form')).toHaveLength(1);
    expect(input.onEdit).not.toHaveBeenCalled();
    for (const field of screen.getAllByRole('textbox')) expect(field).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Previous hole' })).toBeDisabled();
    expect(screen.getByText('Par 4 · 100 yards · Stroke index 1')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Decrease score for Fictional Player 1' })).toBeDisabled();
    expect(screen.queryByText(/Other options|Number = strokes|Clear to unplayed|DNF for|Request ID|Base revision/)).not.toBeInTheDocument();
  });
  it('keeps quick scores and the X button explicit, with +/- retaining the X7 disposition', async () => {
    const input = props();
    const first = input.rows[0];
    if (!first) throw new Error('Missing fictional row');
    const { rerender } = render(<GroupHoleEntry {...input} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '4 strokes for Fictional Player 1' }));
    expect(input.onEdit).toHaveBeenLastCalledWith(first.playerId, '4');
    rerender(<GroupHoleEntry {...input} rows={[{ ...first, draft: { text: 'X7', baseEtag: null, status: 'draft' } }, ...input.rows.slice(1)]} />);
    expect(screen.getByRole('textbox', { name: 'Fictional Player 1 score' })).toHaveValue('X7');
    expect(screen.getByRole('button', { name: 'Pickup X for Fictional Player 1' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Decrease score for Fictional Player 1' }));
    expect(input.onEdit).toHaveBeenLastCalledWith(first.playerId, 'X6');
    await user.click(screen.getByRole('button', { name: 'Increase score for Fictional Player 1' }));
    expect(input.onEdit).toHaveBeenLastCalledWith(first.playerId, 'X8');
    await user.click(screen.getByRole('button', { name: 'Pickup X for Fictional Player 1' }));
    expect(input.onEdit).toHaveBeenLastCalledWith(first.playerId, '7');
  });
  it('moves Enter between score boxes without submitting, then focuses the explicit group action; buttons retain Enter/Space activation', async () => {
    const input = props();
    render(<GroupHoleEntry {...input} />);
    const user = userEvent.setup();
    const field = screen.getByRole('textbox', { name: 'Fictional Player 1 score' });
    await user.click(field);
    expect(field).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'Fictional Player 2 score' })).toHaveFocus();
    expect(input.onSave).not.toHaveBeenCalled();
    await user.keyboard('{Enter}{Enter}{Enter}');
    expect(screen.getByRole('button', { name: 'Save & Next Hole' })).toHaveFocus();
    expect(input.onSave).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(input.onSave).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Next hole' }));
    expect(input.onHoleChange).toHaveBeenCalledWith(2);
    expect(input.onSave).toHaveBeenCalledOnce();
    screen.getByRole('button', { name: 'Save changes' }).focus();
    await user.keyboard(' ');
    expect(input.onSave).toHaveBeenLastCalledWith(false);
  });
  it('makes archived data read-only while allowing view navigation and displays explicit review states', () => {
    const input = props();
    const first = input.rows[0];
    if (!first) throw new Error('Missing fictional row');
    render(<GroupHoleEntry {...input} readOnly rows={[{
      ...first, saved: { kind: 'strokes', strokes: 8 },
      draft: { text: 'X7', baseEtag: null, status: 'conflict', conflictAt: 0 }, canReview: false,
    }, ...input.rows.slice(1)]} />);
    expect(screen.getByRole('textbox', { name: 'Fictional Player 1 score' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save & Next Hole' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next hole' })).toBeEnabled();
    const row = within(screen.getByRole('article', { name: 'Fictional Player 1 scorecard' }));
    expect(row.getByText('Conflict — review')).toBeVisible();
    expect(row.getByRole('button', { name: 'Review my value for Fictional Player 1' })).toBeDisabled();
    expect(row.getByText(/Saved: 8 strokes · Local: X7/)).toBeVisible();
  });
});
