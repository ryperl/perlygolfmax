import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { churchyV3Fixture } from '../../domain/churchy-v3.test-support';
import type { RoundScores } from '../../domain/scoring';
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

function initial(mode: 'tee' | 'approach' = 'approach') {
  const f = churchyV3Fixture(18, 10, mode);
  const cards = f.cards.map((card) => ({ ...card, etag: null, updatedAt: null,
    holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'unplayed' as const } })) }));
  const round: RoundScores = { ...f.round(cards), setupLocked: false, lastUpdatedAt: null };
  return { f, round };
}

function churcieStore(f: ReturnType<typeof churchyV3Fixture>, round: RoundScores) {
  const store = memoryScores(round);
  const original = vi.mocked(store.client.save).getMockImplementation();
  if (!original) throw new Error('Missing fictional score writer');
  vi.mocked(store.client.save).mockImplementation(async (...args) => {
    const result = await original(...args);
    const recalculated = f.round(result.round.cards);
    if (!result.round.games || !recalculated.games) throw new Error('Missing fictional game projection');
    const projected = { ...result.round, games: { ...result.round.games, results: recalculated.games.results } };
    store.replace(projected);
    return { ...result, round: projected };
  });
  return store;
}

describe('Churcie actual-circuit partner selection and shared specials', () => {
  it('discards a partial unsaved order without creating an empty score write or clearing a typed score', async () => {
    const { f, round } = initial(), store = churcieStore(f, round), user = userEvent.setup();
    const closest = f.ids[0];
    if (!closest) throw new Error('Missing fictional golfer');
    render(<OwnerScoresView client={store.client} eventId={round.eventId} roundId={round.roundId} onSessionExpired={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Round scorecard' });
    await user.click(screen.getByRole('button', { name: 'Enter scores' }));
    await user.selectOptions(screen.getByLabelText('Closest approach'), closest);
    await user.click(screen.getByRole('button', { name: 'Reset unsaved order' }));
    expect(store.client.save).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Discard unsaved scores' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Fictional golfer 1 score' }), { target: { value: '5' } });
    await user.selectOptions(screen.getByLabelText('Closest approach'), closest);
    await user.click(screen.getByRole('button', { name: 'Reset unsaved order' }));
    expect(screen.getByRole('textbox', { name: 'Fictional golfer 1 score' })).toHaveValue('5');
    expect(screen.getByRole('button', { name: 'Discard unsaved scores' })).toBeEnabled();
    expect(store.client.save).not.toHaveBeenCalled();
  });

  it('retains the chosen approach order and specials through a failed save, then acknowledges one canonical order and partner sharing', async () => {
    const { f, round } = initial(), store = churcieStore(f, round), user = userEvent.setup();
    const [anchor, closest, remaining, nextFarthest] = f.ids;
    if (!anchor || !closest || !remaining || !nextFarthest) throw new Error('Missing fictional foursome');
    const firstSave = store.client.save;
    vi.mocked(firstSave).mockRejectedValueOnce(new Error('Fictional interrupted Churcie save'));
    render(<OwnerScoresView client={store.client} eventId={round.eventId} roundId={round.roundId} onSessionExpired={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Round scorecard' });
    await user.click(screen.getByRole('button', { name: 'Enter scores' }));
    await user.selectOptions(screen.getByLabelText('Closest approach'), closest);
    await user.selectOptions(screen.getByLabelText('Farthest approach'), anchor);
    await user.selectOptions(screen.getByLabelText('Next farthest approach'), nextFarthest);
    await user.click(screen.getByRole('button', { name: 'Par for blanks' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Fictional golfer 2 score' }), { target: { value: '3' } });
    await user.click(screen.getByRole('button', { name: 'Dots for Fictional golfer 2 · Churcie' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Sticky for Fictional golfer 2')).toBeVisible();
    expect(within(dialog).queryByLabelText('Dime for Fictional golfer 2')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Increase Sandy for Fictional golfer 2' }));
    await user.click(within(dialog).getByRole('button', { name: 'Increase Sandy for Fictional golfer 2' }));
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByText(/Fictional interrupted Churcie save/);
    expect(screen.getByRole('form', { name: 'Group 1 hole 10 entry' })).toBeVisible();
    expect(screen.getByLabelText('Closest approach')).toHaveValue(closest);
    const requestId = vi.mocked(firstSave).mock.calls[0]?.[6];
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByRole('form', { name: 'Group 1 hole 11 entry' });
    expect(vi.mocked(firstSave).mock.calls[1]?.[6]).toBe(requestId);
    expect(vi.mocked(firstSave).mock.calls[1]?.[4].churchy).toMatchObject({
      version: 3, number: 10, rotation: { playerIds: [closest, remaining, nextFarthest, anchor] },
      players: [{ playerId: closest, counts: { sandy: 2 } }],
    });
    expect(vi.mocked(firstSave).mock.calls.slice(2).every((call) => call[4].churchy === undefined)).toBe(true);
    expect(screen.queryByLabelText('Closest approach')).not.toBeInTheDocument();
    const saved = store.read().cards.find((card) => card.playerId === anchor)?.holes.find((hole) => hole.number === 10)?.score.churchy;
    expect(saved).toMatchObject({ version: 3, rotation: { playerIds: [closest, remaining, nextFarthest, anchor] } });
    const result = store.read().games?.results.find((result) => result.gameId === f.game.id);
    expect(result?.churchy?.holes.find((hole) => hole.number === 10)?.pairs).toEqual([[closest, anchor], [remaining, nextFarthest]]);
    expect(result?.players.find((player) => player.playerId === closest)?.totalPoints).toBe(5);
    expect(result?.players.find((player) => player.playerId === anchor)?.totalPoints).toBe(5);
    await user.selectOptions(screen.getByLabelText('Jump to hole'), '10');
    await user.click(screen.getByRole('button', { name: 'Clear Churcie hole specials' }));
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByRole('form', { name: 'Group 1 hole 11 entry' });
    const cleared = store.read().cards.find((card) => card.playerId === anchor)?.holes.find((hole) => hole.number === 10)?.score.churchy;
    expect(cleared).toMatchObject({ version: 3, rotation: { playerIds: [closest, remaining, nextFarthest, anchor] }, players: [], contests: [] });
  });

  it('saves raw scores without inventing approach partners, and still allows order entry after setup has locked', async () => {
    const { f, round } = initial(), store = churcieStore(f, round), user = userEvent.setup();
    render(<OwnerScoresView client={store.client} eventId={round.eventId} roundId={round.roundId} onSessionExpired={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Round scorecard' });
    await user.click(screen.getByRole('button', { name: 'Enter scores' }));
    await user.click(screen.getByRole('button', { name: 'Par for blanks' }));
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByRole('form', { name: 'Group 1 hole 11 entry' });
    expect(store.read().setupLocked).toBe(true);
    expect(store.read().games?.results[0]?.churchy?.order).toBeUndefined();
    expect(store.read().cards.every((card) => card.holes.find((hole) => hole.number === 10)?.score.kind === 'strokes')).toBe(true);
    await user.selectOptions(screen.getByLabelText('Jump to hole'), '10');
    expect(screen.getByLabelText('Closest approach')).toBeEnabled();
    for (const [label, id] of [['Closest approach', f.ids[0]], ['Farthest approach', f.ids[3]], ['Next farthest approach', f.ids[2]]] as const) {
      if (!id) throw new Error('Missing fictional golfer');
      await user.selectOptions(screen.getByLabelText(label), id);
    }
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByRole('form', { name: 'Group 1 hole 11 entry' });
    expect(store.read().games?.results[0]?.churchy?.order?.playerIds).toEqual(f.ids);
  });

  it('uses the saved tee order without asking for an approach receipt or adding a fake order to raw score writes', async () => {
    const { f, round } = initial('tee'), store = churcieStore(f, round), user = userEvent.setup();
    render(<OwnerScoresView client={store.client} eventId={round.eventId} roundId={round.roundId} onSessionExpired={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Round scorecard' });
    await user.click(screen.getByRole('button', { name: 'Enter scores' }));
    expect(screen.queryByLabelText('Closest approach')).not.toBeInTheDocument();
    await user.click(screen.getByText('Churcie partners', { exact: true }));
    expect(screen.getByRole('list', { name: 'Churcie partner rotation' })).toHaveTextContent('Holes 10, 11, 12');
    await user.click(screen.getByRole('button', { name: 'Par for blanks' }));
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    await screen.findByRole('form', { name: 'Group 1 hole 11 entry' });
    expect(vi.mocked(store.client.save).mock.calls.every((call) => call[4].churchy === undefined)).toBe(true);
  });
});
