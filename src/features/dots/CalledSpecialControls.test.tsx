import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DotsCall } from '../../domain/dots';
import type { HoleScore } from '../../domain/scoring';
import { CalledSpecialControls } from './CalledSpecialControls';

function Editor({ score, initial = [], changed, kind = 'murphy' }: {
  readonly score: HoleScore | undefined;
  readonly initial?: readonly DotsCall[];
  readonly changed: (calls: readonly DotsCall[]) => void;
  readonly kind?: 'murphy' | 'paree';
}) {
  const [calls, setCalls] = useState(initial);
  return <CalledSpecialControls kind={kind} calls={calls} name="Fictional golfer" score={score} par={4} blocked={false}
    onChange={(value) => { setCalls(value); changed(value); }} />;
}

describe('score-aware called-special controls', () => {
  it('does not imply an opponent award in a solo Dots context', () => {
    render(<CalledSpecialControls kind="murphy" name="Fictional golfer" par={4}
      calls={[{ id: 'solo-call', kind: 'murphy', result: 'pending', murphyTarget: 'par' }]}
      score={{ kind: 'strokes', strokes: 5 }} blocked={false} hasOpponents={false} onChange={vi.fn()} />);
    expect(screen.getByText('Missed · no opponents · needs 4 or better')).toBeVisible();
    expect(screen.queryByText(/opponents earn/)).not.toBeInTheDocument();
  });
  it('records Paree explicitly without outcome, birdie or press inputs, while retaining separately called repetitions', async () => {
    const user = userEvent.setup(), changed = vi.fn<(calls: readonly DotsCall[]) => void>();
    render(<Editor kind="paree" score={{ kind: 'strokes', strokes: 4 }} changed={changed} />);
    expect(changed).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox', { name: 'Paree called · Fictional golfer' }));
    expect(screen.getByRole('checkbox', { name: 'Paree called · Fictional golfer' })).toHaveFocus();
    expect(screen.getByText('Made · needs 4 or better')).toBeVisible();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /birdie/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/stakes/)).not.toBeInTheDocument();
    const first = changed.mock.lastCall?.[0]?.[0];
    expect(first).toMatchObject({ kind: 'paree', result: 'pending', pareeTarget: 'par' });
    await user.click(screen.getByRole('button', { name: 'Add another Paree call · Fictional golfer' }));
    const repeated = changed.mock.lastCall?.[0];
    expect(repeated).toHaveLength(2);
    expect(repeated?.[0]).toEqual(first);
    expect(repeated?.[1]?.id).not.toBe(first?.id);
    await user.click(screen.getByRole('checkbox', { name: 'Paree called 2 · Fictional golfer' }));
    expect(changed).toHaveBeenLastCalledWith([first]);
  });

  it('preserves an old manual Paree until explicit opt-in and follows score corrections without rewriting calls', async () => {
    const user = userEvent.setup(), onChange = vi.fn();
    const call: DotsCall = { id: 'legacy-paree', kind: 'paree', result: 'failure' };
    const props = { kind: 'paree' as const, calls: [call], par: 4, name: 'Fictional golfer', blocked: false, onChange };
    const view = render(<CalledSpecialControls {...props} score={{ kind: 'strokes', strokes: 4 }} />);
    expect(screen.getByText('Manual result: Missed')).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Use score outcome' }));
    expect(onChange).toHaveBeenLastCalledWith([{ ...call, result: 'pending', pareeTarget: 'par' }]);
    onChange.mockClear();
    const automatic: DotsCall = { ...call, result: 'pending', pareeTarget: 'par' };
    for (const score of [{ kind: 'unplayed' }, { kind: 'strokes', strokes: 5 },
      { kind: 'picked-up', reportedStrokes: 7 }, { kind: 'did-not-finish' },
      { kind: 'strokes', strokes: 3 }] satisfies readonly HoleScore[]) {
      view.rerender(<CalledSpecialControls {...props} calls={[automatic]} score={score} />);
      expect(screen.getByText(score.kind === 'unplayed' ? 'Pending · enter a gross score'
        : score.kind === 'strokes' && score.strokes <= 4 ? 'Made · needs 4 or better'
          : 'Missed · opponents earn · needs 4 or better')).toBeVisible();
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(call.result).toBe('failure');
  });

  it('requires an explicit call, distinguishes a missed birdie target from a made par target, and keeps stakes within 1x–3x', async () => {
    const user = userEvent.setup(), changed = vi.fn<(calls: readonly DotsCall[]) => void>();
    render(<Editor score={{ kind: 'strokes', strokes: 4 }} changed={changed} />);
    expect(screen.queryByText(/Made/)).not.toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox', { name: 'Murphy called · Fictional golfer' }));
    expect(screen.getByRole('checkbox', { name: 'Murphy called · Fictional golfer' })).toHaveFocus();
    expect(screen.getByText('Made · needs 4 or better')).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: 'Murphy for birdie · Fictional golfer' }));
    expect(screen.getByText('Missed · opponents earn · needs 3 or better')).toBeVisible();
    const increase = screen.getByRole('button', { name: 'Increase Murphy stakes · Fictional golfer' });
    const decrease = screen.getByRole('button', { name: 'Decrease Murphy stakes · Fictional golfer' });
    expect(decrease).toBeDisabled();
    await user.click(increase);
    await user.click(increase);
    expect(screen.getByLabelText('Murphy stakes · Fictional golfer')).toHaveTextContent('×3');
    expect(increase).toBeDisabled();
    const call = changed.mock.lastCall?.[0]?.[0];
    expect(call).toMatchObject({ kind: 'murphy', result: 'pending', murphyTarget: 'birdie', murphyPresses: 2 });
    await user.click(decrease);
    expect(changed.mock.lastCall?.[0]?.[0]).toEqual({ ...call, murphyPresses: 1 });
    await user.click(screen.getByRole('checkbox', { name: 'Murphy called · Fictional golfer' }));
    expect(changed).toHaveBeenLastCalledWith([]);
  });

  it('shows blank/invalid input as pending, pickup and DNF as missed, and recalculates the display without changing stored declarations', () => {
    const onChange = vi.fn(), call: DotsCall = { id: 'fictional-call', kind: 'murphy', result: 'pending', murphyTarget: 'par' };
    const props = { kind: 'murphy' as const, calls: [call], par: 5, name: 'Fictional golfer', blocked: false, onChange };
    const view = render(<CalledSpecialControls {...props} score={{ kind: 'unplayed' }} />);
    expect(screen.getByText('Pending · enter a gross score')).toBeVisible();
    view.rerender(<CalledSpecialControls {...props} score={undefined} />);
    expect(screen.getByText('Pending · enter a gross score')).toBeVisible();
    for (const score of [{ kind: 'picked-up', reportedStrokes: 7 }, { kind: 'did-not-finish' }] satisfies readonly HoleScore[]) {
      view.rerender(<CalledSpecialControls {...props} score={score} />);
      expect(screen.getByText('Missed · opponents earn · needs 5 or better')).toBeVisible();
    }
    view.rerender(<CalledSpecialControls {...props} score={{ kind: 'strokes', strokes: 4 }} />);
    expect(screen.getByText('Made · needs 5 or better')).toBeVisible();
    view.rerender(<CalledSpecialControls {...props} calls={[{ ...call, murphyTarget: 'birdie' }]}
      score={{ kind: 'strokes', strokes: 4 }} />);
    expect(screen.getByText('Made · needs 4 or better')).toBeVisible();
    view.rerender(<CalledSpecialControls {...props} calls={[{ ...call, murphyTarget: 'birdie' }]}
      score={{ kind: 'strokes', strokes: 5 }} />);
    expect(screen.getByText('Missed · opponents earn · needs 4 or better')).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
    expect(call).toEqual({ id: 'fictional-call', kind: 'murphy', result: 'pending', murphyTarget: 'par' });
  });

  it('preserves repeated legacy calls and manual outcomes until explicitly opting into score-derived results', async () => {
    const user = userEvent.setup(), changed = vi.fn();
    const first: DotsCall = { id: 'first', kind: 'murphy', result: 'failure', murphyPresses: 2 };
    const second: DotsCall = { id: 'second', kind: 'murphy', result: 'success', murphyPresses: 1 };
    render(<Editor score={{ kind: 'strokes', strokes: 4 }} initial={[first, second]} changed={changed} />);
    expect(screen.getByText('Manual result: Missed')).toBeVisible();
    expect(screen.getByText('Manual result: Made')).toBeVisible();
    expect(changed).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Use score outcome 1' }));
    expect(changed).toHaveBeenLastCalledWith([{ ...first, result: 'pending', murphyTarget: 'par' }, second]);
    await user.click(screen.getByRole('checkbox', { name: 'Murphy called 1 · Fictional golfer' }));
    expect(changed).toHaveBeenLastCalledWith([second]);
  });
});
