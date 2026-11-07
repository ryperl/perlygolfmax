import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fictionalRoundScores, gameResult, scoreResult } from '../../client/scoring.test-support';
import type { GameWriteResult } from '../../domain/scoring';
import { SessionExpiredError } from '../../client/events';
import { OwnerScoresView } from './OwnerScoresView';
import { deferred, memoryScores } from './scoring.test-support';

function mount(store = memoryScores(scoreResult().round)) {
  const onSessionExpired = vi.fn();
  return { ...store, onSessionExpired, ...render(<OwnerScoresView client={store.client}
    eventId={fictionalRoundScores.eventId} roundId={fictionalRoundScores.roundId} onSessionExpired={onSessionExpired} />) };
}
async function openGames(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: 'Round scorecard' });
  await user.click(screen.getByRole('button', { name: 'Games' }));
}

describe('games integrated with owner stroke entry', () => {
  it('saves customized gross and net games on existing strokes without writing or changing the raw card', async () => {
    const view = mount();
    const originalCards = view.read().cards;
    const user = userEvent.setup();
    await openGames(user);
    await user.click(screen.getByRole('button', { name: 'Add game' }));
    await user.clear(screen.getByLabelText('Game name'));
    await user.type(screen.getByLabelText('Game name'), 'Fictional custom gross');
    await user.selectOptions(screen.getByLabelText('Points preset'), 'modified');
    await user.clear(screen.getByLabelText('Better than listed points'));
    await user.type(screen.getByLabelText('Better than listed points'), '14');
    await user.click(screen.getByRole('button', { name: 'Add better band' }));
    expect(screen.getByLabelText('Points at -4 relative to par')).toHaveValue('14');
    await user.click(screen.getByRole('button', { name: 'Save game' }));
    await screen.findByText('Game settings saved.');
    expect(view.client.saveGames).toHaveBeenCalledOnce();
    expect(vi.mocked(view.client.saveGames).mock.calls[0]?.[3]).toBeNull();
    expect(view.read().games?.configuration.games[0]?.points?.betterScorePoints).toBe(14);
    expect(screen.getByRole('region', { name: 'Fictional custom gross results' })).toHaveTextContent('Custom points');
    await user.click(screen.getByRole('button', { name: 'Add game' }));
    await user.clear(screen.getByLabelText('Game name'));
    await user.type(screen.getByLabelText('Game name'), 'Fictional net game');
    await user.selectOptions(screen.getByLabelText('Score basis'), 'net');
    expect(screen.getByLabelText('Handicap allowance (%)')).toHaveValue('95');
    await user.clear(screen.getByLabelText('Handicap allowance (%)'));
    await user.type(screen.getByLabelText('Handicap allowance (%)'), '100');
    await user.click(screen.getByRole('button', { name: 'Save game' }));
    await screen.findByText('Game settings saved.');
    expect(view.read().games?.configuration.games).toHaveLength(2);
    expect(view.read().games?.configuration.games[1]?.handicapAllowancePercent).toBe(100);
    expect(screen.getByRole('region', { name: 'Fictional net game results' })).toHaveTextContent('No captured Handicap Index');
    expect(view.client.save).not.toHaveBeenCalled();
    expect(view.read().cards).toEqual(originalCards);
    await user.click(screen.getByRole('button', { name: 'Scorecards' }));
    expect(screen.getByLabelText('Game')).toHaveValue(view.read().games?.configuration.games[0]?.id);
    const points = screen.getByRole('row', { name: 'Fictional Player 1 · Fictional custom gross points' });
    expect(within(points).getAllByRole('cell').at(-1)).toHaveTextContent('0*');
    expect(view.client.saveGames).toHaveBeenCalledTimes(2);
    const netId = view.read().games?.configuration.games[1]?.id;
    if (!netId) throw new Error('Missing fictional net game.');
    await user.selectOptions(screen.getByLabelText('Game'), netId);
    await user.click(screen.getByRole('button', { name: 'Enter scores' }));
    await user.click(screen.getByRole('button', { name: 'Scorecards' }));
    expect(screen.getByLabelText('Game')).toHaveValue(netId);
  });

  it('retains both rule and stroke drafts across tabs and explicitly warns about unsaved settings', async () => {
    const view = mount();
    const user = userEvent.setup();
    await openGames(user);
    await user.click(screen.getByRole('button', { name: 'Add game' }));
    await user.clear(screen.getByLabelText('Game name'));
    await user.type(screen.getByLabelText('Game name'), 'Fictional pending rules');
    await user.click(screen.getByRole('button', { name: 'Enter scores' }));
    expect(screen.getByText('Unsaved game settings. Open Games to save or cancel them.')).toBeVisible();
    const player = within(screen.getByRole('article', { name: 'Fictional Player 1 scorecard' }));
    await user.clear(player.getByRole('textbox'));
    await user.type(player.getByRole('textbox'), '5');
    await user.click(screen.getByRole('button', { name: 'Games' }));
    expect(screen.getByLabelText('Game name')).toHaveValue('Fictional pending rules');
    await user.click(screen.getByRole('button', { name: 'Enter scores' }));
    expect(screen.getByRole('textbox', { name: 'Fictional Player 1 score' })).toHaveValue('5');
    expect(view.client.save).not.toHaveBeenCalled();
    expect(view.client.saveGames).not.toHaveBeenCalled();
  });

  it('aborts a pending game save on route exit and never accepts a late private round', async () => {
    const store = memoryScores();
    const pending = deferred<GameWriteResult>();
    vi.mocked(store.client.saveGames).mockReturnValueOnce(pending.promise);
    const view = mount(store);
    const user = userEvent.setup();
    await openGames(user);
    await user.click(screen.getByRole('button', { name: 'Add game' }));
    await user.click(screen.getByRole('button', { name: 'Save game' }));
    const request = vi.mocked(store.client.saveGames).mock.calls[0];
    if (!request) throw new Error('Missing fictional game request.');
    view.unmount();
    expect(request[5].aborted).toBe(true);
    await act(async () => { pending.resolve(gameResult(request[2], request[3], request[4])); await pending.promise; });
    expect(screen.queryByRole('heading', { name: 'Games' })).not.toBeInTheDocument();
  });

  it('clears private game controls and signals session expiry on a rejected save', async () => {
    const store = memoryScores();
    vi.mocked(store.client.saveGames).mockRejectedValueOnce(new SessionExpiredError('Sign in again.'));
    const view = mount(store);
    const user = userEvent.setup();
    await openGames(user);
    await user.click(screen.getByRole('button', { name: 'Add game' }));
    await user.click(screen.getByRole('button', { name: 'Save game' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again');
    expect(view.onSessionExpired).toHaveBeenCalledWith('Sign in again.');
    expect(screen.queryByRole('button', { name: 'Add game' })).not.toBeInTheDocument();
  });
  it('does not imply cancelling an uncertain game save rolled back a committed configuration', async () => {
    const store = memoryScores();
    const save = vi.mocked(store.client.saveGames).getMockImplementation();
    if (!save) throw new Error('Missing fictional game writer.');
    vi.mocked(store.client.saveGames).mockImplementationOnce(async (...args) => {
      await save(...args);
      throw new Error('Fictional response timed out.');
    });
    mount(store);
    const user = userEvent.setup();
    await openGames(user);
    await user.click(screen.getByRole('button', { name: 'Add game' }));
    await user.click(screen.getByRole('button', { name: 'Save game' }));
    const panel = within(screen.getByRole('region', { name: 'Round games' }));
    expect(await panel.findByText('Fictional response timed out.')).toBeVisible();
    await user.click(panel.getByRole('button', { name: 'Cancel editing' }));
    expect(panel.getByText('Closing editing does not undo an earlier save. Refresh to see the saved settings.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Refresh saved round' }));
    expect(await panel.findByRole('heading', { name: 'Standard Stableford' })).toBeVisible();
    expect(store.client.saveGames).toHaveBeenCalledOnce();
    expect(store.read().games?.configuration.games).toHaveLength(1);
  });
});
