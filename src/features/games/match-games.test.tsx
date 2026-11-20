import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { NassauGameDefinition, MatchPlayGameDefinition } from '../../domain/nassau';
import type { WolfGameDefinition } from '../../domain/wolf';
import type { RoundGameDefinition, RoundGameResult } from '../../domain/games';
import type { RoundScores } from '../../domain/scoring';
import { strokeGameFixture, strokeGameId, strokeGamesRound } from '../../domain/stroke-games.test-support';
import { calculateNassau } from '../../domain/nassau';
import { RoundLeaderboard } from '../leaderboard';
import { SavedScorecards } from '../scoring/SavedScorecards';
import { buildGame, draftFromGame, newGameDraft, setGameKind, setNassauVariant } from './game-draft';
import { GameSettings } from './GameSettings';
import { RoundGamesPanel } from './RoundGamesPanel';
import { RoundGameHoleControls } from './RoundGameHoleControls';

function fixture() {
  const f = strokeGameFixture(18);
  const ids = f.cards.map((card) => card.playerId);
  const wolf: WolfGameDefinition = { id: strokeGameId(950), name: 'Fictional Wolf', kind: 'wolf', version: 1,
    basis: 'net', groupNumber: 1, playerIds: [...ids].reverse(), allowPig: true };
  const nassau: NassauGameDefinition = { id: strokeGameId(951), name: 'Fictional Nassau', kind: 'nassau', version: 1,
    basis: 'gross', groupNumber: 1, variant: 'two-v-two-best-ball', automaticPresses: false,
    sides: [{ id: strokeGameId(952), name: 'Fictional Red', playerIds: ids.slice(0, 2) },
      { id: strokeGameId(953), name: 'Fictional Blue', playerIds: ids.slice(2) }],
    stakes: { currency: 'USD', frontMinor: 101, backMinor: 200, overallMinor: 0 } };
  const base = strokeGamesRound(f);
  const result: RoundGameResult = { gameId: nassau.id, kind: 'nassau', players: [],
    nassau: calculateNassau(nassau, f.snapshot, f.cards) };
  const round: RoundScores = { ...base, setupLocked: false, supportedGameKinds: ['stableford', 'stroke-play', 'wolf', 'nassau'],
    games: { configuration: { eventId: base.eventId, roundId: base.roundId, etag: 'fictional-game-v1', games: [nassau, wolf] },
      results: [result] } };
  return { f, nassau, wolf, round };
}

describe('shared match game setup and presentation', () => {
  it.each([9, 18] as const)('configures a separate %i-hole Match Play with one explicit stake and no Nassau conversion', async (count) => {
    const f = strokeGameFixture(count);
    const base = strokeGamesRound(f);
    const round: RoundScores = { ...base, setupLocked: false, supportedGameKinds: ['match-play', 'nassau'],
      games: { configuration: { eventId: base.eventId, roundId: base.roundId, etag: null, games: [] }, results: [] } };
    const onSave = vi.fn().mockResolvedValue(null);
    render(<RoundGamesPanel round={round} busy={false} onDirtyChange={vi.fn()} onSave={onSave} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add game' }));
    fireEvent.change(screen.getByLabelText('Game type'), { target: { value: 'match-play' } });
    expect(screen.getByRole('region', { name: 'Match Play setup' })).toBeVisible();
    expect(screen.getByText('One match and stake over the saved 9- or 18-hole playing circuit. Ties push; no carry.')).toBeVisible();
    expect(screen.queryByLabelText('Front stake per side · USD $')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Back stake per side · USD $')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Playing group'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Side A golfer 1'), { target: { value: f.cards[0]?.playerId } });
    fireEvent.change(screen.getByLabelText('Side B golfer 1'), { target: { value: f.cards[1]?.playerId } });
    fireEvent.change(screen.getByLabelText('Match stake per side · USD $'), { target: { value: '1.01' } });
    fireEvent.click(screen.getByLabelText('Automatic two-down presses'));
    fireEvent.click(screen.getByRole('button', { name: 'Save game' }));
    await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1); });
    expect(onSave.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ kind: 'match-play', name: 'Match Play', version: 1,
      variant: 'singles', automaticPresses: true, stakes: { currency: 'USD', frontMinor: 0, backMinor: 0, overallMinor: 101 } })]);
  });

  it('requires explicit Match Play capability and keeps existing match identities fixed', () => {
    const { round, nassau } = fixture();
    const game: MatchPlayGameDefinition = { ...nassau, kind: 'match-play', name: 'Fictional Match Play',
      stakes: { ...nassau.stakes, frontMinor: 0, backMinor: 0 } };
    const props = { round, busy: false, onDirtyChange: vi.fn(), onSave: vi.fn().mockResolvedValue(null), onRefresh: vi.fn() };
    const view = render(<RoundGamesPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add game' }));
    expect(screen.getByRole('option', { name: 'Match Play · With presses' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing' }));
    view.rerender(<RoundGamesPanel {...props} round={{ ...round, supportedGameKinds: ['match-play'],
      games: { configuration: { eventId: round.eventId, roundId: round.roundId, etag: 'match-v1', games: [game] }, results: [] } }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Fictional Match Play' }));
    expect(screen.getByLabelText('Game type')).toBeDisabled();
    expect(screen.getByLabelText('Match stake per side · USD $')).toHaveValue('0.00');
    expect(buildGame({ ...draftFromGame(game), nassauStakes: ['1', '0', '1'] }, round.cards.map((card) => card.playerId))).toBeNull();
  });

  it('renders Match Play as a matchboard and scorecard positions, never ranked points or scorecard money', () => {
    const { round, nassau, wolf, f } = fixture();
    const game: MatchPlayGameDefinition = { ...nassau, kind: 'match-play', name: 'Fictional Match Play',
      stakes: { ...nassau.stakes, frontMinor: 0, backMinor: 0 } };
    const result: RoundGameResult = { gameId: game.id, kind: game.kind, version: 1, players: [],
      nassau: calculateNassau(game, f.snapshot, f.cards) };
    const updated = { ...round, games: { configuration: { eventId: round.eventId, roundId: round.roundId,
      etag: 'match-v1', games: [game, wolf] }, results: [result] } };
    const view = render(<RoundLeaderboard round={updated} busy={false} onManageGames={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Fictional Match Play matchboard' })).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Standings' })).not.toBeInTheDocument();
    view.rerender(<SavedScorecards round={updated} groupNumber={1} busy={false} onGroupChange={vi.fn()} onEnterScores={vi.fn()} />);
    expect(within(screen.getByLabelText('Game')).getByRole('option', { name: /Match Play/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Fictional Match Play match positions' })).toBeVisible();
    expect(screen.queryByRole('row', { name: /Match Play points/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Planned net settlement · USD')).not.toBeInTheDocument();
  });

  it('retains explicit Wolf order, capability checks, peer definitions and stable save identity on unconfirmed retries', async () => {
    const { round, wolf, nassau } = fixture();
    const onSave = vi.fn().mockResolvedValue(null), onDirtyChange = vi.fn();
    render(<RoundGamesPanel round={round} busy={false} onDirtyChange={onDirtyChange} onSave={onSave} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Fictional Wolf' }));
    fireEvent.change(screen.getByLabelText('Wolf P1'), { target: { value: wolf.playerIds[1] } });
    fireEvent.click(screen.getByLabelText('Allow PIG'));
    fireEvent.click(screen.getByRole('button', { name: 'Save game' }));
    await screen.findByText('Save is not confirmed. Your draft is retained; retry when other work finishes.');
    expect(onSave.mock.calls[0]?.[0]).toEqual([nassau, { ...wolf, allowPig: false,
      playerIds: [wolf.playerIds[1], wolf.playerIds[0], ...wolf.playerIds.slice(2)] }]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(2); });
    expect(onSave.mock.calls[1]).toEqual(onSave.mock.calls[0]);
    expect(onDirtyChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByLabelText('Wolf P1')).toHaveValue(wolf.playerIds[1]);
  });

  it('builds exact Nassau/Wolf definitions, rejects incomplete stakes/duplicate sides and resets variant assignments', () => {
    const { f, nassau, wolf } = fixture();
    const ids = f.cards.map((card) => card.playerId);
    expect(buildGame(draftFromGame(nassau), ids)).toEqual(nassau);
    expect(buildGame(draftFromGame(wolf), ids)).toEqual(wolf);
    expect(buildGame({ ...draftFromGame(nassau), nassauStakes: ['', '0', '0'] }, ids)).toBeNull();
    expect(buildGame({ ...draftFromGame(nassau), nassauStakes: ['0.001', '0', '0'] }, ids)).toBeNull();
    expect(buildGame({ ...draftFromGame(nassau), nassauStakes: ['.50', '1.25', '0'] }, ids)).toMatchObject({
      stakes: { currency: 'USD', frontMinor: 50, backMinor: 125, overallMinor: 0 },
    });
    expect(buildGame({ ...draftFromGame(nassau), nassauSides: nassau.sides.map((side) => ({ ...side, playerIds: ids.slice(0, 2) })) }, ids)).toBeNull();
    expect(setNassauVariant(draftFromGame(nassau), 'three-way').nassauSides?.map((side) => side.playerIds)).toEqual([[''], [''], ['']]);
    expect(setGameKind(newGameDraft(), 'wolf', 4)).toMatchObject({ name: 'Wolf', wolfPlayers: [], allowPig: false });
  });

  it('configures Nassau participants and explicit zero money through the same shared editor used by Quick rounds', () => {
    const { f, round } = fixture();
    const save = vi.fn<(game: RoundGameDefinition | null) => void>();
    function Editor() {
      const [draft, setDraft] = useState(newGameDraft());
      return <GameSettings draft={draft} roster={f.cards} groups={round.groups} supportedGameKinds={round.supportedGameKinds}
        disabled={false} saveDisabled={false} cancelDisabled={false} retry={false} onChange={setDraft}
        onSave={() => { save(buildGame(draft, f.cards.map((card) => card.playerId))); }} onCancel={vi.fn()} />;
    }
    render(<Editor />);
    fireEvent.change(screen.getByLabelText('Game type'), { target: { value: 'nassau' } });
    expect(screen.queryByLabelText('Points preset')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Game format')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Handicap allowance (%)')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Playing group'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Side A golfer 1'), { target: { value: f.cards[0]?.playerId } });
    fireEvent.change(screen.getByLabelText('Side B golfer 1'), { target: { value: f.cards[1]?.playerId } });
    fireEvent.click(screen.getByRole('button', { name: 'No planned money' }));
    fireEvent.click(screen.getByLabelText('Automatic two-down presses'));
    fireEvent.click(screen.getByRole('button', { name: 'Save game' }));
    expect(save.mock.calls[0]?.[0]).toMatchObject({ kind: 'nassau', groupNumber: 1, automaticPresses: true,
      stakes: { currency: 'USD', frontMinor: 0, backMinor: 0, overallMinor: 0 } });
  });

  it('fails closed without explicit new-game capabilities and locks saved Nassau/Wolf without blocking peer edits', () => {
    const { round, f } = fixture();
    if (!round.games) throw new Error('Missing fictional games');
    const props = { round, busy: false, onDirtyChange: vi.fn(), onSave: vi.fn().mockResolvedValue(null), onRefresh: vi.fn().mockResolvedValue(round) };
    const view = render(<RoundGamesPanel {...props} round={{ ...round, supportedGameKinds: ['stableford'] }} />);
    expect(screen.getByRole('button', { name: 'Edit Fictional Wolf' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit Fictional Nassau' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Add game' }));
    expect(screen.getByRole('option', { name: 'Stroke Play' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Wolf / PIG · Earned dots' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Nassau · Match play' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing' }));
    view.rerender(<RoundGamesPanel {...props} round={{ ...round, setupLocked: true,
      games: { configuration: { ...round.games.configuration, games: [...round.games.configuration.games, f.skins] }, results: [] },
      supportedGameKinds: ['wolf', 'nassau', 'skins'] }} />);
    expect(screen.getByRole('button', { name: 'Edit Fictional Wolf' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit Fictional Nassau' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit Fictional Skins' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Fictional Skins' }));
    expect(screen.getByLabelText('Game name')).toBeEnabled();
  });

  it('renders the Nassau matchboard with no invented rank and excludes Nassau from individual scorecard metrics', () => {
    const { round } = fixture();
    const view = render(<RoundLeaderboard round={round} busy={false} onManageGames={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Fictional Nassau matchboard' })).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Standings' })).not.toBeInTheDocument();
    expect(screen.getByText('Fictional Red vs Fictional Blue')).toBeVisible();
    view.rerender(<SavedScorecards round={round} groupNumber={1} busy={false} onGroupChange={vi.fn()} onEnterScores={vi.fn()} />);
    expect(within(screen.getByLabelText('Game')).queryByRole('option', { name: /Nassau/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Nassau match bets and presses are in Games/)).toBeVisible();
    expect(screen.getByLabelText('Game')).toHaveValue(strokeGameId(950));
    expect(screen.getAllByText('DOT BALANCE')).toHaveLength(8);
    expect(screen.queryByText('Earned dots')).not.toBeInTheDocument();
  });

  it('stages Wolf edits on canonical saved input without mutating other game drafts or issuing a write', () => {
    const { wolf, round } = fixture();
    const sibling = { number: 1, choice: { gameId: strokeGameId(990), gameEtag: 'other', mode: 'blind' as const } };
    const onWolfChange = vi.fn(), onNassauChange = vi.fn();
    render(<RoundGameHoleControls round={round} groupNumber={1} holeNumber={1} saved={{ kind: 'unplayed' }}
      draft={{ wolf: [sibling] }} disabled={false} onWolfChange={onWolfChange} onNassauChange={onNassauChange} />);
    expect(screen.getByText('Wolf: Fictional golfer 4 · Tees last')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Wolf declaration'), { target: { value: 'pig' } });
    expect(onWolfChange).toHaveBeenCalledWith([sibling, { number: 1,
      choice: { gameId: wolf.id, gameEtag: 'fictional-game-v1', mode: 'pig' } }]);
    expect(onNassauChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument();
  });

  it('uses saved Wolf dot-balance projections for ties, known zero, awaiting and unavailable leaderboard rows', () => {
    const { round, wolf, f } = fixture();
    if (!round.games) throw new Error('Missing fictional games');
    const players = f.cards.map((card, index) => ({ playerId: card.playerId, displayName: card.displayName,
      playingHandicap: 0, status: index === 3 ? 'unavailable' as const : 'in-progress' as const,
      holes: [], holesScored: index === 2 ? 0 : 1, totalHoles: 18, frontPoints: index < 2 ? 0 : null,
      backPoints: null, totalPoints: index < 2 ? 0 : null }));
    const gameRound = { ...round, games: { configuration: { ...round.games.configuration, games: [wolf] },
      results: [{ gameId: wolf.id, kind: 'wolf' as const, players }] } };
    render(<RoundLeaderboard round={gameRound} busy={false} onManageGames={vi.fn()} />);
    expect(screen.getAllByLabelText('Tied position 1')).toHaveLength(2);
    expect(screen.getAllByLabelText('0 dot balance')).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'Awaiting scores' })).toHaveTextContent('Fictional golfer 3');
    expect(screen.getByRole('region', { name: 'Unavailable results' })).toHaveTextContent('Fictional golfer 4');
  });
});
