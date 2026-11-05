import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fictionalId } from '../../client/catalog.test-support';
import type { GamePlayerResult, RoundGameDefinition } from '../../domain/games';
import { stablefordPoints } from '../../domain/stableford';
import { GameResults } from './GameResults';
import { teamLeaderboardGame, teamLeaderboardRound } from '../../client/leaderboard.test-support';

const game: RoundGameDefinition = {
  id: fictionalId(510), name: 'Fictional modified net', basis: 'net', preset: 'modified',
  handicapAllowancePercent: 95, points: stablefordPoints('modified'),
};
const player: GamePlayerResult = {
  playerId: fictionalId(511), displayName: 'Fictional Golfer A', playingHandicap: -2,
  status: 'in-progress', holesScored: 2, totalHoles: 18, frontPoints: -1, backPoints: null, totalPoints: -1,
  holes: Array.from({ length: 18 }, (_, index) => ({
    number: index + 1, points: index === 0 ? 0 : index === 1 ? -1 : null, strokesReceived: 0,
  })),
};
const holeNumbers = player.holes.map((hole) => hole.number);

describe('GameResults', () => {
  it('pages and searches forty saved results without truncation or altering server points', async () => {
    const players = Array.from({ length: 40 }, (_, index) => ({
      ...player, playerId: fictionalId(index + 1), displayName: `Fictional golfer ${String(index + 1).padStart(2, '0')}`,
      totalPoints: index + 100,
    }));
    const { rerender } = render(<GameResults game={game} holeNumbers={holeNumbers} result={{ gameId: game.id, players }} />);
    const user = userEvent.setup();
    expect(screen.getAllByRole('row')).toHaveLength(13);
    await user.click(screen.getByRole('button', { name: 'Next results' }));
    expect(screen.getByText('Fictional golfer 13')).toBeVisible();
    await user.type(screen.getByRole('searchbox'), '40');
    expect(screen.getByRole('row', { name: /Fictional golfer 40/ })).toHaveTextContent('139 (partial)');
    rerender(<GameResults game={game} holeNumbers={holeNumbers} result={{ gameId: game.id, players: [...players] }} />);
    expect(screen.getByRole('searchbox')).toHaveValue('40');
    await user.clear(screen.getByRole('searchbox'));
    expect(screen.getByText('Fictional golfer 01')).toBeVisible();
    await user.type(screen.getByRole('searchbox'), 'not a golfer');
    expect(screen.getByText('No results match your search.')).toBeVisible();
    expect(screen.getAllByRole('row')).toHaveLength(1);
  });
  it('shows server totals, zero/negative points, plus handicap, partial progress and pending holes in provided order', () => {
    const second = { ...player, playerId: fictionalId(512), displayName: 'Fictional Golfer B', totalPoints: 8 };
    const { container } = render(<GameResults game={game} holeNumbers={holeNumbers} result={{ gameId: game.id, players: [player, second] }} />);
    const scroll = screen.getByRole('region', { name: `${game.name} points scorecard` });
    const table = within(scroll).getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Fictional Golfer A');
    expect(rows[2]).toHaveTextContent('Fictional Golfer B');
    expect(rows[1]).toHaveTextContent('+2');
    expect(rows[1]).toHaveTextContent('-1 (partial)');
    expect(rows[1]).toHaveTextContent('2/18 holes · In progress');
    expect(screen.getByText('Modified Stableford · Net · 95% allowance')).toBeVisible();
    expect(screen.queryByText('GolfLink Modified')).not.toBeInTheDocument();
    if (!rows[1]) throw new Error('Missing fictional player row.');
    expect(within(rows[1]).getAllByRole('cell')[0]).toHaveTextContent('0');
    expect(within(rows[1]).getAllByRole('cell')[1]).toHaveTextContent('-1');
    expect(within(rows[1]).getAllByLabelText('Pending')).toHaveLength(7);
    expect(scroll).toHaveAttribute('tabindex', '0');
    expect(container.textContent).not.toContain(game.id);
    expect(container.textContent).not.toContain(player.playerId);
    expect(container.textContent).not.toMatch(/rank|handicap index|recordedAt/i);
    expect(container.querySelector('details')).toBeNull();
    expect(within(table).queryByRole('button')).not.toBeInTheDocument();
    expect(within(table).queryByRole('link')).not.toBeInTheDocument();
  });

  it.each(['click', 'Enter', 'Space'])('switches visible nines on %s without hiding golfers or changing the route hash', async (action) => {
    const user = userEvent.setup();
    const previousUrl = window.location.href;
    const route = `#events?event=${fictionalId(520)}&round=${fictionalId(521)}`;
    window.history.replaceState(null, '', route);
    try {
      const second = {
        ...player, playerId: fictionalId(512), displayName: 'Fictional Golfer B',
        frontPoints: 8, backPoints: 8, totalPoints: 16, holesScored: 3,
        holes: player.holes.map((hole) => ({ ...hole, points: hole.number === 1 || hole.number === 18 ? 8 : hole.number === 2 ? 0 : null })),
      };
      render(<GameResults game={game} holeNumbers={holeNumbers} result={{ gameId: game.id, players: [player, second] }} />);
      const region = screen.getByRole('region', { name: `${game.name} points scorecard` });
      region.scrollLeft = 80;
      const button = screen.getByRole('button', { name: 'Back 9' });
      if (action === 'click') await user.click(button);
      else {
        button.focus();
        await user.keyboard(action === 'Enter' ? '{Enter}' : ' ');
      }
      expect(button).toHaveAttribute('aria-pressed', 'true');
      expect(region.scrollLeft).toBe(0);
      expect(within(region).getByRole('columnheader', { name: '18' })).toBeVisible();
      expect(within(region).queryByRole('columnheader', { name: '1' })).not.toBeInTheDocument();
      const rows = within(region).getAllByRole('row');
      if (!rows[2]) throw new Error('Missing second golfer.');
      expect(within(rows[2]).getAllByRole('cell')[8]).toHaveTextContent('8');
      expect(within(rows[2]).getAllByRole('cell')[11]).toHaveTextContent('16 (partial)');
      expect(rows[1]).toHaveTextContent(player.displayName);
      await user.click(screen.getByRole('button', { name: 'Front 9' }));
      expect(within(region).getByRole('columnheader', { name: '1' })).toBeVisible();
      expect(window.location.hash).toBe(route);
    } finally {
      window.history.replaceState(null, '', previousUrl);
    }
  });

  it.each([
    ['missing-handicap-index', 'No captured Handicap Index is available.'],
    ['invalid-handicap-index', 'The captured Handicap Index cannot be used.'],
    ['missing-tee-ratings', 'Tee ratings are unavailable.'],
    ['missing-stroke-index', 'Hole stroke indexes are unavailable.'],
    ['missing-score-data', 'Score data is unavailable.'],
  ] as const)('shows a clear unavailable reason for %s without inventing results', (reason, copy) => {
    render(<GameResults game={game} holeNumbers={holeNumbers} result={{ gameId: game.id, players: [{
      ...player, status: 'unavailable', unavailableReason: reason, playingHandicap: null,
      frontPoints: null, backPoints: null, totalPoints: null, holesScored: 0,
    }] }} />);
    expect(screen.getByText(`${player.displayName}: ${copy}`)).toBeVisible();
    expect(screen.getAllByLabelText('Unavailable')).toHaveLength(9);
    expect(screen.queryByLabelText('Pending')).not.toBeInTheDocument();
    expect(screen.queryByText('(partial)', { exact: false })).not.toBeInTheDocument();
  });

  it('shows zero as a scored total, complete status, and missing results explicitly', () => {
    const view = render(<GameResults game={{ ...game, basis: 'gross' }} holeNumbers={holeNumbers} result={{ gameId: game.id, players: [{
      ...player, status: 'complete', totalPoints: 0, frontPoints: 0, backPoints: 0, holesScored: 18,
      holes: player.holes.map((hole) => ({ ...hole, points: 0 })),
    }] }} />);
    expect(screen.getByText('Modified Stableford · Gross')).toBeVisible();
    expect(screen.getByText('Complete')).toBeVisible();
    expect(within(screen.getByRole('region', { name: `${game.name} points scorecard` }))
      .getAllByRole('cell', { name: '0' })).toHaveLength(12);
    expect(screen.queryByText(/Playing handicap/)).not.toBeInTheDocument();
    view.rerender(<GameResults game={game} holeNumbers={holeNumbers} result={undefined} />);
    expect(screen.getByText('Results are unavailable.')).toBeVisible();
  });

  it.each([1, 10])('shows a standalone nine starting at hole %s without an unavailable side selector', (start) => {
    const numbers = Array.from({ length: 9 }, (_, index) => start + index);
    render(<GameResults game={game} holeNumbers={numbers} result={{ gameId: game.id, players: [{
      ...player, status: 'complete', holesScored: 9, totalHoles: 9,
      holes: numbers.map((number) => ({ number, points: 0, strokesReceived: 0 })),
      frontPoints: start === 1 ? 0 : null, backPoints: start === 10 ? 0 : null, totalPoints: 0,
    }] }} />);
    expect(screen.queryByRole('button', { name: /Front 9|Back 9/ })).not.toBeInTheDocument();
    for (const number of numbers) expect(screen.getByRole('columnheader', { name: String(number) })).toBeVisible();
    expect(screen.getByText('Complete')).toBeVisible();
  });

  it('renders actual teams and member context without inventing team handicaps or exposing individual totals as team credits', () => {
    const result = teamLeaderboardRound.games?.results[0];
    if (!result) throw new Error('Missing fictional teams.');
    render(<GameResults game={teamLeaderboardGame} result={result} holeNumbers={teamLeaderboardRound.layout.map((hole) => hole.number)} />);
    expect(screen.getByRole('columnheader', { name: 'Team' })).toBeVisible();
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent('Fictional team 1');
    expect(rows[1]).toHaveTextContent('Fictional golfer 1 · Fictional golfer 2');
    expect(rows[1]).toHaveTextContent('1/9 holes');
    expect(screen.queryByText(/Playing handicap/)).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Pending').every((cell) => cell.textContent === '')).toBe(true);
    expect(screen.getByText(/Fictional team 3: No captured Handicap Index/)).toBeVisible();
    const first = rows[1];
    if (!first) throw new Error('Missing fictional team row.');
    expect(within(first).getAllByRole('cell')[0]).toHaveTextContent('2');
  });

  it('never falls back to individual rows for stale or missing team results', () => {
    const result = teamLeaderboardRound.games?.results[0];
    if (!result) throw new Error('Missing fictional teams.');
    const view = render(<GameResults game={teamLeaderboardGame} result={{ ...result, teams: [], teamSetupRequired: true }}
      holeNumbers={holeNumbers} />);
    expect(screen.getByText(/Update team assignments/)).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    view.rerender(<GameResults game={teamLeaderboardGame} result={{ gameId: result.gameId, players: result.players }} holeNumbers={holeNumbers} />);
    expect(screen.getByText('Results are unavailable.')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
