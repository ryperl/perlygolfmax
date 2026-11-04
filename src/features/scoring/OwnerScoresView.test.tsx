import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EventChangedError, SessionExpiredError } from '../../client/events';
import { PrivateRequestError } from '../../client/private-request';
import { fictionalChange, fictionalRoundScores, scoreResult } from '../../client/scoring.test-support';
import { fictionalId } from '../../client/catalog.test-support';
import type { ScoreWriteResult } from '../../domain/scoring';
import { maximumExactHoleStrokes } from '../../domain/scoring';
import { OwnerScoresView } from './OwnerScoresView';
import { deferred, memoryScores } from './scoring.test-support';

function row(number = 1) {
  return within(screen.getByRole('article', { name: `Fictional Player ${String(number)} scorecard` }));
}
function input(number = 1) { return row(number).getByRole('textbox'); }
async function enter(user: ReturnType<typeof userEvent.setup>, text: string, player = 1) {
  await user.clear(input(player));
  if (text) await user.type(input(player), text);
}
async function fourScores(user: ReturnType<typeof userEvent.setup>) {
  for (let player = 1; player <= 4; player++) await user.click(row(player).getByRole('button', { name: `4 strokes for Fictional Player ${String(player)}` }));
}
function mount(store = memoryScores()) {
  const onSessionExpired = vi.fn();
  return { ...store, onSessionExpired, ...render(<OwnerScoresView client={store.client} eventId={fictionalRoundScores.eventId}
    roundId={fictionalRoundScores.roundId} onSessionExpired={onSessionExpired} />) };
}
async function loaded() { await screen.findByRole('textbox', { name: 'Fictional Player 1 score' }); }

describe('hole-first owner scoring', () => {
  it('shows only one hole and at most four empty entry rows, with honest online and first-save warnings', async () => {
    const { client } = mount();
    await loaded();
    expect(screen.getAllByRole('textbox')).toHaveLength(4);
    expect(screen.getAllByRole('form')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Hole 1' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Previous hole' })).toBeDisabled();
    for (const field of screen.getAllByRole('textbox')) expect(field).toHaveValue('');
    expect(screen.getByText(/Unsaved drafts live only in this page/)).toBeVisible();
    expect(screen.getByText(/first accepted score locks course, tee, roster, groups and captured indices/)).toHaveTextContent('Clearing scores does not unlock setup.');
    expect(screen.getByRole('table')).not.toBeVisible();
    expect(screen.queryByRole('heading', { name: /Group 2/ })).not.toBeInTheDocument();
    expect(client.save).not.toHaveBeenCalled();
  });
  it('uses four explicit taps and one Save & Next to save a group, then uses persisted card baselines on the next hole', async () => {
    const { client } = mount();
    await loaded();
    const user = userEvent.setup();
    await fourScores(user);
    expect(client.save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByRole('heading', { name: 'Hole 2' });
    expect(client.save).toHaveBeenCalledTimes(4);
    expect(vi.mocked(client.save).mock.calls.map((call) => call[5])).toEqual([null, null, null, null]);
    for (const field of screen.getAllByRole('textbox')) expect(field).toHaveValue('');
    await fourScores(user);
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByRole('heading', { name: 'Hole 3' });
    expect(client.save).toHaveBeenCalledTimes(8);
    expect(vi.mocked(client.save).mock.calls.slice(4).map((call) => call[5])).toEqual([
      'fictional-card-1', 'fictional-card-2', 'fictional-card-3', 'fictional-card-4',
    ]);
  });
  it('allows unchanged blanks to stay unplayed and advance without fake writes or default par', async () => {
    const { client } = mount();
    await loaded();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByRole('heading', { name: 'Hole 2' });
    expect(screen.getByText(/No changes sent; 4 unplayed/)).toBeVisible();
    expect(client.save).not.toHaveBeenCalled();
    await user.click(row().getByRole('button', { name: '4 strokes for Fictional Player 1' }));
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByRole('heading', { name: 'Hole 3' });
    expect(client.save).toHaveBeenCalledOnce();
    expect(vi.mocked(client.save).mock.calls[0]?.[3]).toBe(2);
    expect(screen.getByText(/1 player changes acknowledged; 3 unplayed/)).toBeVisible();
  });
  it('prevalidates every intended row before sending anything, including invalid pickup and exact-safe bounds', async () => {
    const { client } = mount();
    await loaded();
    const user = userEvent.setup();
    await enter(user, '4');
    await enter(user, '0', 2);
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    expect(client.save).not.toHaveBeenCalled();
    expect(screen.getByText(/Nothing sent. Check every intended entry/)).toBeVisible();
    await enter(user, 'X0', 2);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(client.save).not.toHaveBeenCalled();
    await enter(user, String(maximumExactHoleStrokes + 1), 2);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(client.save).not.toHaveBeenCalled();
    expect(input()).toHaveValue('4');
    expect(screen.getByRole('heading', { name: 'Hole 1' })).toBeVisible();
  });
  it('keeps unsaved shorthand across group and hole navigation without changing group assignments', async () => {
    const cards = Array.from({ length: 8 }, (_, index) => {
      const card = fictionalRoundScores.cards[index % 4];
      if (!card) throw new Error('Missing fictional card');
      return { ...card, playerId: fictionalId(index + 1), displayName: `Fictional Player ${String(index + 1)}` };
    });
    const groups = [{ number: 1, playerIds: cards.slice(0, 4).map((card) => card.playerId) },
      { number: 2, playerIds: cards.slice(4).map((card) => card.playerId) }];
    const { client } = mount(memoryScores({ ...fictionalRoundScores, cards, groups }));
    await loaded();
    const user = userEvent.setup();
    await enter(user, 'X7');
    await user.selectOptions(screen.getByLabelText('Jump to hole'), '2');
    await enter(user, '5', 2);
    await user.selectOptions(screen.getByLabelText('View group'), '2');
    expect(screen.getAllByRole('textbox')).toHaveLength(4);
    expect(screen.queryByRole('article', { name: 'Fictional Player 1 scorecard' })).not.toBeInTheDocument();
    await enter(user, 'DNF', 5);
    await user.selectOptions(screen.getByLabelText('View group'), '1');
    expect(input(2)).toHaveValue('5');
    await user.click(screen.getByRole('button', { name: 'Previous hole' }));
    expect(input()).toHaveValue('X7');
    expect(screen.getByText(/3 unsaved \/ review values in this page/)).toBeVisible();
    expect(client.save).not.toHaveBeenCalled();
  });
  it('supports direct scores, +/- and the touch X toggle, persisting X7 as incomplete reported strokes', async () => {
    const { client } = mount();
    await loaded();
    const user = userEvent.setup();
    await enter(user, '6');
    await user.click(row().getByRole('button', { name: 'Increase score for Fictional Player 1' }));
    await user.click(row().getByRole('button', { name: 'Pickup X for Fictional Player 1' }));
    expect(input()).toHaveValue('X7');
    await enter(user, 'DNF', 2);
    await user.click(row(3).getByRole('button', { name: 'Pickup X for Fictional Player 3' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/3 player changes acknowledged/);
    expect(screen.getByRole('heading', { name: 'Hole 1' })).toBeVisible();
    expect(vi.mocked(client.save).mock.calls.map((call) => call[4])).toEqual([
      { kind: 'picked-up', reportedStrokes: 7 }, { kind: 'did-not-finish' }, { kind: 'picked-up' },
    ]);
    expect(input()).toHaveValue('X7');
    await user.click(screen.getByRole('button', { name: 'Scorecards' }));
    const saved = within(screen.getByRole('article', { name: 'Fictional Player 1 saved scorecard' }));
    expect(saved.getByText(/Recorded strokes: 7 across 1\/9 recorded holes; 0 completed/)).toHaveTextContent('Incomplete');
  });
  it('clearing an existing score is an audited unplayed write, while an untouched blank is not written', async () => {
    const { client } = mount(memoryScores(scoreResult().round));
    await loaded();
    const user = userEvent.setup();
    expect(input()).toHaveValue('4');
    await user.clear(input());
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/1 player changes acknowledged; 4 unplayed/);
    expect(client.save).toHaveBeenCalledOnce();
    expect(vi.mocked(client.save).mock.calls[0]?.[4]).toEqual({ kind: 'unplayed' });
    expect(vi.mocked(client.save).mock.calls[0]?.[5]).toBe('card-v2');
    expect(input()).toHaveValue('');
  });
  it('serializes one active group mutation, preserves partial failures, retries only unacknowledged values with the same IDs', async () => {
    const store = memoryScores();
    const normal = vi.mocked(store.client.save).getMockImplementation();
    if (!normal) throw new Error('Missing fictional save');
    let failed = false;
    vi.mocked(store.client.save).mockImplementation((...args) => {
      if (args[2] === fictionalId(2) && !failed) { failed = true; return Promise.reject(new Error('Network failed.')); }
      return normal(...args);
    });
    mount(store);
    await loaded();
    const user = userEvent.setup();
    await fourScores(user);
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByText(/1 saved \/ 3 remaining not confirmed/);
    expect(row().getByText('Saved', { exact: true })).toBeVisible();
    expect(row(2).getByText('Failed — retry')).toBeVisible();
    expect(input(2)).toHaveValue('4');
    expect(input(3)).toHaveValue('4');
    const firstB = vi.mocked(store.client.save).mock.calls[1];
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByRole('heading', { name: 'Hole 2' });
    const calls = vi.mocked(store.client.save).mock.calls;
    expect(calls).toHaveLength(5);
    expect(calls.filter((call) => call[2] === fictionalId(1))).toHaveLength(1);
    expect(calls[2]?.[6]).toBe(firstB?.[6]);
    expect(calls[2]?.[5]).toBe(firstB?.[5]);
  });
  it('replays a timeout-after-save receipt, preserving its old base even after explicit refresh shows X7 persisted', async () => {
    const store = memoryScores();
    const normal = vi.mocked(store.client.save).getMockImplementation();
    if (!normal) throw new Error('Missing fictional save');
    let first = true;
    vi.mocked(store.client.save).mockImplementation(async (...args) => {
      const result = await normal(...args);
      if (first) { first = false; throw new Error('Timed out after persistence.'); }
      return result;
    });
    mount(store);
    await loaded();
    const user = userEvent.setup();
    await enter(user, 'X7');
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByText(/0 saved \/ 1 remaining not confirmed/);
    await user.click(screen.getByRole('button', { name: 'Refresh saved round' }));
    await screen.findByText(/Saved round refreshed/);
    expect(input()).toHaveValue('X7');
    expect(row().getByText(/Saved: X7 — picked up/)).toBeVisible();
    expect(row().getByText('Failed — retry')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByRole('heading', { name: 'Hole 2' });
    const calls = vi.mocked(store.client.save).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[5]).toBeNull();
    expect(calls[1]?.[6]).toBe(calls[0]?.[6]);
  });
  it('does not present a throttled retry as saving or bypass the server minimum', async () => {
    const store = memoryScores();
    vi.mocked(store.client.save).mockRejectedValueOnce(new PrivateRequestError(429, 'Too many requests.', 60));
    mount(store);
    await loaded();
    const user = userEvent.setup();
    await fourScores(user);
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByText(/0 saved \/ 4 remaining not confirmed/);
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    expect(await screen.findByText(/No new requests sent. Wait for the active operation or service retry delay/)).toBeVisible();
    expect(store.client.save).toHaveBeenCalledOnce();
    expect(input()).toHaveValue('4');
    expect(screen.getByRole('alert')).toHaveTextContent('Wait at least 60 seconds');
  });
  it('never adopts B’s later card revision from A’s projection without explicit refresh and review', async () => {
    const store = memoryScores();
    const normal = vi.mocked(store.client.save).getMockImplementation();
    if (!normal) throw new Error('Missing fictional save');
    let first = true;
    vi.mocked(store.client.save).mockImplementation(async (...args) => {
      const result = await normal(...args);
      if (!first) return result;
      first = false;
      const changed = scoreResult({ ...fictionalChange, playerId: fictionalId(2), after: { kind: 'strokes', strokes: 9 } }, result.round).round;
      const latest = { ...changed, cards: changed.cards.map((card) => card.playerId === fictionalId(2) ? { ...card, etag: 'other-owner-b' } : card) };
      store.replace(latest);
      return { ...result, round: latest };
    });
    const { client } = mount(store);
    await loaded();
    const user = userEvent.setup();
    await fourScores(user);
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByText(/1 saved \/ 3 remaining not confirmed/);
    expect(client.save).toHaveBeenCalledOnce();
    expect(input(2)).toHaveValue('4');
    expect(row(2).getByText(/Saved: 9 strokes/)).toBeVisible();
    const review = row(2).getByRole('button', { name: 'Review my value for Fictional Player 2' });
    expect(review).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Refresh saved round' }));
    await waitFor(() => { expect(review).toBeEnabled(); });
    await user.click(review);
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByRole('heading', { name: 'Hole 2' });
    expect(vi.mocked(client.save).mock.calls[1]?.[5]).toBe('other-owner-b');
    expect(client.save).toHaveBeenCalledTimes(4);
  });
  it('does not advance when a later returned projection overwrites an acknowledged X7 with X8', async () => {
    const store = memoryScores();
    const normal = vi.mocked(store.client.save).getMockImplementation();
    if (!normal) throw new Error('Missing fictional save');
    vi.mocked(store.client.save).mockImplementation(async (...args) => {
      const result = await normal(...args);
      if (args[2] !== fictionalId(4)) return result;
      const later = scoreResult({ ...fictionalChange, after: { kind: 'picked-up', reportedStrokes: 8 } }, result.round).round;
      store.replace(later);
      return { ...result, round: later };
    });
    const { client } = mount(store);
    await loaded();
    const user = userEvent.setup();
    await fourScores(user);
    await enter(user, 'X7');
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByText(/3 saved \/ 1 remaining not confirmed/);
    expect(screen.getByRole('heading', { name: 'Hole 1' })).toBeVisible();
    expect(input()).toHaveValue('X7');
    expect(row().getByText(/Saved: X8/)).toBeVisible();
    expect(row().getByText('Saved, then changed — review')).toBeVisible();
    expect(client.save).toHaveBeenCalledTimes(4);
    await user.click(row().getByRole('button', { name: 'Use saved value for Fictional Player 1' }));
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByRole('heading', { name: 'Hole 2' });
    expect(client.save).toHaveBeenCalledTimes(4);
  });
  it('keeps server conflicts until refreshed/reviewed, and explicit changed intent gets a fresh request ID', async () => {
    const store = memoryScores();
    vi.mocked(store.client.save).mockRejectedValueOnce(new EventChangedError('Concurrent correction.'));
    const { client } = mount(store);
    await loaded();
    const user = userEvent.setup();
    await enter(user, '4');
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByText(/remaining not confirmed/);
    const original = vi.mocked(client.save).mock.calls[0]?.[6];
    const review = row().getByRole('button', { name: 'Review my value for Fictional Player 1' });
    expect(review).toBeDisabled();
    await enter(user, '5');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(client.save).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Refresh saved round' }));
    await waitFor(() => { expect(review).toBeEnabled(); });
    await user.click(review);
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByRole('heading', { name: 'Hole 2' });
    expect(vi.mocked(client.save).mock.calls[1]?.[6]).not.toBe(original);
    expect(vi.mocked(client.save).mock.calls[1]?.[4]).toEqual({ kind: 'strokes', strokes: 5 });
  });
  it('opens scorecards after the last source hole without inventing formal finalization', async () => {
    const { client } = mount();
    await loaded();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Jump to hole'), '9');
    expect(screen.getByRole('button', { name: 'Next hole' })).toBeDisabled();
    await enter(user, 'X7');
    await user.click(screen.getByRole('button', { name: 'Save Hole' }));
    expect(await screen.findByRole('heading', { name: 'Saved scorecards' })).toBeVisible();
    expect(screen.getByText(/Scorecards opened for review; the round is not finalized/)).toBeVisible();
    expect(client.save).toHaveBeenCalledOnce();
    expect(vi.mocked(client.save).mock.calls[0]?.[3]).toBe(9);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Finalize|Finish round/ })).not.toBeInTheDocument();
  });
  it('stays on last-hole entry when a save fails', async () => {
    const store = memoryScores();
    vi.mocked(store.client.save).mockRejectedValueOnce(new Error('Network lost.'));
    mount(store);
    await loaded();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Jump to hole'), '9');
    await enter(user, '4');
    await user.click(screen.getByRole('button', { name: 'Save Hole' }));
    await screen.findByText(/Stayed on hole 9/);
    expect(screen.getByRole('heading', { name: 'Hole 9' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Saved scorecards' })).not.toBeInTheDocument();
  });
  it('keeps reads and polling out of the entire multi-player save, aborting late private responses on unmount', async () => {
    const store = memoryScores();
    const pending = deferred<ScoreWriteResult>();
    vi.mocked(store.client.save).mockReturnValueOnce(pending.promise);
    const view = mount(store);
    await loaded();
    const user = userEvent.setup();
    await fourScores(user);
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    expect(store.client.save).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Refresh saved round' })).toBeDisabled();
    expect(screen.getByLabelText('View group')).toBeDisabled();
    expect(row().getByText('Saving…')).toBeVisible();
    const signal = vi.mocked(store.client.save).mock.calls[0]?.[7];
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => { pending.resolve(scoreResult()); await pending.promise; });
    expect(store.client.save).toHaveBeenCalledOnce();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('starts fresh route-local drafts and aborts the old group mutation when event/round props change', async () => {
    const store = memoryScores();
    const pending = deferred<ScoreWriteResult>();
    vi.mocked(store.client.save).mockReturnValueOnce(pending.promise);
    const view = mount(store);
    await loaded();
    const user = userEvent.setup();
    await fourScores(user);
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    const previousSignal = vi.mocked(store.client.save).mock.calls[0]?.[7];
    const nextRound = { ...fictionalRoundScores, roundId: fictionalId(71) };
    store.replace(nextRound);
    view.rerender(<OwnerScoresView client={store.client} eventId={nextRound.eventId} roundId={nextRound.roundId} onSessionExpired={view.onSessionExpired} />);
    await loaded();
    expect(previousSignal?.aborted).toBe(true);
    for (const field of screen.getAllByRole('textbox')) expect(field).toHaveValue('');
    await act(async () => { pending.resolve(scoreResult()); await pending.promise; });
    expect(store.client.save).toHaveBeenCalledOnce();
    expect(input()).toHaveValue('');
    expect(screen.getByText(/0 unsaved \/ review values in this page/)).toBeVisible();
  });
  it('removes previously acknowledged score details as well as entry rows on authoritative owner revocation', async () => {
    const store = memoryScores();
    mount(store);
    await loaded();
    const user = userEvent.setup();
    await enter(user, '4');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/1 player changes acknowledged/);
    const id = vi.mocked(store.client.save).mock.calls[0]?.[6];
    if (!id) throw new Error('Missing fictional request ID');
    vi.mocked(store.client.load).mockRejectedValueOnce(new PrivateRequestError(403, 'Owner access revoked.'));
    await user.click(screen.getByRole('button', { name: 'Refresh saved round' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Owner access revoked');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(id))).not.toBeInTheDocument();
  });
  it('provides audit toggle + Close history, and a response completing after close never reopens it', async () => {
    const store = memoryScores();
    const pending = deferred<{ readonly changes: readonly typeof fictionalChange[]; readonly continuationToken: string }>();
    vi.mocked(store.client.history).mockReturnValueOnce(pending.promise).mockResolvedValueOnce({
      changes: [{ ...fictionalChange, id: fictionalId(402), after: { kind: 'picked-up', reportedStrokes: 7 } }],
    });
    mount(store);
    await loaded();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Scorecards' }));
    const toggle = screen.getByRole('button', { name: 'History for Fictional Player 1' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    const close = await screen.findByRole('button', { name: 'Close history for Fictional Player 1' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', `score-history-${fictionalId(1)}`);
    await user.click(close);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await act(async () => { pending.resolve({ changes: [fictionalChange], continuationToken: 'next-page' }); await pending.promise; });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Fictional Player 1 audit history' })).not.toBeInTheDocument();
    await user.click(toggle);
    expect(store.client.history).toHaveBeenCalledOnce();
    const history = screen.getByRole('region', { name: 'Fictional Player 1 audit history' });
    expect(history).toHaveTextContent('Unplayed → 4 strokes');
    await user.click(screen.getByRole('button', { name: 'More history for Fictional Player 1' }));
    await waitFor(() => { expect(history).toHaveTextContent('X7 — picked up; 7 reported, incomplete'); });
    expect(vi.mocked(store.client.history).mock.calls[1]?.[4]).toBe('next-page');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
  it('keeps archives read-only, hides private entry on owner denial, and routes expiry explicitly', async () => {
    const archived = mount(memoryScores({ ...fictionalRoundScores, eventStatus: 'archived' }));
    await loaded();
    expect(input()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save & Next Hole' })).toBeDisabled();
    expect(screen.getByText(/Archived event: owner read-only/)).toBeVisible();
    archived.unmount();
    const deniedStore = memoryScores();
    vi.mocked(deniedStore.client.load).mockRejectedValueOnce(new PrivateRequestError(403, 'Owner access denied.'));
    const denied = mount(deniedStore);
    expect(await screen.findByRole('alert')).toHaveTextContent('Owner access denied');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    denied.unmount();
    const expiredStore = memoryScores();
    vi.mocked(expiredStore.client.load).mockRejectedValueOnce(new SessionExpiredError('Sign in again.'));
    const expired = mount(expiredStore);
    await screen.findByRole('alert');
    expect(expired.onSessionExpired).toHaveBeenCalledWith('Sign in again.');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
