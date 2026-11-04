import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fictionalId } from '../../client/catalog.test-support';
import type { GamePlayerResult, RoundGameDefinition } from '../../domain/games';
import { stablefordPoints } from '../../domain/stableford';
import { GameResults } from './GameResults';

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

describe('GameResults', () => {
  it('shows server totals, zero/negative points, plus handicap, partial progress and pending holes in provided order', () => {
    const second = { ...player, playerId: fictionalId(512), displayName: 'Fictional Golfer B', totalPoints: 8 };
    const { container } = render(<GameResults game={game} result={{ gameId: game.id, players: [player, second] }} />);
    const table = within(screen.getByRole('region', { name: `${game.name} points totals` })).getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Fictional Golfer A');
    expect(rows[2]).toHaveTextContent('Fictional Golfer B');
    expect(rows[1]).toHaveTextContent('+2');
    expect(rows[1]).toHaveTextContent('-1 (partial)');
    expect(rows[1]).toHaveTextContent('2/18 holes · In progress');
    expect(screen.getByText('Net · 95% allowance')).toBeVisible();
    fireEvent.click(screen.getByText('Fictional Golfer A · Hole points'));
    const holes = screen.getByRole('region', { name: `${game.name}, ${player.displayName}, hole points` });
    expect(within(holes).getByRole('cell', { name: '0' })).toBeVisible();
    expect(within(holes).getByRole('cell', { name: '-1' })).toBeVisible();
    expect(within(holes).getAllByLabelText('Pending')).toHaveLength(16);
    expect(holes).toHaveAttribute('tabindex', '0');
    expect(container.textContent).not.toContain(game.id);
    expect(container.textContent).not.toContain(player.playerId);
    expect(container.textContent).not.toMatch(/rank|handicap index|recordedAt/i);
    expect(within(table).getByRole('button', { name: player.displayName }).getAttribute('aria-controls')).not.toContain(player.playerId);
    expect(within(table).queryByRole('link')).not.toBeInTheDocument();
  });

  it.each(['click', 'Enter', 'Space'])('opens and focuses the correct golfer details on %s without changing the route hash', async (action) => {
    const user = userEvent.setup();
    const previousUrl = window.location.href;
    const route = `#events?event=${fictionalId(520)}&round=${fictionalId(521)}`;
    window.history.replaceState(null, '', route);
    try {
      const second = {
        ...player, playerId: fictionalId(512), displayName: 'Fictional Golfer B',
        frontPoints: 8, totalPoints: 8,
        holes: player.holes.map((hole) => ({ ...hole, points: hole.number === 1 ? 8 : hole.number === 2 ? 0 : null })),
      };
      render(<GameResults game={game} result={{ gameId: game.id, players: [player, second] }} />);
      const button = screen.getByRole('button', { name: second.displayName });
      if (action === 'click') await user.click(button);
      else {
        button.focus();
        await user.keyboard(action === 'Enter' ? '{Enter}' : ' ');
      }
      const summary = screen.getByText('Fictional Golfer B · Hole points');
      expect(summary.closest('details')).toHaveAttribute('open');
      expect(summary).toHaveFocus();
      expect(screen.getByText('Fictional Golfer A · Hole points').closest('details')).not.toHaveAttribute('open');
      const region = screen.getByRole('region', { name: `${game.name}, ${second.displayName}, hole points` });
      expect(within(region).getByRole('cell', { name: '8' })).toBeVisible();
      expect(within(region).getByRole('cell', { name: '0' })).toBeVisible();
      expect(button).toHaveAttribute('aria-controls', summary.closest('details')?.id);
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
    render(<GameResults game={game} result={{ gameId: game.id, players: [{
      ...player, status: 'unavailable', unavailableReason: reason, playingHandicap: null,
      frontPoints: null, backPoints: null, totalPoints: null, holesScored: 0,
    }] }} />);
    expect(within(screen.getByRole('region', { name: `${game.name} points totals` })).getByText(copy)).toBeVisible();
    expect(screen.queryByText('(partial)', { exact: false })).not.toBeInTheDocument();
  });

  it('shows zero as a scored total, complete status, and missing results explicitly', () => {
    const view = render(<GameResults game={{ ...game, basis: 'gross' }} result={{ gameId: game.id, players: [{
      ...player, status: 'complete', totalPoints: 0, frontPoints: 0, backPoints: 0,
    }] }} />);
    expect(screen.getByText('Gross')).toBeVisible();
    expect(screen.getByText('Complete')).toBeVisible();
    expect(within(screen.getByRole('region', { name: `${game.name} points totals` }))
      .getAllByRole('cell', { name: '0' })).toHaveLength(3);
    expect(screen.queryByRole('columnheader', { name: 'Playing handicap' })).not.toBeInTheDocument();
    view.rerender(<GameResults game={game} result={undefined} />);
    expect(screen.getByText('Results are unavailable.')).toBeVisible();
  });
});
