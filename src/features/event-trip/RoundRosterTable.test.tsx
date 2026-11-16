import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RoundRosterTable } from './RoundRosterTable';
import { purseTestContext, purseTestId } from '../../domain/purse.test-support';
import type { PlayerCourseHandicap } from '../../domain/scoring';

describe('aligned round roster rows', () => {
  it('uses the supplied group/team membership order and captured CH column, distinguishing zero, plus and NH', () => {
    const round = purseTestContext().workspace.rounds[0];
    if (!round) throw new Error('Missing fixture');
    const ids = round.players.map((player) => player.playerId);
    const table = render(<RoundRosterTable round={round} label="Fictional group"
      playerIds={[...ids].reverse()} handicaps={new Map<string, PlayerCourseHandicap>([
        [purseTestId(1), { playerId: purseTestId(1), courseHandicap: 0 }],
        [purseTestId(2), { playerId: purseTestId(2), courseHandicap: -1 }],
        [purseTestId(3), { playerId: purseTestId(3), courseHandicap: null, unavailableReason: 'missing-handicap-index' }],
      ])} />);
    const grid = within(screen.getByRole('table', { name: 'Fictional group golfers and Course Handicaps' }));
    expect(grid.getAllByRole('rowheader').map((entry) => entry.textContent)).toEqual([...round.players].reverse().map((entry) => entry.displayName));
    expect(grid.getByLabelText('Course handicap: 0')).toHaveTextContent(/^0$/);
    expect(grid.getByLabelText('Course handicap: +1')).toHaveTextContent(/^\+1$/);
    expect(grid.getByLabelText('No captured Handicap Index')).toHaveTextContent(/^NH$/);
    expect(grid.getByLabelText('Course handicap unavailable')).toHaveTextContent(/^—$/);
    table.rerender(<RoundRosterTable round={round} label="Stale team" playerIds={[purseTestId(99)]} handicaps={new Map()} />);
    expect(screen.getByRole('rowheader')).toHaveTextContent('Player unavailable');
    expect(screen.getByLabelText('Course handicap unavailable')).toHaveTextContent(/^—$/);
    expect(screen.queryByText('NH')).not.toBeInTheDocument();
  });
});
