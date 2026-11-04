import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SessionExpiredError } from '../../client/events';
import { PrivateRequestError } from '../../client/private-request';
import { fictionalChange, fictionalRoundScores, scoreResult } from '../../client/scoring.test-support';
import { leaderboardGames, leaderboardRound } from '../../client/leaderboard.test-support';
import { OwnerScoresView } from './OwnerScoresView';
import { memoryScores } from './scoring.test-support';

function mount(round = leaderboardRound) {
  const store = memoryScores(round);
  const onSessionExpired = vi.fn();
  render(<OwnerScoresView client={store.client} eventId={round.eventId} roundId={round.roundId} onSessionExpired={onSessionExpired} />);
  return { ...store, onSessionExpired };
}
async function openLeaderboard(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: 'Round scorecard' });
  await user.click(screen.getByRole('button', { name: 'Leaderboard' }));
  return screen.getByRole('region', { name: 'Round leaderboard' });
}

describe('leaderboard in the owner round workflow', () => {
  it('links back to the event overview and retains the selected game without ranking unsaved stroke edits', async () => {
    const store = mount();
    const user = userEvent.setup();
    const board = await openLeaderboard(user);
    expect(screen.getByRole('link', { name: 'Back to event overview' })).toHaveAttribute('href', `#overview?event=${leaderboardRound.eventId}`);
    const gross = leaderboardGames[1];
    if (!gross) throw new Error('Missing fictional gross game.');
    await user.selectOptions(within(board).getByRole('combobox'), gross.id);
    await user.click(screen.getByRole('button', { name: 'Enter scores' }));
    const input = screen.getByRole('textbox', { name: 'Fictional golfer 1 score' });
    await user.clear(input);
    await user.type(input, '7');
    await user.click(screen.getByRole('button', { name: 'Leaderboard' }));
    expect(within(board).getByRole('combobox')).toHaveValue(gross.id);
    expect(screen.getByText('Unsaved score entries are not included in this leaderboard. Return to Enter scores to save or review them.')).toBeVisible();
    const row = within(board).getByRole('heading', { name: 'Fictional golfer 1' }).closest('li');
    if (!row) throw new Error('Missing fictional leaderboard row.');
    expect(within(row).getByLabelText('0 points')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Scorecards' }));
    await user.click(screen.getByRole('button', { name: 'Leaderboard' }));
    expect(within(board).getByRole('combobox')).toHaveValue(gross.id);
    expect(store.client.load).toHaveBeenCalledOnce();
    expect(store.client.save).not.toHaveBeenCalled();
    expect(store.client.saveGames).not.toHaveBeenCalled();
  });

  it('reorders only after refreshed server results arrive, retaining the selected game', async () => {
    const store = mount();
    const user = userEvent.setup();
    const board = await openLeaderboard(user);
    const gross = leaderboardGames[1];
    if (!gross) throw new Error('Missing fictional gross game.');
    await user.selectOptions(within(board).getByRole('combobox'), gross.id);
    store.replace(scoreResult({ ...fictionalChange, after: { kind: 'strokes', strokes: 1 } }, leaderboardRound).round);
    await user.click(screen.getByRole('button', { name: 'Refresh saved round' }));
    await waitFor(() => {
      const rows = within(within(board).getByRole('list', { name: 'Standings' })).getAllByRole('listitem');
      expect(rows[1]).toHaveTextContent('Fictional golfer 1');
      expect(rows[1]).toHaveTextContent('8');
    });
    expect(within(board).getByRole('combobox')).toHaveValue(gross.id);
    expect(store.client.save).not.toHaveBeenCalled();
  });

  it.each(['expired', 'denied'] as const)('removes private standings when refreshed access is %s', async (failure) => {
    const store = mount();
    const user = userEvent.setup();
    await openLeaderboard(user);
    vi.mocked(store.client.load).mockRejectedValueOnce(failure === 'expired'
      ? new SessionExpiredError('Sign in again.') : new PrivateRequestError(403, 'Round access denied.'));
    await user.click(screen.getByRole('button', { name: 'Refresh saved round' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('region', { name: 'Round leaderboard' })).not.toBeInTheDocument();
    expect(screen.queryByText('Fictional golfer 2')).not.toBeInTheDocument();
    expect(store.onSessionExpired).toHaveBeenCalledTimes(failure === 'expired' ? 1 : 0);
  });

  it('opens game configuration from an empty leaderboard without writing scores or games', async () => {
    const store = mount(fictionalRoundScores);
    const user = userEvent.setup();
    await openLeaderboard(user);
    await user.click(screen.getByRole('button', { name: 'Configure a game' }));
    expect(screen.getByRole('heading', { name: `Games · ${fictionalRoundScores.roundName}` })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add game' })).toBeVisible();
    expect(store.client.save).not.toHaveBeenCalled();
    expect(store.client.saveGames).not.toHaveBeenCalled();
  });
});
