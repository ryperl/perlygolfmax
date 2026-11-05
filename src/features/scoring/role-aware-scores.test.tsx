import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fictionalId } from '../../client/catalog.test-support';
import { fictionalChange, fictionalRoundScores, scoreResult } from '../../client/scoring.test-support';
import { PrivateRequestError } from '../../client/private-request';
import type { RoundScores, ScoreWriteResult } from '../../domain/scoring';
import { OwnerScoresView } from './OwnerScoresView';
import { deferred, memoryScores } from './scoring.test-support';
import { mixedTeeRound } from './tees.test-support';
import { scoreAccessKey, writablePlayerIds } from './score-access';

function playerRound(): RoundScores {
  const original = mixedTeeRound();
  const own = original.cards.map((card) => card.playerId);
  const others = original.cards.map((card, index) => ({
    ...card, playerId: fictionalId(20 + index), displayName: `Fictional visitor ${String(index + 1)}`,
  }));
  return {
    ...original, cards: [...others, ...original.cards.map((card) => ({
      ...card, holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'unplayed' as const } })),
    }))],
    groups: [{ number: 1, playerIds: others.map((card) => card.playerId) }, { number: 2, playerIds: own }],
    permissions: { role: 'player', viewerPlayerId: fictionalId(1), writePlayerIds: own, canManageGames: false },
  };
}
function mount(round = playerRound()) {
  const store = memoryScores(round);
  render(<OwnerScoresView client={store.client} eventId={round.eventId} roundId={round.roundId} onSessionExpired={vi.fn()} />);
  return store;
}
const viewer = { role: 'viewer', writePlayerIds: [], canManageGames: false } as const;
afterEach(() => { vi.useRealTimers(); });

describe('role-aware round score access', () => {
  it('defaults to the actual assigned playing group, reads other groups, and saves all four own golfers with personal par nudges', async () => {
    const store = mount();
    await screen.findByRole('heading', { name: 'Round scorecard' });
    expect(screen.getByText(/Your assigned playing group: Group 2/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Group'), { target: { value: '1' } });
    expect(screen.getByRole('button', { name: 'Open scorecard for Fictional visitor 1' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Enter scores · Group 1' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enter scores' }));
    expect(screen.getByLabelText('View group')).toHaveValue('2');
    fireEvent.change(screen.getByLabelText('View group'), { target: { value: '1' } });
    for (const input of screen.getAllByRole('textbox')) expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form'));
    expect(store.client.save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('View group'), { target: { value: '2' } });
    for (const input of screen.getAllByRole('textbox')) fireEvent.change(input, { target: { value: '' } });
    for (let index = 1; index <= 4; index++) {
      fireEvent.click(screen.getByRole('button', { name: `Increase score for Fictional Player ${String(index)}` }));
    }
    expect(screen.getByRole('textbox', { name: 'Fictional Player 1 score' })).toHaveValue('5');
    expect(screen.getByRole('textbox', { name: 'Fictional Player 2 score' })).toHaveValue('4');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/4 player changes acknowledged/);
    expect(vi.mocked(store.client.save).mock.calls.map((call) => call[2])).toEqual([1, 2, 3, 4].map(fictionalId));
    expect(store.client.history).not.toHaveBeenCalled();
  });

  it.each([viewer, undefined])('fails closed for readonly or missing permissions, including direct Games and Leaderboard tabs (%j)', async (permissions) => {
    const { permissions: _ignored, ...round } = fictionalRoundScores;
    expect(_ignored?.role).toBe('owner');
    const store = mount({ ...round, ...(permissions ? { permissions } : {}) });
    await screen.findByRole('heading', { name: 'Round scorecard' });
    expect(screen.getByRole('button', { name: 'Enter scores' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Games' }));
    expect(screen.getByText(/Settings are read-only/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add game' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Leaderboard' }));
    expect(screen.getByRole('heading', { name: /Leaderboard ·/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Configure a game' })).not.toBeInTheDocument();
    expect(store.client.save).not.toHaveBeenCalled();
    expect(store.client.saveGames).not.toHaveBeenCalled();
  });

  it('keeps changed-group drafts for review but blocks both ordinary save and form submission after refresh', async () => {
    const store = mount();
    await screen.findByRole('heading', { name: 'Round scorecard' });
    fireEvent.click(screen.getByRole('button', { name: 'Enter scores' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Fictional Player 1 score' }), { target: { value: '6' } });
    store.replace({ ...store.read(), groups: [...store.read().groups].reverse().map((group) => ({ ...group, number: 3 - group.number })) });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved round' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form'));
    expect(store.client.save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('View group'), { target: { value: '1' } });
    expect(screen.getByRole('textbox', { name: 'Fictional Player 1 score' })).toHaveValue('6');
    fireEvent.click(screen.getByRole('button', { name: 'Scorecards' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review unsaved scores' }));
    expect(screen.getByRole('textbox', { name: 'Fictional Player 1 score' })).toHaveValue('6');
    expect(screen.getByRole('textbox', { name: 'Fictional Player 1 score' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard unsaved scores' }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('adopts revoked permissions from an inflight poll despite typing, and does not send a waiting save', async () => {
    vi.useFakeTimers();
    const store = mount();
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: 'Enter scores' }));
    const pending = deferred<RoundScores>();
    vi.mocked(store.client.load).mockReturnValueOnce(pending.promise);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    fireEvent.change(screen.getByRole('textbox', { name: 'Fictional Player 1 score' }), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await act(async () => { pending.resolve({ ...store.read(), permissions: viewer }); await pending.promise; });
    expect(store.client.save).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Fictional Player 1 score' })).toHaveValue('6');
    expect(screen.getByRole('textbox', { name: 'Fictional Player 1 score' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('stops remaining writes when the first acknowledgement changes permissions', async () => {
    const store = mount();
    await screen.findByRole('heading', { name: 'Round scorecard' });
    fireEvent.click(screen.getByRole('button', { name: 'Enter scores' }));
    for (const input of screen.getAllByRole('textbox')) fireEvent.change(input, { target: { value: '6' } });
    const pending = deferred<ScoreWriteResult>();
    vi.mocked(store.client.save).mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const call = vi.mocked(store.client.save).mock.calls[0];
    if (!call) throw new Error('Missing fictional save.');
    const saved = scoreResult({ ...fictionalChange, playerId: call[2], id: call[6], after: call[4] }, store.read());
    await act(async () => { pending.resolve({ ...saved, round: { ...saved.round, permissions: viewer } }); await pending.promise; });
    expect(store.client.save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(within(screen.getByRole('form')).getAllByRole('textbox')).toHaveLength(4);
  });

  it('does not authorize competition teammates or stale foreign write IDs', () => {
    const round = playerRound();
    expect(writablePlayerIds({ ...round, permissions: { role: 'player', viewerPlayerId: fictionalId(1),
      canManageGames: false, writePlayerIds: [fictionalId(20)] } })).toEqual([]);
    expect(writablePlayerIds({ ...round, permissions: { role: 'player', canManageGames: false,
      writePlayerIds: round.cards.map((card) => card.playerId) } })).toEqual([]);
    expect(scoreAccessKey(round)).not.toBe(scoreAccessKey({ ...round, permissions: viewer }));
  });

  it('clears private drafts after denial and recovers read-only without reviving prior entries', async () => {
    const store = mount();
    await screen.findByRole('heading', { name: 'Round scorecard' });
    fireEvent.click(screen.getByRole('button', { name: 'Enter scores' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Fictional Player 1 score' }), { target: { value: '6' } });
    vi.mocked(store.client.load).mockRejectedValueOnce(new PrivateRequestError(403, 'Fictional access revoked.'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved round' }));
    await screen.findByRole('alert');
    await waitFor(() => { expect(screen.queryByRole('button', { name: 'Discard unsaved scores' })).not.toBeInTheDocument(); });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    store.replace({ ...store.read(), permissions: viewer });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved round' }));
    await screen.findByRole('textbox', { name: 'Fictional Player 1 score' });
    expect(screen.getByRole('textbox', { name: 'Fictional Player 1 score' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Fictional Player 1 score' })).toBeDisabled();
    expect(store.client.save).not.toHaveBeenCalled();
  });

  it('isolates private entry state when the injected client changes', async () => {
    const round = playerRound();
    const first = memoryScores(round);
    const second = memoryScores({ ...round, permissions: viewer });
    const props = { eventId: round.eventId, roundId: round.roundId, onSessionExpired: vi.fn() };
    const view = render(<OwnerScoresView {...props} client={first.client} />);
    await screen.findByRole('heading', { name: 'Round scorecard' });
    fireEvent.click(screen.getByRole('button', { name: 'Enter scores' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Fictional Player 1 score' }), { target: { value: '6' } });
    view.rerender(<OwnerScoresView {...props} client={second.client} />);
    await screen.findByRole('heading', { name: 'Round scorecard' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard unsaved scores' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enter scores' })).toBeDisabled();
  });

  it('does not show archived round contents to a nonowner', async () => {
    mount({ ...playerRound(), eventStatus: 'archived' });
    expect(await screen.findByRole('alert')).toHaveTextContent('event owner only');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
