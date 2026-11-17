import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { strokeGameFixture, strokeGameCards, strokeGamesRound } from '../../domain/stroke-games.test-support';
import { buildGame, draftFromGame, newGameDraft, setGameKind } from './game-draft';
import { GameSettings } from './GameSettings';
import { GameResults } from './GameResults';
import { RoundLeaderboard } from '../leaderboard';
import { sameGameDefinitions } from '../../domain/games';
import type { RoundGameDefinition, StrokePlayGameDefinition } from '../../domain/games';
import { calculateGameResults } from '../../domain/stableford';
import { gameStandings } from '../leaderboard/standings';
import { PlayerScorecardRecap } from '../scoring/PlayerScorecardRecap';

describe('Ball Drop and Skins editing and saved presentation', () => {
  it('selects individual gross/net Stroke Play without Stableford/team controls and builds only its versioned fields', () => {
    const f = strokeGameFixture();
    const save = vi.fn<(game: RoundGameDefinition | null) => void>();
    function Fixture() {
      const [draft, setDraft] = useState(newGameDraft());
      return <GameSettings draft={draft} roster={f.cards} supportedGameKinds={['stroke-play']} disabled={false} saveDisabled={false}
        cancelDisabled={false} retry={false} onChange={setDraft} onSave={() => { save(buildGame(draft)); }} onCancel={vi.fn()} />;
    }
    render(<Fixture />);
    fireEvent.change(screen.getByLabelText('Game type'), { target: { value: 'stroke-play' } });
    expect(screen.queryByLabelText('Points preset')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Handicap allowance (%)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Game format')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Carry tied skins forward')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Score basis'), { target: { value: 'net' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Game settings' }));
    expect(save.mock.calls[0]?.[0]).toMatchObject({ name: 'Stroke Play', kind: 'stroke-play', version: 1, basis: 'net' });
    expect(Object.keys(save.mock.calls[0]?.[0] ?? {}).sort()).toEqual(['basis', 'id', 'kind', 'name', 'version']);
    expect(buildGame(draftFromGame({ id: f.skins.id, name: '', kind: 'stroke-play', version: 1, basis: 'gross' }))).toBeNull();
  });

  it('shows actual strokes and personal-par ranks independently, including shared ties and unavailable golfers', () => {
    const f = strokeGameFixture();
    const game: StrokePlayGameDefinition = { id: f.skins.id, name: 'Fictional Stroke Play', kind: 'stroke-play', version: 1, basis: 'gross' };
    const snapshot = { ...f.snapshot, playerTees: [{ playerId: f.cards[0]?.playerId ?? '', profile: {
      ...f.snapshot.teeProfile, totalPar: 45, holes: f.snapshot.teeProfile.holes.map((hole) => ({ ...hole, par: 5 })),
    } }] };
    const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'strokes' as const, strokes: index === 0 ? 5 : 4 },
    })) }));
    const base = strokeGamesRound({ ...f, snapshot, cards });
    if (!base.games) throw new Error('Missing fictional games');
    const result = calculateGameResults([game], snapshot, cards)[0];
    const round = { ...base, games: { configuration: { ...base.games.configuration, games: [game] },
      results: result ? [result] : [] } };
    const view = render(<><RoundLeaderboard round={round} busy={false} onManageGames={vi.fn()} />
      <GameResults game={game} result={result} holeNumbers={round.layout.map((hole) => hole.number)} /></>);
    const standings = within(screen.getByRole('list', { name: 'Standings' })).getAllByRole('listitem');
    expect(standings[0]).toHaveTextContent('Fictional golfer 1');
    const leader = standings[0];
    if (!leader) throw new Error('Missing fictional leader');
    expect(within(leader).getByLabelText('45 strokes')).toHaveTextContent('0 to par');
    expect(screen.getAllByLabelText('Tied position 1')).toHaveLength(4);
    expect(screen.getByRole('columnheader', { name: 'To par' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Fictional Stroke Play strokes scorecard' })).toHaveTextContent('Gross strokes');
    const first = cards[0];
    if (!first) throw new Error('Missing fictional card');
    view.rerender(<PlayerScorecardRecap round={round} card={first} gameId={game.id} />);
    expect(screen.getAllByText('Gross strokes').length).toBeGreaterThan(0);
    expect(screen.queryByText('Team to par')).not.toBeInTheDocument();
    const invalidCards = strokeGameCards(cards, 1, [{ kind: 'picked-up', reportedStrokes: 7 }, { kind: 'unplayed' }]);
    const invalidResult = calculateGameResults([game], snapshot, invalidCards)[0];
    const ranked = gameStandings(invalidResult?.players ?? [], 1);
    expect(ranked.ranked.map(({ player }) => player.playerId)).not.toContain(first.playerId);
    expect(ranked.unavailable).toHaveLength(1);
    expect(ranked.provisional).toBe(true);
  });
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
