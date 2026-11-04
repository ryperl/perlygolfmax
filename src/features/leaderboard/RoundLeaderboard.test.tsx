import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RoundLeaderboard } from './RoundLeaderboard';
import { fictionalStanding, leaderboardGames, leaderboardRound } from '../../client/leaderboard.test-support';
import { fictionalRoundScores } from '../../client/scoring.test-support';

describe('round leaderboard', () => {
  it('shows tied live positions, signed saved points, holes played and explicit unranked reasons', () => {
    const { container } = render(<RoundLeaderboard round={leaderboardRound} busy={false} onManageGames={vi.fn()} />);
    const rows = within(screen.getByRole('list', { name: 'Standings' })).getAllByRole('listitem');
    expect(rows.map((row) => within(row).getByRole('heading').textContent)).toEqual([
      'Fictional golfer 2', 'Fictional golfer 3', 'Fictional golfer 1', 'Fictional golfer 4',
    ]);
    expect(screen.getAllByLabelText('Tied position 1')).toHaveLength(2);
    expect(screen.getByLabelText('Position 3')).toBeVisible();
    expect(screen.getByLabelText('0 points')).toBeVisible();
    expect(screen.getByLabelText('-2 points')).toBeVisible();
    expect(rows[0]).toHaveTextContent('2/9 holes · In progress');
    expect(rows[1]).toHaveTextContent('9/9 holes · Complete');
    expect(screen.getByText(/Provisional standings/)).toBeVisible();
    expect(screen.getByRole('region', { name: 'Awaiting scores' })).toHaveTextContent('Fictional golfer 5');
    const unavailable = screen.getByRole('region', { name: 'Unavailable results' });
    expect(unavailable).toHaveTextContent('No captured Handicap Index is available.');
    expect(unavailable).not.toHaveTextContent('0/9');
    expect(screen.getByText(leaderboardRound.eventName)).toBeVisible();
    expect(screen.getByRole('heading', { name: `Leaderboard · ${leaderboardRound.roundName}` })).toBeVisible();
    expect(container.textContent).not.toContain(leaderboardRound.eventId);
  });
  it('switches games with native controls, retains selection after refresh and exposes the configured basis', async () => {
    const view = render(<RoundLeaderboard round={leaderboardRound} busy={false} onManageGames={vi.fn()} />);
    const user = userEvent.setup();
    const select = screen.getByRole('combobox', { name: 'Leaderboard game' });
    await user.selectOptions(select, leaderboardGames[1]?.id ?? '');
    expect(screen.getByText('Modified Stableford · Gross')).toBeVisible();
    const rows = within(screen.getByRole('list', { name: 'Standings' })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Fictional golfer 6');
    expect(screen.getAllByLabelText('Tied position 2')).toHaveLength(2);
    view.rerender(<RoundLeaderboard round={{ ...leaderboardRound, lastUpdatedAt: '2026-01-03T00:00:00Z' }} busy={false} onManageGames={vi.fn()} />);
    expect(select).toHaveValue(leaderboardGames[1]?.id);
    select.focus();
    expect(select).toHaveFocus();
    expect(window.location.hash).not.toContain('leaderboard');
  });
  it('shows completed game cards without calling them final or applying a tie-break', () => {
    const first = leaderboardGames[0];
    if (!first || !leaderboardRound.games) throw new Error('Missing fictional games.');
    render(<RoundLeaderboard round={{ ...leaderboardRound, games: {
      ...leaderboardRound.games, results: [{ gameId: first.id, players: [fictionalStanding(1, 0, 9)] }],
    } }} busy={false} onManageGames={vi.fn()} />);
    expect(screen.getByText('Saved points · All game cards complete. This is not round finalization.')).toBeVisible();
    expect(screen.getByText(/no tie-break is applied/)).toBeVisible();
    expect(screen.queryByText(/Provisional standings/)).not.toBeInTheDocument();
  });
  it.each(['active', 'archived'] as const)('handles no configured games for %s rounds without inventing a gross leaderboard', async (eventStatus) => {
    const manage = vi.fn();
    render(<RoundLeaderboard round={{ ...fictionalRoundScores, eventStatus }} busy={false} onManageGames={manage} />);
    expect(screen.getByText(/No games configured/)).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Standings' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: eventStatus === 'active' ? 'Configure a game' : 'View games' }));
    expect(manage).toHaveBeenCalledOnce();
  });
  it('does not turn missing results or entirely unplayed cards into a zero-point winner', () => {
    const games = leaderboardRound.games;
    if (!games) throw new Error('Missing fictional games.');
    const view = render(<RoundLeaderboard round={{ ...leaderboardRound, games: { ...games, results: [] } }} busy={false} onManageGames={vi.fn()} />);
    expect(screen.getByText(/Leaderboard results are unavailable/)).toBeVisible();
    view.rerender(<RoundLeaderboard round={{ ...leaderboardRound, games: {
      ...games, results: [{ gameId: leaderboardGames[0]?.id ?? '', players: [fictionalStanding(1, null)] }],
    } }} busy={false} onManageGames={vi.fn()} />);
    expect(screen.getByText('No ranked scores yet.')).toBeVisible();
    expect(screen.queryByLabelText('0 points')).not.toBeInTheDocument();
  });
});
