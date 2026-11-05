import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fictionalId, fictionalWorkspace } from '../../client/catalog.test-support';
import type { EventLeaderboardView, EventStandingReason, EventStandingStatus } from '../../domain/event-leaderboard';
import { EventLeaderboard } from './EventLeaderboard';

function fixture(): EventLeaderboardView {
  const rounds = Array.from({ length: 8 }, (_, index) => ({
    roundId: fictionalId(70 + index), roundName: `Fictional round ${String(index + 1)}`, totalHoles: 18, gameId: null,
  }));
  return {
    workspace: { ...fictionalWorkspace, overallCompetition: { kind: 'stroke-play', basis: 'gross' } },
    roundScores: [],
    standings: {
      status: 'provisional', rounds, staleRoundIds: [],
      players: ['Fictional First', 'Fictional Tied', 'Fictional Pending', 'Fictional NR'].map((displayName, index) => ({
        playerId: fictionalId(index + 1), displayName,
        status: index === 2 ? 'awaiting-scores' : index === 3 ? 'unavailable' : 'in-progress',
        ...(index === 3 ? { reason: 'invalid-stroke-score' as const } : {}),
        holesScored: index === 2 ? 0 : 1, totalHoles: 144,
        subtotal: index === 2 ? null : 4, relativeToPar: index === 2 ? null : 0,
        rank: index < 2 ? 1 : null, rankLabel: index < 2 ? 'T1' : null,
        cells: rounds.map((round, roundIndex) => ({
          roundId: round.roundId, status: 'in-progress', holesScored: 1, totalHoles: 18,
          subtotal: 4, relativeToPar: roundIndex === 0 ? -1 : roundIndex === 1 ? 1 : 0,
        })),
      })),
    },
  };
}
describe('overall leaderboard presentation', () => {
  it('supports left/right keyboard scrolling without consuming other keys', () => {
    render(<EventLeaderboard value={fixture()} />);
    const region = screen.getByRole('region', { name: /scroll horizontally/ });
    const scrollBy = vi.fn();
    Object.defineProperty(region, 'scrollBy', { value: scrollBy });
    fireEvent.keyDown(region, { key: 'ArrowRight' });
    fireEvent.keyDown(region, { key: 'ArrowLeft' });
    fireEvent.keyDown(region, { key: 'Tab' });
    expect(scrollBy.mock.calls).toEqual([[{ left: 160 }], [{ left: -160 }]]);
  });
  it('renders every server round, participant and supplied tie label with signed live totals and progress', () => {
    const value = fixture();
    render(<EventLeaderboard value={value} />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(11);
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(within(table).getAllByText('T1')).toHaveLength(2);
    expect(within(table).getAllByText('+1')).toHaveLength(4);
    expect(within(table).getAllByText('-1')).toHaveLength(4);
    expect(within(table).getAllByText('0').length).toBeGreaterThan(0);
    expect(within(table).getByText('NR')).toBeVisible();
    expect(within(table).getByText('Awaiting scores · 0/144 holes')).toBeVisible();
    expect(within(table).getAllByText('Not ranked')).toHaveLength(2);
    expect(screen.getByRole('region', { name: /scroll horizontally/ })).toHaveAttribute('tabindex', '0');
    expect(screen.getByText(/Provisional:/)).toBeVisible();
    expect(screen.queryByText(/winner/i)).not.toBeInTheDocument();
  });
  it('uses Stableford points and explicit team-member credit, not browser score math', () => {
    const value = fixture();
    render(<EventLeaderboard value={{ ...value, workspace: { ...value.workspace,
      overallCompetition: { kind: 'stableford', credit: 'team', roundGames: [] } } }} />);
    expect(screen.getByText(/full team points credited to each member/)).toBeVisible();
    expect(screen.getAllByText('+4')).toHaveLength(34);
    expect(screen.queryByText('4 strokes')).not.toBeInTheDocument();
  });
  it('shows net allowance and archived read-only status without implying finalization', () => {
    const value = fixture();
    render(<EventLeaderboard value={{ ...value, workspace: { ...value.workspace, event: { ...value.workspace.event, status: 'archived' },
      overallCompetition: { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 95 } },
    standings: { ...value.standings, status: 'complete', staleRoundIds: [fictionalId(99)] } }} />);
    expect(screen.getByText(/Net \(95% allowance\)/)).toBeVisible();
    expect(screen.getByText(/Archived event/)).toBeVisible();
    expect(screen.getByText(/not event finalization/)).toBeVisible();
    expect(screen.getByText(/Review removed-round/)).toBeVisible();
  });
  it('shows disabled setup to owners and published result rows to admitted nonowners', () => {
    const value = fixture();
    const view = render(<EventLeaderboard value={{ ...value, workspace: fictionalWorkspace }} />);
    expect(screen.getByRole('heading', { name: /not enabled/ })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open event setup' })).toHaveAttribute('href', `#events?event=${fictionalWorkspace.event.id}`);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    view.rerender(<EventLeaderboard value={{ ...value, workspace: { ...value.workspace, event: { ...value.workspace.event, role: 'member' } } }} />);
    expect(screen.getByRole('table')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open event setup' })).not.toBeInTheDocument();
    view.rerender(<EventLeaderboard value={{ ...value, workspace: { ...fictionalWorkspace, event: { ...fictionalWorkspace.event, role: 'viewer' } } }} />);
    expect(screen.getByRole('heading', { name: /not enabled/ })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open event setup' })).not.toBeInTheDocument();
  });
  it.each<EventStandingReason>([
    'missing-handicap-index', 'invalid-handicap-index', 'missing-tee-ratings', 'missing-stroke-index',
    'missing-score-data', 'not-configured', 'missing-game', 'missing-round', 'team-setup-required',
    'invalid-stroke-score', 'arithmetic-range', 'round-context-mismatch', 'stale-round-binding',
  ])('explains %s without exposing internal reason codes or assigning a fake total', (reason) => {
    const value = fixture();
    const player = value.standings.players[0];
    if (!player) throw new Error('Missing fixture player.');
    render(<EventLeaderboard value={{ ...value, standings: { ...value.standings, players: [{
      ...player, status: 'unavailable', reason, rank: null, rankLabel: null, cells: [],
    }] } }} />);
    expect(screen.queryByText(reason, { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText('Not ranked')).toBeVisible();
    expect(screen.getByRole('table').textContent).not.toContain('undefined');
  });
  it.each<EventStandingStatus>(['complete', 'in-progress', 'awaiting-scores', 'not-configured', 'unavailable'])('presents %s honestly', (status) => {
    const value = fixture();
    const player = value.standings.players[0];
    if (!player) throw new Error('Missing fixture player.');
    render(<EventLeaderboard value={{ ...value, standings: { ...value.standings, players: [{ ...player, status, cells: [] }] } }} />);
    expect(screen.getByRole('table').textContent).not.toContain('undefined');
  });
});
