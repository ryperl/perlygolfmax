import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fictionalChange, fictionalRoundScores, scoreResult } from '../../client/scoring.test-support';
import type { RoundScores, ScoreWriteResult } from '../../domain/scoring';
import type { ScoreLocation } from '../../domain/score-location';
import { OwnerScoresView } from './OwnerScoresView';
import { deferred, memoryScores } from './scoring.test-support';

const initial: ScoreLocation = { groupNumber: 1, holeNumber: 2, view: 'entry' };
const props = { eventId: fictionalRoundScores.eventId, roundId: fictionalRoundScores.roundId, onSessionExpired: vi.fn() };
function input() { return screen.getByRole('textbox', { name: 'Fictional Player 1 score' }); }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('stable scoring place', () => {
  it('restores entry only once per scope; callback, initial prop and server projections do not reset it', async () => {
    const store = memoryScores();
    const first = vi.fn();
    const next = vi.fn();
    const { rerender } = render(<OwnerScoresView {...props} client={store.client} initialLocation={initial} onLocationChange={first} />);
    await screen.findByRole('heading', { name: 'Hole 2' });
    expect(first).toHaveBeenLastCalledWith(initial);
    fireEvent.change(screen.getByLabelText('Jump to hole'), { target: { value: '3' } });
    fireEvent.change(input(), { target: { value: '6' } });
    const field = input();
    rerender(<OwnerScoresView {...props} client={store.client} initialLocation={{ ...initial, holeNumber: 1, view: 'cards' }} onLocationChange={next} />);
    expect(screen.getByRole('heading', { name: 'Hole 3' })).toBeVisible();
    expect(input()).toBe(field);
    expect(input()).toHaveValue('6');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); await Promise.resolve(); });
    expect(screen.getByText(/Saved — 1 player changes acknowledged/)).toBeVisible();
    expect(input()).toBe(field);
    expect(input()).toHaveValue('6');
    expect(screen.getByRole('heading', { name: 'Hole 3' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    expect(next).toHaveBeenLastCalledWith({ ...initial, holeNumber: 4 });
    fireEvent.click(screen.getByRole('button', { name: 'Scorecards' }));
    expect(next).toHaveBeenLastCalledWith({ ...initial, holeNumber: 4, view: 'cards' });
    fireEvent.click(screen.getByRole('button', { name: 'Enter scores' }));
    expect(screen.getByRole('heading', { name: 'Hole 4' })).toBeVisible();
  });

  it('normalizes defaults against server groups and holes, then retains that place if the defaults change', async () => {
    const store = memoryScores();
    const onLocationChange = vi.fn();
    render(<OwnerScoresView {...props} client={store.client} onLocationChange={onLocationChange} />);
    await screen.findByRole('heading', { name: 'Round scorecard' });
    expect(onLocationChange).toHaveBeenLastCalledWith({ groupNumber: 1, holeNumber: 1, view: 'cards' });
    store.replace({ ...store.read(), layout: store.read().layout.slice(1) });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh saved round' })); await Promise.resolve(); });
    expect(screen.getByRole('alert')).toHaveTextContent('scoring place is no longer available');
    expect(onLocationChange).toHaveBeenCalledTimes(1);
    expect(store.client.save).not.toHaveBeenCalled();
  });

  it('blocks stale restored groups/holes until both are explicitly selected, never silently substitutes', async () => {
    const store = memoryScores();
    const onLocationChange = vi.fn();
    render(<OwnerScoresView {...props} client={store.client}
      initialLocation={{ groupNumber: 99, holeNumber: 18, view: 'entry' }} onLocationChange={onLocationChange} />);
    await screen.findByRole('alert');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(onLocationChange).not.toHaveBeenCalled();
    const chooser = within(screen.getByRole('region', { name: 'Choose scoring place' }));
    fireEvent.change(chooser.getByLabelText('View group'), { target: { value: '1' } });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.change(chooser.getByLabelText('Jump to hole'), { target: { value: '2' } });
    expect(input()).toHaveValue('');
    expect(onLocationChange).toHaveBeenLastCalledWith(initial);
    expect(store.client.save).not.toHaveBeenCalled();
  });

  it('advances and focuses the non-input hole heading only after acknowledgement, retaining explicit unsaved status for new edits', async () => {
    const store = memoryScores();
    const pending = deferred<ScoreWriteResult>();
    vi.mocked(store.client.save).mockReturnValueOnce(pending.promise);
    const changed = vi.fn();
    render(<OwnerScoresView {...props} client={store.client} initialLocation={initial} onLocationChange={changed} />);
    await screen.findByRole('heading', { name: 'Hole 2' });
    fireEvent.change(input(), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    expect(changed).toHaveBeenLastCalledWith(initial);
    expect(screen.getByRole('heading', { name: 'Hole 2' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save & Next Hole' })).toBeDisabled();
    expect(screen.queryByText(/Saved —/)).not.toBeInTheDocument();
    const call = vi.mocked(store.client.save).mock.calls[0];
    if (!call) throw new Error('Missing fictional score write');
    await act(async () => {
      pending.resolve(scoreResult({ ...fictionalChange, id: call[6], holeNumber: 2 }));
      await pending.promise;
    });
    expect(screen.getByRole('heading', { name: 'Hole 3' })).toHaveFocus();
    expect(changed).toHaveBeenLastCalledWith({ ...initial, holeNumber: 3 });
    expect(screen.getByText(/Saved — 1 player changes acknowledged/)).toBeVisible();
    fireEvent.change(input(), { target: { value: '5' } });
    expect(screen.queryByText(/Saved —/)).not.toBeInTheDocument();
    expect(screen.getByText('Unsaved')).toBeVisible();
  });

  it('retains the place and draft after a failed write; unchanged blanks never claim Saved', async () => {
    const store = memoryScores();
    vi.mocked(store.client.save).mockRejectedValueOnce(new Error('Fictional connection failure'));
    const changed = vi.fn();
    render(<OwnerScoresView {...props} client={store.client} initialLocation={initial} onLocationChange={changed} />);
    await screen.findByRole('heading', { name: 'Hole 2' });
    fireEvent.change(input(), { target: { value: '4' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save & Next Hole' })); await Promise.resolve(); });
    expect(changed).toHaveBeenLastCalledWith(initial);
    expect(input()).toHaveValue('4');
    expect(screen.getByText(/remaining not confirmed/)).toBeVisible();
    expect(screen.queryByText(/Saved —/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard unsaved scores' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    expect(screen.getByText(/No changes sent/)).toBeVisible();
    expect(screen.queryByText(/Saved —/)).not.toBeInTheDocument();
    expect(store.client.save).toHaveBeenCalledOnce();
  });

  it('keeps hole/group/view and local values through an actual hidden-to-visible refresh', async () => {
    vi.useFakeTimers();
    const store = memoryScores();
    render(<OwnerScoresView {...props} client={store.client} initialLocation={initial} />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.change(input(), { target: { value: '7' } });
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => { await vi.advanceTimersByTimeAsync(20 * 60_000); });
    expect(store.client.load).toHaveBeenCalledOnce();
    const newer: RoundScores = scoreResult({ ...fictionalChange, holeNumber: 2, after: { kind: 'strokes', strokes: 5 } }).round;
    store.replace(newer);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    await act(async () => { fireEvent(document, new Event('visibilitychange')); await Promise.resolve(); });
    expect(store.client.load).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('heading', { name: 'Hole 2' })).toBeVisible();
    expect(input()).toHaveValue('7');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save & Next Hole' })); await Promise.resolve(); });
    expect(screen.getByText(/Nothing sent. Refresh saved round and review each conflict/)).toBeVisible();
    expect(store.client.save).not.toHaveBeenCalled();
  });
});
