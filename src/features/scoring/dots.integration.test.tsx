import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dotsFixture } from '../dots/dots.test-support';
import { EventChangedError } from '../../client/events';
import { OwnerScoresView } from './OwnerScoresView';
import { memoryScores } from './scoring.test-support';

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

describe('separate Dots in the scoring workflow', () => {
  it('saves the chosen first-played order with per-golfer specials in one canonical write and preserves it across partner blocks', async () => {
    const f = dotsFixture();
    if (!f.round.games) throw new Error('Missing fictional games.');
    const game = { ...f.game, version: 2 as const, mode: 'rotating' as const, rotationHoles: 3 as const };
    const round = { ...f.round, dotsRulesVersions: [1, 2] as const,
      groups: f.round.groups.map((group) => ({ ...group, startingHole: 8 })),
      cards: f.round.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'unplayed' as const } })) })),
      games: { ...f.round.games, configuration: { ...f.round.games.configuration, games: [game] } } };
    const store = memoryScores(round), user = userEvent.setup();
    render(<OwnerScoresView client={store.client} eventId={round.eventId} roundId={round.roundId} onSessionExpired={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Round scorecard' });
    await user.click(screen.getByRole('button', { name: 'Enter scores' }));
    await user.selectOptions(screen.getByLabelText('Jump to hole'), '9');
    for (const [index, playerId] of f.ids.entries()) await user.selectOptions(screen.getByLabelText(`Dots P${String(index + 1)}`), playerId);
    expect(store.client.save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Par for blanks' }));
    const scorer = round.cards[2];
    if (!scorer) throw new Error('Missing fictional golfer.');
    await user.click(screen.getByRole('button', { name: `Dots for ${scorer.displayName} · ${game.name}` }));
    await user.click(screen.getByRole('button', { name: `Increase Sandy for ${scorer.displayName}` }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByRole('form', { name: 'Group 1 hole 1 entry' });
    const first = vi.mocked(store.client.save).mock.calls[0];
    expect(first?.[2]).toBe(f.ids[0]);
    expect(first?.[3]).toBe(9);
    expect(first?.[4].dots?.[0]).toMatchObject({ number: 9, rotation: { playerIds: f.ids },
      players: [{ playerId: scorer.playerId, counts: { sandy: 1 } }] });
    expect(screen.queryByLabelText('Dots P1')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: `${game.name} partner rotation` })).getByText(/Cycle starts on hole 9/)).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Jump to hole'), '3');
    const firstName = round.cards[0]?.displayName ?? '', thirdName = round.cards[2]?.displayName ?? '';
    expect(screen.getByText(/Saved partners/)).toHaveTextContent(`${firstName} + ${thirdName}`);
    expect(store.client.save).toHaveBeenCalledTimes(4);
    expect(screen.getByRole('button', { name: `Clear ${game.name} hole specials` })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Jump to hole'), '9');
    await user.click(screen.getByRole('button', { name: `Clear ${game.name} hole specials` }));
    expect(screen.queryByLabelText('Dots P1')).not.toBeInTheDocument();
    expect(store.client.save).toHaveBeenCalledTimes(4);
    await user.click(screen.getByRole('button', { name: 'Discard unsaved scores' }));
    expect(store.read().cards[0]?.holes.find((hole) => hole.number === 9)?.score.dots?.[0]?.rotation?.playerIds).toEqual(f.ids);
  });

  it('fills personal pars in one tap while preserving explicit clears, pickups and another golfer’s canonical Dots draft', async () => {
    const f = dotsFixture();
    const [anchor, cleared, pickup, special] = f.f.cards;
    if (!anchor || !cleared || !pickup || !special) throw new Error('Missing fictional foursome.');
    const round = { ...f.round, cards: f.round.cards.map((card) => ({ ...card,
      holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'unplayed' as const } })) })),
      playerTees: [{ playerId: anchor.playerId, profile: { ...f.f.snapshot.teeProfile,
        holes: f.round.layout.map((hole) => ({ ...hole, par: 5 })) } }] };
    const store = memoryScores(round), user = userEvent.setup();
    render(<OwnerScoresView client={store.client} eventId={round.eventId} roundId={round.roundId} onSessionExpired={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Round scorecard' });
    await user.click(screen.getByRole('button', { name: 'Enter scores' }));
    fireEvent.change(screen.getByRole('textbox', { name: `${cleared.displayName} score` }), { target: { value: '4' } });
    fireEvent.change(screen.getByRole('textbox', { name: `${cleared.displayName} score` }), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: `Pickup X for ${pickup.displayName}` }));
    await user.click(screen.getByRole('button', { name: `Dots for ${special.displayName} · ${f.game.name}` }));
    expect(screen.getByRole('heading', { name: `Dots · ${special.displayName}` })).toHaveFocus();
    expect(screen.queryByLabelText(`Sandy count · ${anchor.displayName}`)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Increase Sandy for ${special.displayName}` }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: `Dots for ${special.displayName} · ${f.game.name}` })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Par for blanks' }));
    expect(screen.getByRole('textbox', { name: `${anchor.displayName} score` })).toHaveValue('5');
    expect(screen.getByRole('textbox', { name: `${cleared.displayName} score` })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: `${pickup.displayName} score` })).toHaveValue('X');
    expect(screen.getByRole('textbox', { name: `${special.displayName} score` })).toHaveValue(String(round.layout[0]?.par));
    expect(store.client.save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByRole('form', { name: 'Group 1 hole 2 entry' });
    const canonical = vi.mocked(store.client.save).mock.calls.find((call) => call[2] === anchor.playerId)?.[4];
    expect(canonical).toMatchObject({ kind: 'strokes', strokes: 5,
      dots: [{ gameId: f.game.id, players: [{ playerId: special.playerId, counts: { sandy: 1 } }] }] });
    expect(vi.mocked(store.client.save).mock.calls.some((call) => call[2] === special.playerId && call[4].dots !== undefined)).toBe(false);
    expect(screen.getByRole('textbox', { name: `${anchor.displayName} score` })).toHaveValue('');
  });

  it('retains and explains an invalid special count without sending any group rows or changing holes', async () => {
    const f = dotsFixture();
    const store = memoryScores(f.round);
    const user = userEvent.setup();
    render(<OwnerScoresView client={store.client} eventId={f.round.eventId} roundId={f.round.roundId} onSessionExpired={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Round scorecard' });
    await user.click(screen.getByRole('button', { name: 'Enter scores' }));
    const first = f.f.cards[0];
    if (!first) throw new Error('Missing fictional golfer');
    for (const value of ['1.5', '-1']) {
      await user.click(screen.getByRole('button', { name: `Dots for ${first.displayName} · ${f.game.name}` }));
      const field = screen.getByLabelText(`Sandy count · ${first.displayName}`);
      fireEvent.change(field, { target: { value } });
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('alert')).toHaveTextContent('Sandy count must be a whole number of 0 or more.');
      await user.click(screen.getByRole('button', { name: 'Done' }));
      await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
      expect(store.client.save).not.toHaveBeenCalled();
      expect(screen.getByRole('form', { name: 'Group 1 hole 1 entry' })).toBeVisible();
    }
    await user.click(screen.getByRole('button', { name: `Dots for ${first.displayName} · ${f.game.name}` }));
    const field = screen.getByLabelText(`Sandy count · ${first.displayName}`);
    fireEvent.change(field, { target: { value: '2' } });
    expect(field).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
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
    await user.click(screen.getByRole('button', { name: `Dots for ${first.displayName} · ${f.game.name}` }));
    const count = screen.getByLabelText(`Sandy count · ${first.displayName}`);
    const raw = within(screen.getByRole('article', { name: `${first.displayName} scorecard` })).getByRole('textbox');
    expect(raw.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(count, { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: `Call Paree · ${first.displayName}` }));
    await user.selectOptions(screen.getByLabelText(`Paree call 1 · ${first.displayName}`), 'success');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(store.client.save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Next hole/ }));
    expect(screen.getByText('Save or discard unsaved scores and game choices before changing holes.')).toBeVisible();
    const original = vi.mocked(store.client.save).getMockImplementation();
    if (!original) throw new Error('Missing fictional save');
    vi.mocked(store.client.save).mockRejectedValueOnce(new Error('Fictional connection interrupted')).mockImplementation(original);
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await waitFor(() => { expect(store.client.save).toHaveBeenCalledOnce(); });
    await user.click(screen.getByRole('button', { name: `Dots for ${first.displayName} · ${f.game.name}` }));
    expect(screen.getByLabelText(`Sandy count · ${first.displayName}`)).toHaveValue(2);
    expect(screen.getByLabelText(`Paree call 1 · ${first.displayName}`)).toHaveValue('success');
    const staged = vi.mocked(store.client.save).mock.calls[0];
    expect(staged?.[2]).toBe(f.round.groups[0]?.playerIds[0]);
    expect(staged?.[4].dots?.[0]?.players[0]?.counts).toEqual({ sandy: 2 });
    expect(staged?.[4].dots?.[0]?.players[0]?.calls).toEqual([
      expect.objectContaining({ kind: 'paree', result: 'success' }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Done' }));
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
    await user.click(screen.getByRole('button', { name: `Dots for ${first.displayName} · ${f.game.name}` }));
    fireEvent.change(screen.getByLabelText(`Sandy count · ${first.displayName}`), { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    vi.mocked(store.client.save).mockRejectedValueOnce(new EventChangedError('Fictional changed card'));
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: `Dots for ${first.displayName} · ${f.game.name}` })).toBeDisabled(); });
    act(() => {
      store.replace({ ...store.read(), cards: store.read().cards.map((card) => card.playerId === first.playerId
        ? { ...card, etag: 'fictional-refreshed-card', holes: card.holes.map((hole) => hole.number === 1
          ? { ...hole, score: { kind: 'strokes', strokes: 3 } } : hole) } : card) });
    });
    await user.click(screen.getByRole('button', { name: 'Refresh saved round' }));
    const row = within(screen.getByRole('article', { name: `${first.displayName} scorecard` }));
    await user.click(row.getByRole('button', { name: /Review my value/ }));
    expect(row.getByRole('textbox')).toHaveValue('3');
    await user.click(screen.getByRole('button', { name: `Dots for ${first.displayName} · ${f.game.name}` }));
    expect(screen.getByLabelText(`Sandy count · ${first.displayName}`)).toHaveValue(2);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Discard unsaved scores' }));
    expect(store.client.save).toHaveBeenCalledOnce();
    expect(store.read().cards.find((card) => card.playerId === first.playerId)?.holes.find((hole) => hole.number === 1)?.score)
      .toEqual({ kind: 'strokes', strokes: 3 });
  });
});
