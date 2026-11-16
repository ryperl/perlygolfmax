import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { OwnerScoresView } from './OwnerScoresView';
import { fictionalKpRound } from '../kp/kp.test-support';
import { deferred, memoryScores } from './scoring.test-support';
import { EventChangedError } from '../../client/events';
import { fictionalChange, scoreResult } from '../../client/scoring.test-support';

beforeAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', ''); } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open'); } },
  });
});
afterAll(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});
describe('atomic KP + raw score drafts and after-round entry', () => {
  it('distance-only conflict review preserves a concurrent saved stroke correction instead of rewriting it', async () => {
    const round = fictionalKpRound();
    const store = memoryScores(round);
    render(<OwnerScoresView client={store.client} eventId={round.eventId} roundId={round.roundId} onSessionExpired={vi.fn()} />);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Round scorecard' });
    await user.click(screen.getByRole('button', { name: 'KP Competition' }));
    const first = round.cards[0];
    if (!first) throw new Error('Missing fixture');
    await user.click(screen.getByRole('button', { name: `KP for ${first.displayName}` }));
    await user.click(screen.getByRole('button', { name: 'No measurement' }));
    store.replace(scoreResult({ ...fictionalChange, playerId: first.playerId, after: { kind: 'strokes', strokes: 6 } }, round).round);
    await user.click(screen.getByRole('button', { name: 'Save KP entries' }));
    expect(await screen.findByText(/Hole changed. Saved KP/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Refresh saved round' }));
    await user.click(screen.getByRole('button', { name: `Review KP for ${first.displayName}` }));
    await user.click(screen.getByRole('button', { name: 'Save KP entries' }));
    await user.click(await within(screen.getByRole('article', { name: 'KP hole 1 results' })).findByText('No measurement (1)'));
    expect(await screen.findByText(`${first.displayName}: No measurement`)).toBeVisible();
    expect(store.read().cards[0]?.holes[0]?.score).toEqual({ kind: 'strokes', strokes: 6, kp: { kind: 'no-measurement' } });
  });
  it('guards distance-only drafts and advances only after their same score-write acknowledgement', async () => {
    const round = fictionalKpRound();
    const store = memoryScores(round);
    const blocked = vi.fn();
    render(<OwnerScoresView client={store.client} eventId={round.eventId} roundId={round.roundId} onSessionExpired={vi.fn()} onNavigationBlockedChange={blocked} />);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Round scorecard' });
    await user.click(screen.getByRole('button', { name: 'Enter scores' }));
    const first = round.cards[0];
    if (!first) throw new Error('Missing fixture');
    await user.click(screen.getByRole('button', { name: `KP for ${first.displayName}` }));
    const dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'No measurement' }));
    expect(blocked).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Next hole' }));
    expect(screen.getByRole('heading', { name: 'Hole 1' })).toBeVisible();
    const original = vi.mocked(store.client.save).getMockImplementation();
    if (!original) throw new Error('Missing fixture saver');
    const pending = deferred<Awaited<ReturnType<typeof store.client.save>>>();
    vi.mocked(store.client.save).mockReturnValueOnce(pending.promise);
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    expect(screen.getByRole('heading', { name: 'Hole 1' })).toBeVisible();
    const call = vi.mocked(store.client.save).mock.calls[0];
    if (!call) throw new Error('Missing save');
    expect(call[4]).toEqual({ kind: 'unplayed', kp: { kind: 'no-measurement' } });
    await act(async () => { pending.resolve(await original(...call)); });
    expect(await screen.findByRole('heading', { name: 'Hole 2' })).toBeVisible();
    expect(store.client.save).toHaveBeenCalledOnce();
    expect(store.read().setupLocked).toBe(true);
  });
  it('afterward edits use the same path; conflict/failure stays on the hole with drafts and discard-all leaves server data unchanged', async () => {
    const round = fictionalKpRound();
    const store = memoryScores(round);
    render(<OwnerScoresView client={store.client} eventId={round.eventId} roundId={round.roundId} onSessionExpired={vi.fn()} />);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Round scorecard' });
    await user.click(screen.getByRole('button', { name: 'KP Competition' }));
    const first = round.cards[0];
    if (!first) throw new Error('Missing fixture');
    await user.click(screen.getByRole('button', { name: `KP for ${first.displayName}` }));
    await user.click(screen.getByRole('button', { name: 'No measurement' }));
    vi.mocked(store.client.save).mockRejectedValueOnce(new EventChangedError('Fictional conflict'));
    await user.click(screen.getByRole('button', { name: 'Save KP entries' }));
    expect(await screen.findByText(/remaining not confirmed/)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Hole 1 · Group 1' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'KP for ' + first.displayName })).toHaveTextContent('unsaved');
    await user.click(screen.getByRole('button', { name: 'Discard all round drafts' }));
    expect(store.read().cards[0]?.holes[0]?.score.kp).toBeUndefined();
    await user.click(screen.getByRole('button', { name: `KP for ${first.displayName}` }));
    await user.click(screen.getByRole('button', { name: 'No measurement' }));
    await user.click(screen.getByRole('button', { name: 'Save KP entries' }));
    await user.click(await within(screen.getByRole('article', { name: 'KP hole 1 results' })).findByText('No measurement (1)'));
    expect(await screen.findByText(`${first.displayName}: No measurement`)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Hole 1 · Group 1' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('KP hole'), { target: { value: '2' } });
    expect(screen.getByRole('heading', { name: 'Hole 2 · Group 1' })).toBeVisible();
  });
});
