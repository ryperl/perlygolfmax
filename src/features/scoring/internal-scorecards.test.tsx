import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WolfGameDefinition } from '../../domain/wolf';
import { strokeGameId } from '../../domain/stroke-games.test-support';
import { dotsFixture } from '../dots/dots.test-support';
import { RoundLeaderboard } from '../leaderboard';
import { SavedScorecards } from './SavedScorecards';

describe('internal earned-dot result presentation', () => {
  it('scopes Dots to its foursome and labels round bonuses without confusing handicap stroke dots', () => {
    const f = dotsFixture();
    if (!f.round.games) throw new Error('Missing fictional games');
    const players = f.round.cards.map((card) => ({ playerId: card.playerId, displayName: card.displayName,
      playingHandicap: null, status: 'complete' as const, holesScored: 9, totalHoles: 9,
      holes: f.round.layout.map((hole) => ({ number: hole.number, points: 0, strokesReceived: 0 })),
      frontPoints: 2, backPoints: 0, totalPoints: 3 }));
    const other = { ...f.game, id: strokeGameId(982), name: 'Fictional other group', groupNumber: 2,
      playerIds: [strokeGameId(5), strokeGameId(6), strokeGameId(7), strokeGameId(8)] };
    const round = { ...f.round, games: { configuration: { ...f.round.games.configuration, games: [other, f.game] },
      results: [{ gameId: f.game.id, kind: 'dots' as const, players,
        dots: { status: 'complete' as const, players, awards: [], holes: [], issues: [], unawarded: [] } }] } };
    render(<SavedScorecards round={round} groupNumber={1} busy={false} onGroupChange={vi.fn()} onEnterScores={vi.fn()} />);
    expect(within(screen.getByLabelText('Game')).queryByRole('option', { name: /Fictional other group/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('rowheader', { name: /game dots$/ })).toHaveLength(4);
    expect(screen.getByRole('columnheader', { name: 'Earned dots' })).toBeVisible();
    expect(screen.getAllByText('Total includes round bonuses')).toHaveLength(4);
    expect(screen.getByText('Saved special dots · Includes individual round bonuses')).toBeVisible();
    expect(screen.queryByText('DOT BALANCE')).not.toBeInTheDocument();
  });

  it('labels new Wolf earned dots on cards and ranks saved earned totals, retaining legacy balance labels for V1', () => {
    const f = dotsFixture();
    if (!f.round.games) throw new Error('Missing fictional games');
    const wolf: WolfGameDefinition = { id: f.game.id, name: 'Fictional earned Wolf', kind: 'wolf', version: 2,
      basis: 'gross', groupNumber: 1, playerIds: f.ids, allowPig: false, stakeMinor: null };
    const players = f.round.cards.map((card, index) => ({ playerId: card.playerId, displayName: card.displayName,
      playingHandicap: 0, status: 'in-progress' as const, holesScored: 1, totalHoles: 9,
      holes: f.round.layout.map((hole) => ({ number: hole.number, points: 0, strokesReceived: 0 })),
      frontPoints: index < 2 ? 2 : 0, backPoints: 0, totalPoints: index < 2 ? 2 : 0 }));
    const round = { ...f.round, games: { configuration: { ...f.round.games.configuration, games: [wolf] },
      results: [{ gameId: wolf.id, kind: 'wolf' as const, players }] } };
    const view = render(<SavedScorecards round={round} groupNumber={1} busy={false} onGroupChange={vi.fn()} onEnterScores={vi.fn()} />);
    expect(screen.getAllByText('Earned dots')).toHaveLength(4);
    expect(screen.queryByText('DOT BALANCE')).not.toBeInTheDocument();
    view.rerender(<RoundLeaderboard round={round} busy={false} onManageGames={vi.fn()} />);
    expect(screen.getAllByText('earned dots')).toHaveLength(4);
    expect(screen.getAllByLabelText('Tied position 1')).toHaveLength(2);
    expect(screen.getAllByLabelText('Tied position 3')).toHaveLength(2);
    const { stakeMinor, ...legacy } = wolf;
    void stakeMinor;
    view.rerender(<SavedScorecards round={{ ...round, games: { ...round.games,
      configuration: { ...round.games.configuration, games: [{ ...legacy, version: 1 as const }] } } }}
      groupNumber={1} busy={false} onGroupChange={vi.fn()} onEnterScores={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Game'), { target: { value: wolf.id } });
    expect(screen.getAllByText('DOT BALANCE')).toHaveLength(4);
  });
});
