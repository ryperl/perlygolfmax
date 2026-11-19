import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DotsCall } from '../../domain/dots';
import type { HoleScore } from '../../domain/scoring';
import { MurphyCallControls } from './MurphyCallControls';

function Editor({ score, initial = [], changed }: {
  readonly score: HoleScore | undefined;
  readonly initial?: readonly DotsCall[];
  readonly changed: (calls: readonly DotsCall[]) => void;
}) {
  const [calls, setCalls] = useState(initial);
  return <MurphyCallControls calls={calls} name="Fictional golfer" score={score} par={4} blocked={false}
    onChange={(value) => { setCalls(value); changed(value); }} />;
}

describe('score-aware Churchie Murphy controls', () => {
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
    const props = { calls: [call], par: 5, name: 'Fictional golfer', blocked: false, onChange };
    const view = render(<MurphyCallControls {...props} score={{ kind: 'unplayed' }} />);
    expect(screen.getByText('Pending · enter a gross score')).toBeVisible();
    view.rerender(<MurphyCallControls {...props} score={undefined} />);
    expect(screen.getByText('Pending · enter a gross score')).toBeVisible();
    for (const score of [{ kind: 'picked-up', reportedStrokes: 7 }, { kind: 'did-not-finish' }] satisfies readonly HoleScore[]) {
      view.rerender(<MurphyCallControls {...props} score={score} />);
      expect(screen.getByText('Missed · opponents earn · needs 5 or better')).toBeVisible();
    }
    view.rerender(<MurphyCallControls {...props} score={{ kind: 'strokes', strokes: 4 }} />);
    expect(screen.getByText('Made · needs 5 or better')).toBeVisible();
    view.rerender(<MurphyCallControls {...props} calls={[{ ...call, murphyTarget: 'birdie' }]}
      score={{ kind: 'strokes', strokes: 4 }} />);
    expect(screen.getByText('Made · needs 4 or better')).toBeVisible();
    view.rerender(<MurphyCallControls {...props} calls={[{ ...call, murphyTarget: 'birdie' }]}
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
