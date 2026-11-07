import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { strokeGameFixture, strokeGameCards, strokeGamesRound } from '../../domain/stroke-games.test-support';
import { buildGame, draftFromGame, newGameDraft, setGameKind } from './game-draft';
import { GameSettings } from './GameSettings';
import { GameResults } from './GameResults';
import { RoundLeaderboard } from '../leaderboard';
import { sameGameDefinitions } from '../../domain/games';

describe('Ball Drop and Skins editing and saved presentation', () => {
  it('builds clean versioned definitions and retains foursomes across the three formats', () => {
    const f = strokeGameFixture();
    const roster = f.cards.map((card) => card.playerId);
    for (const format of ['ball-drop-net-gross', 'ball-drop-two-net', 'ball-drop-two-gross'] as const) {
      const draft = { ...draftFromGame(f.ballDrop), format };
      const game = buildGame(draft, roster);
      expect(game).toMatchObject({ kind: 'ball-drop', version: 1, format, teams: f.ballDrop.teams });
      expect(game).not.toHaveProperty('points');
      expect(game).not.toHaveProperty('handicapAllowancePercent');
    }
    const skins = buildGame({ ...draftFromGame(f.skins), basis: 'net', carryovers: false }, roster);
    expect(skins).toMatchObject({ kind: 'skins', basis: 'net', carryovers: false });
    expect(skins).not.toHaveProperty('teams');
    expect(buildGame(draftFromGame(f.ballDrop), roster.slice(1))).toBeNull();
    expect(sameGameDefinitions([f.ballDrop], [{ ...f.ballDrop, teams: f.ballDrop.teams.map((team) => ({
      playerIds: team.playerIds, name: team.name, id: team.id,
    })) }])).toBe(true);
    expect(sameGameDefinitions([f.skins], [{ ...f.skins, carryovers: false }])).toBe(false);
  });

  it('uses dedicated controls without points/allowance, preserves selections, and switches back to Stableford', () => {
    const f = strokeGameFixture();
    function Fixture() {
      const [draft, setDraft] = useState(draftFromGame(f.ballDrop));
      return <GameSettings draft={draft} roster={f.cards} disabled={false} saveDisabled={false}
        cancelDisabled={false} retry={false} onChange={setDraft} onSave={vi.fn()} onCancel={vi.fn()} />;
    }
    render(<Fixture />);
    expect(screen.queryByLabelText('Points preset')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Handicap allowance (%)')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Team 1 member 1')).toHaveValue(f.cards[0]?.playerId);
    fireEvent.change(screen.getByLabelText('Game format'), { target: { value: 'ball-drop-two-gross' } });
    expect(screen.getByLabelText('Score basis')).toHaveValue('gross');
    expect(screen.getByLabelText('Team 1 member 1')).toHaveValue(f.cards[0]?.playerId);
    fireEvent.change(screen.getByLabelText('Game type'), { target: { value: 'skins' } });
    expect(screen.queryByLabelText('Game format')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Team 1 member 1')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Score basis'), { target: { value: 'net' } });
    fireEvent.click(screen.getByLabelText('Carry tied skins forward'));
    expect(screen.getByLabelText('Carry tied skins forward')).toBeChecked();
    expect(screen.queryByLabelText('Handicap allowance (%)')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Game type'), { target: { value: 'stableford' } });
    expect(screen.getByLabelText('Points preset')).toHaveValue('standard');
    expect(screen.queryByLabelText('Carry tied skins forward')).not.toBeInTheDocument();
    expect(setGameKind(newGameDraft(), 'ball-drop', 3).teams).toEqual([]);
  });

  it('renders distinct saved units, known zero wins and counting golfers, and uses team scorecards', () => {
    const f = strokeGameFixture();
    const cards = strokeGameCards(f.cards, 1, [{ kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 4 },
      { kind: 'strokes', strokes: 5 }, { kind: 'strokes', strokes: 6 }]);
    const round = strokeGamesRound({ ...f, cards });
    render(<><GameResults game={f.ballDrop} result={round.games?.results[0]} holeNumbers={round.layout.map((hole) => hole.number)} />
      <GameResults game={f.skins} result={round.games?.results[1]} holeNumbers={round.layout.map((hole) => hole.number)} /></>);
    expect(screen.getByRole('region', { name: 'Fictional Ball Drop to par scorecard' })).toHaveTextContent('-1');
    expect(screen.getAllByTitle('Fictional golfer 1 + Fictional golfer 2')[0]).toHaveTextContent('-1');
    expect(screen.getByRole('region', { name: 'Fictional Skins results' })).toHaveTextContent('8 unawarded');
  });

  it('ranks lower team-to-par first with ties and higher skin awards first, excluding pending rounds', () => {
    const f = strokeGameFixture(9, 8);
    const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'strokes' as const, strokes: index < 4 ? 5 : index === 4 ? 3 : 4 },
    })) }));
    const round = strokeGamesRound({ ...f, cards });
    const view = render(<RoundLeaderboard round={round} busy={false} onManageGames={vi.fn()} />);
    const rows = within(screen.getByRole('list', { name: 'Standings' })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Fictional team 2');
    expect(rows[0]).toHaveTextContent('to par');
    fireEvent.change(screen.getByLabelText('Leaderboard game'), { target: { value: f.skins.id } });
    expect(within(screen.getByRole('list', { name: 'Standings' })).getAllByRole('listitem')[0]).toHaveTextContent('Fictional golfer 5');
    expect(screen.getByLabelText('9 skins')).toBeVisible();
    const pending = strokeGamesRound({ ...f, cards: strokeGameCards(cards, 1, [{ kind: 'unplayed' }]) });
    view.rerender(<RoundLeaderboard round={pending} busy={false} onManageGames={vi.fn()} />);
    expect(screen.getByText('No ranked scores yet.')).toBeVisible();
    expect(screen.getByText(/no winner declared/)).toBeVisible();
  });
});
