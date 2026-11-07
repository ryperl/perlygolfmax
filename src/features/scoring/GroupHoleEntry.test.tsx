import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { maximumExactHoleStrokes } from '../../domain/scoring';
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
    onGroupChange: vi.fn(), onHoleChange: vi.fn(), onEdit: vi.fn(), onReview: vi.fn(), onDiscard: vi.fn(), onDiscardAll: vi.fn(), onSave: vi.fn(),
  };
}
function ControlledEntry(input: GroupHoleEntryProps) {
  const [edits, setEdits] = useState<Readonly<Record<string, string>>>({});
  return <GroupHoleEntry {...input} rows={input.rows.map((row) => {
    const text = edits[row.playerId];
    return text === undefined ? row : { ...row, draft: { ...row.draft, text, baseEtag: null, status: row.draft?.status ?? 'draft' } };
  })} onEdit={(playerId, text) => {
    input.onEdit(playerId, text);
    setEdits((previous) => ({ ...previous, [playerId]: text }));
  }} />;
}
function fields() { return screen.getAllByRole('textbox'); }
function typeScore(index: number, value: string) {
  const field = fields()[index];
  if (!field) throw new Error('Missing fictional field');
  field.focus();
  fireEvent.change(field, { target: { value } });
  return field;
}
function pause(ms = 900) { act(() => { vi.advanceTimersByTime(ms); }); }
afterEach(() => { vi.useRealTimers(); });
describe('pure mobile group hole entry', () => {
  it('keeps idle feedback blank while preserving the live save-status area for drafts and requests', () => {
    const input = props();
    const view = render(<GroupHoleEntry {...input} />);
    const feedback = screen.getByRole('region', { name: 'Group hole entry' }).querySelector('.score-save-status');
    if (!feedback) throw new Error('Missing score feedback region.');
    expect(feedback).toHaveAttribute('aria-live', 'polite');
    expect(feedback).toBeEmptyDOMElement();
    view.rerender(<GroupHoleEntry {...input} unsavedCount={1} />);
    expect(feedback).toHaveTextContent('Unsaved changes');
    view.rerender(<GroupHoleEntry {...input} busy />);
    expect(feedback).toHaveTextContent('Working…');
    view.rerender(<GroupHoleEntry {...input} saveStatus="Saved" />);
    expect(feedback).toHaveTextContent('Saved');
    expect(screen.queryByText('Ready for scores')).not.toBeInTheDocument();
  });
  it('reserves the count and discard action, keeps readonly drafts discardable, and blocks discard while saving', async () => {
    const input = props();
    const view = render(<GroupHoleEntry {...input} />);
    const discard = screen.getByRole('button', { name: 'Discard unsaved scores' });
    expect(screen.getByText('0 unsaved scores')).toBeVisible();
    expect(discard).toBeDisabled();
    expect(discard.closest('.group-save-actions')).toContainElement(screen.getByRole('button', { name: 'Save & Next Hole' }));
    view.rerender(<GroupHoleEntry {...input} unsavedCount={1} readOnly />);
    expect(screen.getByText('1 unsaved score')).toBeVisible();
    expect(discard).toBeEnabled();
    await userEvent.click(discard);
    expect(input.onDiscardAll).toHaveBeenCalledOnce();
    expect(input.onSave).not.toHaveBeenCalled();
    view.rerender(<GroupHoleEntry {...input} unsavedCount={1} busy />);
    expect(discard).toBeDisabled();
  });
  it('wraps both hole arrows without saving or treating the end as a pending request', async () => {
    const input = props();
    const last = input.layout.at(-1);
    if (!last) throw new Error('Missing fictional last hole.');
    const view = render(<GroupHoleEntry {...input} />);
    await userEvent.click(screen.getByRole('button', { name: 'Previous hole' }));
    expect(input.onHoleChange).toHaveBeenLastCalledWith(last.number);
    view.rerender(<GroupHoleEntry {...input} hole={last} />);
    expect(screen.getByRole('button', { name: 'Next hole' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next hole' }));
    expect(input.onHoleChange).toHaveBeenLastCalledWith(input.hole.number);
    expect(input.onSave).not.toHaveBeenCalled();
  });
  it('uses each golfer’s own hole par for blank nudges and single-golfer quick scores without autosaving', async () => {
    const input = props();
    const rows = input.rows.map((row, index) => ({ ...row,
      hole: { ...input.hole, par: index === 0 ? 5 : 3, length: 210, allocation: 9 },
      teeLabel: index === 0 ? 'Fictional Gold / Personal category' : 'Fictional Teal / Default category',
    }));
    const first = rows[0];
    if (!first) throw new Error('Missing fictional golfer.');
    const { rerender } = render(<GroupHoleEntry {...input} rows={rows} />);
    const user = userEvent.setup();
    expect(screen.queryByText('Par 4 · 100 yards · Stroke index 1')).not.toBeInTheDocument();
    expect(screen.getByText('Fictional Gold / Personal category · Par 5 · 210 yards · Stroke index 9')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Increase score for Fictional Player 1' }));
    expect(input.onEdit).toHaveBeenLastCalledWith(first.playerId, '5');
    await user.click(screen.getByRole('button', { name: 'Decrease score for Fictional Player 2' }));
    expect(input.onEdit).toHaveBeenLastCalledWith(rows[1]?.playerId, '3');
    rerender(<GroupHoleEntry {...input} rows={[first]} />);
    expect(screen.getByRole('button', { name: '5 strokes for Fictional Player 1' })).toHaveTextContent('par');
    expect(screen.queryByRole('button', { name: '3 strokes for Fictional Player 1' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '6 strokes for Fictional Player 1' }));
    expect(input.onEdit).toHaveBeenLastCalledWith(first.playerId, '6');
    expect(input.onSave).not.toHaveBeenCalled();
  });
  it('supports SSR with blank boxes, one form and no more than four player rows, without auto-par', () => {
    const input = props();
    const markup = renderToStaticMarkup(<GroupHoleEntry {...input} />);
    expect(markup).toContain('Save &amp; Next Hole');
    render(<GroupHoleEntry {...input} rows={[...input.rows, ...input.rows]} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(4);
    expect(screen.getAllByRole('form')).toHaveLength(1);
    expect(input.onEdit).not.toHaveBeenCalled();
    for (const field of screen.getAllByRole('textbox')) expect(field).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Previous hole' })).toBeEnabled();
    expect(screen.getByText('Par 4 · 100 yards · Stroke index 1')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Decrease score for Fictional Player 1' })).toBeEnabled();
    expect(screen.queryByText(/Other options|Number = strokes|Clear to unplayed|DNF for|Request ID|Base revision/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /4 strokes for/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Saved:/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Save & Next Hole' })).toHaveLength(1);
  });
  it('keeps quick scores and the X button explicit, with +/- retaining the X7 disposition', async () => {
    const input = props();
    const first = input.rows[0];
    if (!first) throw new Error('Missing fictional row');
    const { rerender } = render(<GroupHoleEntry {...input} rows={[first]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '4 strokes for Fictional Player 1' }));
    expect(input.onEdit).toHaveBeenLastCalledWith(first.playerId, '4');
    rerender(<GroupHoleEntry {...input} rows={[{ ...first, draft: { text: 'X7', baseEtag: null, status: 'draft' } }]} />);
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
    render(<ControlledEntry {...input} />);
    const user = userEvent.setup();
    const field = screen.getByRole('textbox', { name: 'Fictional Player 1 score' });
    await user.click(field);
    expect(field).toHaveFocus();
    await user.keyboard('4{Enter}');
    expect(screen.getByRole('textbox', { name: 'Fictional Player 2 score' })).toHaveFocus();
    expect(input.onSave).not.toHaveBeenCalled();
    await user.keyboard('4{Enter}4{Enter}4{Enter}');
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
  it.each([3, 4, 5])('seeds blank +/- at par %i only on the first explicit tap, then adjusts normally', (par) => {
    const input = props();
    render(<ControlledEntry {...input} hole={{ ...input.hole, par }} />);
    expect(fields()[0]).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Increase score for Fictional Player 1' }));
    expect(fields()[0]).toHaveValue(String(par));
    fireEvent.click(screen.getByRole('button', { name: 'Increase score for Fictional Player 1' }));
    expect(fields()[0]).toHaveValue(String(par + 1));
    fireEvent.click(screen.getByRole('button', { name: 'Decrease score for Fictional Player 2' }));
    expect(fields()[1]).toHaveValue(String(par));
    fireEvent.click(screen.getByRole('button', { name: 'Decrease score for Fictional Player 2' }));
    expect(fields()[1]).toHaveValue(String(par - 1));
    expect(input.onSave).not.toHaveBeenCalled();
  });
  it.each(['X', 'DNF', 'oops', '0', String(maximumExactHoleStrokes + 1)])('does not seed nonblank %s', (text) => {
    const input = props();
    render(<GroupHoleEntry {...input} rows={input.rows.map((row) => ({ ...row, draft: { text, baseEtag: null, status: 'draft' } }))} />);
    expect(screen.getByRole('button', { name: 'Increase score for Fictional Player 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decrease score for Fictional Player 1' })).toBeDisabled();
    expect(input.onEdit).not.toHaveBeenCalled();
  });
  it.each(['', 'X'])('preserves exact numeric bounds for %s strokes', (prefix) => {
    const input = props();
    const first = input.rows[0];
    if (!first) throw new Error('Missing fictional row');
    const { rerender } = render(<GroupHoleEntry {...input} rows={[{ ...first, draft: { text: `${prefix}1`, baseEtag: null, status: 'draft' } }]} />);
    expect(screen.getByRole('button', { name: /Decrease score/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Increase score/ }));
    expect(input.onEdit).toHaveBeenLastCalledWith(first.playerId, `${prefix}2`);
    rerender(<GroupHoleEntry {...input} rows={[{ ...first, draft: { text: `${prefix}${String(maximumExactHoleStrokes)}`, baseEtag: null, status: 'draft' } }]} />);
    expect(screen.getByRole('button', { name: /Increase score/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Decrease score/ }));
    expect(input.onEdit).toHaveBeenLastCalledWith(first.playerId, `${prefix}${String(maximumExactHoleStrokes - 1)}`);
  });
  it.each(['10', '12'])('waits after the last digit of %s, then focuses the next blank without saving', (text) => {
    vi.useFakeTimers();
    const input = props();
    render(<ControlledEntry {...input} />);
    const first = typeScore(0, text.slice(0, 1));
    pause(600);
    expect(first).toHaveFocus();
    fireEvent.change(first, { target: { value: text } });
    pause(600);
    expect(first).toHaveFocus();
    expect(first).toHaveValue(text);
    pause(300);
    expect(fields()[1]).toHaveFocus();
    expect(input.onSave).not.toHaveBeenCalled();
    expect(input.onHoleChange).not.toHaveBeenCalled();
    expect(input.onEdit).toHaveBeenCalledTimes(2);
  });
  it('skips saved and draft entries including pickup/DNF, wrapping to earlier blanks', () => {
    vi.useFakeTimers();
    const input = props();
    const { rerender } = render(<ControlledEntry {...input} rows={input.rows.map((row, index) => index === 1
      ? { ...row, saved: { kind: 'strokes', strokes: 5 } } : index === 2
        ? { ...row, draft: { text: 'X', baseEtag: null, status: 'draft' } } : row)} />);
    typeScore(0, '4');
    pause();
    expect(fields()[3]).toHaveFocus();
    rerender(<ControlledEntry {...input} rows={input.rows.map((row, index) => index === 0
      ? { ...row, saved: { kind: 'strokes', strokes: 5 } } : index === 2
        ? { ...row, draft: { text: 'DNF', baseEtag: null, status: 'draft' } } : row)} />);
    typeScore(3, '6');
    pause();
    expect(fields()[1]).toHaveFocus();
  });
  it('focuses Save without activating when no blank remains, also for immediate Enter', () => {
    vi.useFakeTimers();
    const input = props();
    render(<ControlledEntry {...input} rows={input.rows.map((row, index) => index === 0 ? row
      : { ...row, saved: { kind: 'strokes', strokes: 5 } })} />);
    const first = typeScore(0, '4');
    pause();
    expect(screen.getByRole('button', { name: 'Save & Next Hole' })).toHaveFocus();
    first.focus();
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Save & Next Hole' })).toHaveFocus();
    expect(input.onSave).not.toHaveBeenCalled();
  });
  it.each(['blur', 'navigation', 'invalid', 'clear', 'composition', 'unmount', 'busy', 'readOnly', 'hole', 'group', 'conflict', 'external-value'])(
    'cancels pending focus on %s and does not steal focus after the context returns', (reason) => {
      vi.useFakeTimers();
      const input = props();
      const { rerender, unmount } = render(reason === 'external-value' ? <GroupHoleEntry {...input} /> : <ControlledEntry {...input} />);
      const first = typeScore(0, '4');
      if (reason === 'blur') { fields()[2]?.focus(); first.focus(); }
      if (reason === 'navigation') fireEvent.keyDown(first, { key: 'ArrowLeft' });
      if (reason === 'invalid' || reason === 'clear') fireEvent.change(first, { target: { value: reason === 'clear' ? '' : '0' } });
      if (reason === 'composition') {
        fireEvent.compositionStart(first);
        fireEvent.change(first, { target: { value: '12' } });
        fireEvent.keyDown(first, { key: 'Enter', isComposing: true });
        fireEvent.compositionEnd(first);
      }
      if (reason === 'unmount') unmount();
      if (reason === 'busy' || reason === 'readOnly') {
        rerender(<ControlledEntry {...input} busy={reason === 'busy'} readOnly={reason === 'readOnly'} />);
        rerender(<ControlledEntry {...input} />);
      }
      if (reason === 'hole' || reason === 'group') {
        rerender(<ControlledEntry {...input} groupNumber={reason === 'group' ? 2 : 1}
          hole={{ ...input.hole, number: reason === 'hole' ? 2 : 1 }} />);
        rerender(<ControlledEntry {...input} />);
      }
      if (reason === 'conflict' || reason === 'external-value') {
        const updated: GroupHoleEntryProps = { ...input, rows: input.rows.map((row, index) => index === 0
          ? { ...row, draft: { text: reason === 'conflict' ? '4' : '5', baseEtag: null, status: reason === 'conflict' ? 'conflict' : 'draft' } } : row) };
        rerender(reason === 'external-value' ? <GroupHoleEntry {...updated} /> : <ControlledEntry {...updated} />);
      }
      pause();
      if (reason !== 'unmount') expect(first).toHaveFocus();
      if (reason === 'conflict') {
        fireEvent.keyDown(first, { key: 'Enter' });
        expect(first).toHaveFocus();
      }
      expect(input.onSave).not.toHaveBeenCalled();
    },
  );
  it('does not move for invalid/conflicting Enter or button edits, and preserves focus/caret on unchanged renders', () => {
    vi.useFakeTimers();
    const input = props();
    const { rerender } = render(<ControlledEntry {...input} />);
    const first = typeScore(0, '0');
    fireEvent.keyDown(first, { key: 'Enter' });
    pause();
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(first, { target: { value: '12' } });
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    if (!(first instanceof HTMLInputElement)) throw new Error('Missing input');
    first.setSelectionRange(1, 1);
    rerender(<ControlledEntry {...input} rows={[...input.rows]} />);
    pause();
    expect(first).toHaveFocus();
    expect(first.selectionStart).toBe(1);
    for (const name of ['Increase score', 'Decrease score', 'Pickup X']) {
      const button = screen.getByRole('button', { name: `${name} for Fictional Player 1` });
      button.focus();
      fireEvent.click(button);
      pause();
      expect(button).toHaveFocus();
    }
    expect(input.onSave).not.toHaveBeenCalled();
  });
  it('uses current draft/saved values when selecting a blank and keeps unchanged polls from resetting the typing pause', () => {
    vi.useFakeTimers();
    const input = props();
    const { rerender } = render(<ControlledEntry {...input} />);
    typeScore(1, '8');
    typeScore(0, '4');
    pause(500);
    rerender(<ControlledEntry {...input} rows={input.rows.map((row, index) => index === 2
      ? { ...row, saved: { kind: 'picked-up', reportedStrokes: 7 } } : { ...row })} />);
    pause(400);
    expect(fields()[3]).toHaveFocus();
    expect(fields()[1]).toHaveValue('8');
    expect(fields()[2]).toHaveValue('X7');
    expect(input.onEdit).toHaveBeenCalledTimes(2);
  });
  it('keeps quick scores and repeated blank-seeded button adjustments focused without scheduling movement', () => {
    vi.useFakeTimers();
    const input = props();
    render(<ControlledEntry {...input} rows={input.rows.slice(0, 1)} />);
    const increase = screen.getByRole('button', { name: /Increase score/ });
    increase.focus();
    fireEvent.click(increase);
    pause();
    expect(increase).toHaveFocus();
    fireEvent.click(increase);
    pause();
    expect(increase).toHaveFocus();
    expect(fields()[0]).toHaveValue('5');
    const quick = screen.getByRole('button', { name: '4 strokes for Fictional Player 1' });
    quick.focus();
    fireEvent.click(quick);
    pause();
    expect(quick).toHaveFocus();
    expect(fields()[0]).toHaveValue('4');
    expect(input.onSave).not.toHaveBeenCalled();
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
    expect(row.getByText(/Saved: 8 strokes · Intended: X7/)).toBeVisible();
  });
});
