import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fictionalChange, fictionalRoundScores, scoreResult } from '../../client/scoring.test-support';
import { SavedScorecards } from './SavedScorecards';
import { scorecardGamesFixture } from './scorecard-games.test-support';
import { withGameResults } from '../../client/scoring.test-support';
import { teamLeaderboardRound } from '../../client/leaderboard.test-support';
import { gameScoringLabel } from '../games';

function props() {
  return { round: fictionalRoundScores, groupNumber: 1, busy: false, onGroupChange: vi.fn(), onEnterScores: vi.fn() };
}
describe('golfer-facing round scorecards', () => {
  it('automatically adds the first saved game, switches games for both group and individual cards, and supports strokes-only viewing', async () => {
    const { round, games } = scorecardGamesFixture(9);
    const { rerender } = render(<SavedScorecards {...props()} />);
    expect(screen.queryByLabelText('Game')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Round games' })).not.toBeInTheDocument();
    rerender(<SavedScorecards {...props()} round={round} />);
    const roundGames = screen.getByRole('region', { name: 'Round games' });
    expect(within(roundGames).getAllByRole('listitem')).toHaveLength(games.length);
    for (const game of games) expect(roundGames).toHaveTextContent(`${game.name} · ${gameScoringLabel(game)}`);
    expect(screen.getByLabelText('Game')).toHaveValue(games[0]?.id);
    expect(screen.getByRole('row', { name: 'Fictional Player 1 · Fictional standard points' })).toBeVisible();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Game'), games[1]?.id ?? '');
    expect(screen.getByRole('row', { name: 'Fictional Player 1 · Fictional modified points' })).toHaveTextContent('0');
    await user.click(screen.getByRole('button', { name: 'Open scorecard for Fictional Player 1' }));
    expect(screen.getByLabelText('Game')).toHaveValue(games[1]?.id);
    expect(screen.getByRole('row', { name: 'Fictional Player 1 · Fictional modified points' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Back to group scorecard' }));
    await user.selectOptions(screen.getByLabelText('Game'), '');
    expect(screen.queryByRole('row', { name: /points$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open scorecard for Fictional Player 1' })).toBeVisible();
  });

  it('labels team-game golfer points as individual components in group and expanded scorecards', async () => {
    render(<SavedScorecards {...props()} round={teamLeaderboardRound} />);
    expect(screen.getByText(/individual component points, not full team credits/)).toBeVisible();
    expect(screen.getByText(/See Games or Leaderboard for team totals/)).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open scorecard for Fictional golfer 1' }));
    expect(screen.getByRole('region', { name: 'Fictional golfer 1 full scorecard' })).toBeVisible();
    expect(screen.getByText(/individual component points, not full team credits/)).toBeVisible();
    await userEvent.setup().selectOptions(screen.getByLabelText('Game'), '');
    expect(screen.queryByText(/individual component points/)).not.toBeInTheDocument();
  });

  it('updates game points from new server projections and shows missing net inputs only once for both nines', async () => {
    const { round, games } = scorecardGamesFixture();
    const { rerender } = render(<SavedScorecards {...props()} round={round} />);
    const standard = games[0];
    if (!standard) throw new Error('Missing fictional standard game.');
    const edited = { ...standard, points: { ...standard.points, rows: standard.points.rows.map((row) => row.scoreToPar === 0 ? { ...row, points: 3 } : row) } };
    rerender(<SavedScorecards {...props()} round={withGameResults(round, [edited], 'games-v2')} />);
    const back = screen.getByRole('region', { name: 'Back nine scorecard' });
    expect(within(back).getByRole('row', { name: 'Fictional Player 1 · Fictional standard points' })).toHaveTextContent('54');
    rerender(<SavedScorecards {...props()} round={round} />);
    await userEvent.setup().selectOptions(screen.getByLabelText('Game'), games[2]?.id ?? '');
    expect(screen.getAllByText(/Fictional Player 3: No captured Handicap Index/)).toHaveLength(1);
    expect(screen.getAllByRole('row', { name: 'Fictional Player 3 · Fictional net points' })).toHaveLength(2);
  });
  it('immediately shows a paper-style group grid in hole and group order, not an audit list', () => {
    const round = scoreResult().round;
    const { container } = render(<SavedScorecards {...props()} round={{
      ...round, layout: [...round.layout].reverse(), cards: [...round.cards].reverse(),
    }} />);
    const table = screen.getByRole('table', { name: 'Front nine scorecard' });
    expect(table).toBeVisible();
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Hole', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Out', 'Total',
    ]);
    expect(within(table).getAllByRole('button').map((button) => button.textContent)).toEqual(round.cards.map((card) => card.displayName));
    const playerRow = within(table).getByRole('button', { name: 'Open scorecard for Fictional Player 1' }).closest('tr');
    if (!playerRow) throw new Error('Missing fictional player row.');
    expect(within(playerRow).getAllByRole('cell').at(-1)).toHaveTextContent('4*');
    expect(screen.queryByText(/history|request|revision|actor/i)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    expect(container.textContent).not.toContain(fictionalChange.recordedAt);
    expect(screen.queryByRole('columnheader', { name: /pickup/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /net|stableford/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Recorded strokes:|Saved card updated|No net or Stableford|unplayed · X/)).not.toBeInTheDocument();
  });
  it('opens an individual card directly from a golfer name and returns to the group', async () => {
    render(<SavedScorecards {...props()} round={scoreResult({ ...fictionalChange, after: { kind: 'picked-up', reportedStrokes: 7 } }).round} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open scorecard for Fictional Player 1' }));
    const card = screen.getByRole('region', { name: 'Fictional Player 1 full scorecard' });
    expect(card).toBeVisible();
    expect(within(card).getByRole('table', { name: 'Front nine scorecard' })).toBeVisible();
    expect(card).toHaveTextContent('X7');
    expect(within(card).getByText('Incomplete')).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to group scorecard' }));
    expect(screen.getByRole('table', { name: 'Front nine scorecard' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Fictional Player 1 full scorecard' })).not.toBeInTheDocument();
  });
  it('provides explicit entry and group navigation and resets a player selection when changing groups', async () => {
    const input = props();
    const extra = fictionalRoundScores.cards.map((card, index) => ({ ...card, playerId: `00000000-0000-4000-8000-00000000010${String(index)}`, displayName: `Fictional Guest ${String(index + 1)}` }));
    const round = { ...input.round, cards: [...input.round.cards, ...extra], groups: [
      ...input.round.groups, { number: 2, playerIds: extra.map((card) => card.playerId) },
    ] };
    const { rerender } = render(<SavedScorecards {...input} round={round} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Scorecard'), fictionalChange.playerId);
    await user.selectOptions(screen.getByLabelText('Group'), '2');
    expect(input.onGroupChange).toHaveBeenCalledWith(2);
    rerender(<SavedScorecards {...input} round={round} groupNumber={2} />);
    expect(screen.getByLabelText('Scorecard')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Open scorecard for Fictional Guest 1' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Open scorecard for Fictional Player 1' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enter scores · Group 2' }));
    expect(input.onEnterScores).toHaveBeenCalledOnce();
  });
  it('switches front/back/full nines without inventing back-nine data on a nine-hole round', async () => {
    const input = props();
    const layout = Array.from({ length: 18 }, (_, index) => ({ number: index + 1, sourceId: 300 + index, length: 100, par: 4, allocation: index + 1 }));
    const round = { ...input.round, layout, cards: input.round.cards.map((card) => ({
      ...card, holes: layout.map((hole) => ({ number: hole.number, score: { kind: 'strokes' as const, strokes: 4 } })),
    })) };
    const { rerender } = render(<SavedScorecards {...input} round={round} />);
    const user = userEvent.setup();
    expect(screen.getAllByRole('table')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Back 9' }));
    expect(screen.queryByRole('table', { name: 'Front nine scorecard' })).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Back nine scorecard' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'In' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Total' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Front 9' }));
    expect(screen.queryByRole('table', { name: 'Back nine scorecard' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Full card' }));
    expect(screen.getAllByRole('table')).toHaveLength(2);
    rerender(<SavedScorecards {...input} />);
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Back 9' })).not.toBeInTheDocument();
  });
});
