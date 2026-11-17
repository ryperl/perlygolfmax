import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { dotsFixture } from '../dots/dots.test-support';
import { EventChangedError } from '../../client/events';
import { OwnerScoresView } from './OwnerScoresView';
import { memoryScores } from './scoring.test-support';

describe('separate Dots in the scoring workflow', () => {
  it('retains and explains an invalid special count without sending any group rows or changing holes', async () => {
    const f = dotsFixture();
    const store = memoryScores(f.round);
    const user = userEvent.setup();
    render(<OwnerScoresView client={store.client} eventId={f.round.eventId} roundId={f.round.roundId} onSessionExpired={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Round scorecard' });
    await user.click(screen.getByRole('button', { name: 'Enter scores' }));
    const first = f.f.cards[0];
    if (!first) throw new Error('Missing fictional golfer');
    await user.click(screen.getByText(`${first.displayName} · Specials and calls`));
    const field = screen.getByLabelText(`Sandy count · ${first.displayName}`);
    for (const value of ['1.5', '-1']) {
      fireEvent.change(field, { target: { value } });
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('alert')).toHaveTextContent('Sandy count must be a whole number of 0 or more.');
      await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
      expect(store.client.save).not.toHaveBeenCalled();
      expect(screen.getByRole('form', { name: 'Group 1 hole 1 entry' })).toBeVisible();
    }
    fireEvent.change(field, { target: { value: '2' } });
    expect(field).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByRole('form', { name: 'Group 1 hole 2 entry' });
    expect(store.client.save).toHaveBeenCalledOnce();
  });
  it('stages below raw fields, retains counts and calls on save failure and advances only after acknowledgement', async () => {
    const f = dotsFixture();
    const store = memoryScores(f.round);
    const user = userEvent.setup();
    render(<OwnerScoresView client={store.client} eventId={f.round.eventId} roundId={f.round.roundId} onSessionExpired={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Round scorecard' });
    await user.click(screen.getByRole('button', { name: 'Enter scores' }));
    const first = f.f.cards[0];
    if (!first) throw new Error('Missing fictional golfer');
    await user.click(screen.getByText(`${first.displayName} · Specials and calls`));
    const count = screen.getByLabelText(`Sandy count · ${first.displayName}`);
    const raw = within(screen.getByRole('article', { name: `${first.displayName} scorecard` })).getByRole('textbox');
    expect(raw.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(count, { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: `Call Paree · ${first.displayName}` }));
    await user.selectOptions(screen.getByLabelText(`Paree call 1 · ${first.displayName}`), 'failure');
    expect(store.client.save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Next hole/ }));
    expect(screen.getByText('Save or discard unsaved scores and game choices before changing holes.')).toBeVisible();
    const original = vi.mocked(store.client.save).getMockImplementation();
    if (!original) throw new Error('Missing fictional save');
    vi.mocked(store.client.save).mockRejectedValueOnce(new Error('Fictional connection interrupted')).mockImplementation(original);
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await waitFor(() => { expect(store.client.save).toHaveBeenCalledOnce(); });
    expect(screen.getByLabelText(`Sandy count · ${first.displayName}`)).toHaveValue(2);
    expect(screen.getByLabelText(`Paree call 1 · ${first.displayName}`)).toHaveValue('failure');
    const staged = vi.mocked(store.client.save).mock.calls[0];
    expect(staged?.[2]).toBe(f.round.groups[0]?.playerIds[0]);
    expect(staged?.[4].dots?.[0]?.players[0]?.counts).toEqual({ sandy: 2 });
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await waitFor(() => { expect(store.client.save).toHaveBeenCalledTimes(2); });
    expect(vi.mocked(store.client.save).mock.calls[1]?.[6]).toBe(staged?.[6]);
    expect(vi.mocked(store.client.save).mock.calls[1]?.[4].dots).toEqual(staged?.[4].dots);
    await screen.findByRole('form', { name: 'Group 1 hole 2 entry' });
  });

  it('keeps Dots in conflict until explicit refresh/review, preserves refreshed raw scores, and discards only unsaved changes', async () => {
    const f = dotsFixture();
    const store = memoryScores(f.round);
    const user = userEvent.setup();
    render(<OwnerScoresView client={store.client} eventId={f.round.eventId} roundId={f.round.roundId} onSessionExpired={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Round scorecard' });
    await user.click(screen.getByRole('button', { name: 'Enter scores' }));
    const first = f.f.cards[0];
    if (!first) throw new Error('Missing fictional golfer');
    await user.click(screen.getByText(`${first.displayName} · Specials and calls`));
    fireEvent.change(screen.getByLabelText(`Sandy count · ${first.displayName}`), { target: { value: '2' } });
    vi.mocked(store.client.save).mockRejectedValueOnce(new EventChangedError('Fictional changed card'));
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await waitFor(() => { expect(screen.getByLabelText(`Sandy count · ${first.displayName}`)).toBeDisabled(); });
    act(() => {
      store.replace({ ...store.read(), cards: store.read().cards.map((card) => card.playerId === first.playerId
        ? { ...card, etag: 'fictional-refreshed-card', holes: card.holes.map((hole) => hole.number === 1
          ? { ...hole, score: { kind: 'strokes', strokes: 3 } } : hole) } : card) });
    });
    await user.click(screen.getByRole('button', { name: 'Refresh saved round' }));
    const row = within(screen.getByRole('article', { name: `${first.displayName} scorecard` }));
    await user.click(row.getByRole('button', { name: /Review my value/ }));
    expect(row.getByRole('textbox')).toHaveValue('3');
    expect(screen.getByLabelText(`Sandy count · ${first.displayName}`)).toHaveValue(2);
    await user.click(screen.getByRole('button', { name: 'Discard unsaved scores' }));
    expect(store.client.save).toHaveBeenCalledOnce();
    expect(store.read().cards.find((card) => card.playerId === first.playerId)?.holes.find((hole) => hole.number === 1)?.score)
      .toEqual({ kind: 'strokes', strokes: 3 });
  });
});
