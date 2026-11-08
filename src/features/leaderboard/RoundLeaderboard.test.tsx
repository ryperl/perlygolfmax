import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RoundLeaderboard } from './RoundLeaderboard';
import { fictionalStanding, leaderboardGames, leaderboardRound, teamLeaderboardGame, teamLeaderboardRound } from '../../client/leaderboard.test-support';
import { fictionalRoundScores } from '../../client/scoring.test-support';
import { fictionalId, fictionalProfile } from '../../client/catalog.test-support';
import { calculateGameResults } from '../../domain/stableford';
import { strokeGameCards, strokeGameFixture, strokeGamesRound } from '../../domain/stroke-games.test-support';

describe('round leaderboard', () => {
  it.each(['gross', 'net'] as const)('shows only awarded %s Skins golfers and restores winners after refresh', (basis) => {
    const f = strokeGameFixture(9, 16);
    const skins = { ...f.skins, basis: 'gross' as const, carryovers: false };
    const makeRound = (strokes: readonly number[], basis: 'gross' | 'net') => {
      const cards = strokeGameCards(f.cards, 1, strokes.map((value) => ({ kind: 'strokes' as const, strokes: value })));
      const game = { ...skins, basis };
      const original = strokeGamesRound({ ...f, cards, skins: game });
      return { ...original, games: { ...original.games, configuration: { ...original.games?.configuration,
        eventId: original.eventId, roundId: original.roundId, etag: 'fictional-games', games: [game] },
        results: calculateGameResults([game], f.snapshot, cards) } };
    };
    const initial = makeRound([3, ...Array<number>(15).fill(4)], basis);
    const view = render(<RoundLeaderboard round={initial} busy={false} onManageGames={vi.fn()} />);
    const list = screen.getByRole('list', { name: 'Standings' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(list).toHaveTextContent('Fictional golfer 1');
    expect(screen.queryByLabelText('0 skins')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next standings' })).not.toBeInTheDocument();
    view.rerender(<RoundLeaderboard round={makeRound([4, 3, ...Array<number>(14).fill(4)], basis)} busy={false} onManageGames={vi.fn()} />);
    expect(screen.getByRole('list', { name: 'Standings' })).toHaveTextContent('Fictional golfer 2');
    expect(screen.queryByRole('heading', { name: 'Fictional golfer 1', level: 4 })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Position 1')).toBeVisible();
  });
  it('retains pending and unavailable Skins results instead of treating them as zero wins', () => {
    const f = strokeGameFixture();
    const cards = strokeGameCards(f.cards, 1, [{ kind: 'unplayed' }]);
    const game = { ...f.skins, basis: 'net' as const };
    const original = strokeGamesRound({ ...f, cards, skins: game });
    if (!original.games) throw new Error('Missing fictional games.');
    const round = { ...original, games: { ...original.games,
      configuration: { ...original.games.configuration, games: [game] },
      results: original.games.results.filter((result) => result.gameId === game.id),
    } };
    const view = render(<RoundLeaderboard round={round} busy={false} onManageGames={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Awaiting scores' })).toHaveTextContent('Fictional golfer 1');
    expect(screen.getByText('No ranked scores yet.')).toBeVisible();
    const snapshot = { ...f.snapshot, players: f.snapshot.players.map((player, index) => index === 0 ? { ...player, handicapIndex: null } : player) };
    view.rerender(<RoundLeaderboard round={{ ...round, games: {
      ...round.games, results: calculateGameResults([game], snapshot, cards),
    } }} busy={false} onManageGames={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Unavailable results' })).toHaveTextContent('Fictional golfer 1');
    expect(screen.queryByLabelText('0 skins')).not.toBeInTheDocument();
  });
  it('pages only skin winners, preserves ties and does not retain a hidden search filter after a smaller refresh', async () => {
    const f = strokeGameFixture(18, 20);
    const game = { ...f.skins, carryovers: false };
    function makeRound(winners: number) {
      let cards = f.cards;
      for (let hole = 1; hole <= winners; hole++) {
        cards = strokeGameCards(cards, hole, f.cards.map((_, index) => ({
          kind: 'strokes', strokes: index === hole - 1 ? 3 : 4,
        })));
      }
      const original = strokeGamesRound({ ...f, cards, skins: game });
      if (!original.games) throw new Error('Missing fictional game.');
      return { ...original, games: { ...original.games,
        configuration: { ...original.games.configuration, games: [game] },
        results: original.games.results.filter((result) => result.gameId === game.id),
      } };
    }
    const view = render(<RoundLeaderboard round={makeRound(14)} busy={false} onManageGames={vi.fn()} />);
    const user = userEvent.setup();
    expect(screen.getAllByLabelText('Tied position 1')).toHaveLength(12);
    await user.click(screen.getByRole('button', { name: 'Next standings' }));
    expect(screen.getAllByLabelText('Tied position 1')).toHaveLength(2);
    await user.type(screen.getByRole('searchbox'), '14');
    expect(screen.getByRole('list', { name: 'Standings' })).toHaveTextContent('Fictional golfer 14');
    expect(screen.queryByLabelText('0 skins')).not.toBeInTheDocument();
    view.rerender(<RoundLeaderboard round={makeRound(1)} busy={false} onManageGames={vi.fn()} />);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Standings' })).toHaveTextContent('Fictional golfer 1');
    expect(screen.getByLabelText('Position 1')).toBeVisible();
  });
  it('shows an honest empty Skins state for known zero awards while leaving Ball Drop zero scores visible', async () => {
    const f = strokeGameFixture();
    const original = strokeGamesRound(f);
    const view = render(<RoundLeaderboard round={original} busy={false} onManageGames={vi.fn()} />);
    await userEvent.setup().selectOptions(screen.getByLabelText('Leaderboard game'), f.skins.id);
    expect(screen.getByText('No skins awarded yet.')).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Standings' })).not.toBeInTheDocument();
    await userEvent.setup().selectOptions(screen.getByLabelText('Leaderboard game'), f.ballDrop.id);
    expect(screen.getByRole('list', { name: 'Standings' })).toHaveTextContent('Fictional team 1');
    expect(screen.getByLabelText('0 to par')).toBeVisible();
    view.rerender(<RoundLeaderboard round={original} busy={false} onManageGames={vi.fn()} />);
  });
  it('renders the same server standings for an admitted viewer and never offers setup repair controls', () => {
    const round = { ...leaderboardRound, permissions: { role: 'viewer' as const, writePlayerIds: [], canManageGames: false } };
    const manage = vi.fn();
    const view = render(<RoundLeaderboard round={round} busy={false} onManageGames={manage} />);
    expect(screen.getByRole('list', { name: 'Standings' })).toBeVisible();
    expect(screen.getAllByLabelText('Tied position 1')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Configure|Update team/ })).not.toBeInTheDocument();
    view.rerender(<RoundLeaderboard round={{ ...round, eventStatus: 'archived' }} busy={false} onManageGames={manage} />);
    expect(screen.getByRole('alert')).toHaveTextContent('event owner only');
    expect(screen.queryByRole('list', { name: 'Standings' })).not.toBeInTheDocument();
    expect(manage).not.toHaveBeenCalled();
  });
  it('searches and pages a large field while retaining full-field positions and personal tee context', async () => {
    if (!leaderboardRound.games) throw new Error('Missing fictional games.');
    const first = leaderboardRound.games.configuration.games[0];
    if (!first) throw new Error('Missing fictional game.');
    const players = Array.from({ length: 40 }, (_, index) => ({
      ...fictionalStanding(index + 1, 100 - index, 9), playerId: fictionalId(index + 1),
      displayName: `Fictional golfer ${String(index + 1).padStart(2, '0')}`,
    }));
    const round = { ...leaderboardRound,
      playerTees: [{ playerId: fictionalId(40), profile: { ...fictionalProfile, name: 'Fictional personal Silver' } }],
      games: { ...leaderboardRound.games, results: [{ gameId: first.id, players }] },
    };
    const { rerender } = render(<RoundLeaderboard round={round} busy={false} onManageGames={vi.fn()} />);
    const user = userEvent.setup();
    expect(within(screen.getByRole('list', { name: 'Standings' })).getAllByRole('listitem')).toHaveLength(12);
    await user.click(screen.getByRole('button', { name: 'Next standings' }));
    expect(screen.getByLabelText('Position 13')).toBeVisible();
    await user.type(screen.getByRole('searchbox'), '40');
    expect(screen.getByLabelText('Position 40')).toBeVisible();
    expect(screen.getByText('Fictional personal Silver / Fictional A')).toBeVisible();
    rerender(<RoundLeaderboard round={{ ...round }} busy={false} onManageGames={vi.fn()} />);
    expect(screen.getByRole('searchbox')).toHaveValue('40');
    await user.clear(screen.getByRole('searchbox'));
    expect(screen.getByLabelText('Position 1')).toBeVisible();
    await user.type(screen.getByRole('searchbox'), 'no such fictional golfer');
    expect(screen.getByText('No leaderboard entries match your search.')).toBeVisible();
  });
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

  it('ranks saved team totals with member context, not underlying individual components', () => {
    const { container } = render(<RoundLeaderboard round={teamLeaderboardRound} busy={false} onManageGames={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Team standings' })).toBeVisible();
    const rows = within(screen.getByRole('list', { name: 'Standings' })).getAllByRole('listitem');
    expect(rows.map((row) => within(row).getByRole('heading').textContent)).toEqual(['Fictional team 2', 'Fictional team 1']);
    expect(rows[1]).toHaveTextContent('Fictional golfer 1 · Fictional golfer 2');
    expect(rows[1]).toHaveTextContent('1/9 holes · In progress');
    expect(screen.getByRole('region', { name: 'Unavailable results' })).toHaveTextContent('Fictional team 3');
    expect(screen.getByText(/Teams may have played different/)).toBeVisible();
    expect(container.textContent).not.toContain(teamLeaderboardGame.teams[0]?.id);
  });

  it('keeps stale and missing team results unranked and offers assignment repair without individual fallback', async () => {
    const games = teamLeaderboardRound.games;
    const result = games?.results[0];
    if (!games || !result) throw new Error('Missing fictional teams.');
    const onManageGames = vi.fn();
    const view = render(<RoundLeaderboard round={{ ...teamLeaderboardRound, games: {
      ...games, results: [{ ...result, teams: [], teamSetupRequired: true }],
    } }} busy={false} onManageGames={onManageGames} />);
    expect(screen.queryByRole('list', { name: 'Standings' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Update team assignments' }));
    expect(onManageGames).toHaveBeenCalledOnce();
    view.rerender(<RoundLeaderboard round={{ ...teamLeaderboardRound, games: {
      ...games, results: [{ gameId: result.gameId, players: result.players }],
    } }} busy={false} onManageGames={onManageGames} />);
    expect(screen.getByText(/Leaderboard results are unavailable/)).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Standings' })).not.toBeInTheDocument();
  });
});
