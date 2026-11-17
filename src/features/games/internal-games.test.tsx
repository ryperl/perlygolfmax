import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { WolfGameDefinition } from '../../domain/wolf';
import { strokeGameId } from '../../domain/stroke-games.test-support';
import { calculateDotSettlement } from '../../domain/dot-settlement';
import type { DotsGameDefinition } from '../../domain/dots';
import { dotsFixture } from '../dots/dots.test-support';
import { buildGame, draftFromGame, newGameDraft, setGameKind } from './game-draft';
import { canManageGame, canManageRoundGames } from './game-permissions';
import { GameSettings } from './GameSettings';
import { RoundGamesPanel } from './RoundGamesPanel';
import { RoundGameHoleControls } from './RoundGameHoleControls';

describe('separate internal game setup and capability boundaries', () => {
  it('uses each personal hole par for Gorilla but the default par for category contests', () => {
    const f = dotsFixture();
    if (!f.round.games) throw new Error('Missing fictional games');
    const playerId = f.ids[0] ?? '';
    const game: DotsGameDefinition = { ...f.game, specials: [
      { kind: 'gorilla', units: 1 }, { kind: 'blue-plate', units: 1 }, { kind: 'long-drive', units: 1 },
    ] };
    const round = { ...f.round, games: { ...f.round.games, configuration: { ...f.round.games.configuration, games: [game] } },
      playerTees: [{ playerId, profile: { ...f.f.snapshot.teeProfile,
        holes: f.round.layout.map((hole) => ({ ...hole, par: 5 })) } }] };
    const props = { round, groupNumber: 1, holeNumber: 1, saved: { kind: 'unplayed' as const }, disabled: false,
      onNassauChange: vi.fn(), onWolfChange: vi.fn(), onSpecialDotsChange: vi.fn() };
    const view = render(<RoundGameHoleControls {...props} />);
    expect(screen.getByLabelText('Gorilla count · Fictional golfer 1')).toBeInTheDocument();
    expect(screen.queryByLabelText('Gorilla count · Fictional golfer 2')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Blue Plate result')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Long Drive result')).not.toBeInTheDocument();
    view.rerender(<RoundGameHoleControls {...props} round={{ ...round,
      layout: round.layout.map((hole) => ({ ...hole, par: 5 })),
      playerTees: [{ playerId, profile: { ...f.f.snapshot.teeProfile,
        holes: f.round.layout.map((hole) => ({ ...hole, par: 4 })) } }] }} />);
    expect(screen.queryByLabelText('Gorilla count · Fictional golfer 1')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Gorilla count · Fictional golfer 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Blue Plate result')).toBeInTheDocument();
    expect(screen.getByLabelText('Long Drive result')).toBeInTheDocument();
  });

  it('names independent settlements by owning game instead of showing ambiguous group-only duplicate charges', () => {
    const f = dotsFixture();
    if (!f.round.games) throw new Error('Missing fictional games');
    const wolf: WolfGameDefinition = { id: strokeGameId(981), name: 'Fictional earned Wolf', kind: 'wolf', version: 2,
      basis: 'gross', playerIds: f.ids, groupNumber: 1, allowPig: true, stakeMinor: 50 };
    const settlements = [wolf, f.game].map((game) => calculateDotSettlement({ groupNumber: 1, gameIds: [game.id],
      stakeMinor: 50, complete: false, players: f.round.cards.map((card) => ({
        playerId: card.playerId, displayName: card.displayName, baseDots: 0, specialDots: 0,
      })) }));
    render(<RoundGamesPanel round={{ ...f.round, internalSettlements: settlements,
      games: { ...f.round.games, configuration: { ...f.round.games.configuration, games: [wolf, f.game] } } }}
      busy={false} onDirtyChange={vi.fn()} onSave={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Group 1 Fictional earned Wolf internal settlement' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Group 1 Fictional specials internal settlement' })).toBeVisible();
    expect(screen.getAllByText('Independent game settlement; other unlinked games settle separately.')).toHaveLength(2);
    expect(screen.queryByText(wolf.id)).not.toBeInTheDocument();
    expect(screen.queryByText(f.game.id)).not.toBeInTheDocument();
  });

  it('round-trips Dots modes and rates, rejecting invalid money rather than silently switching to points-only', () => {
    const { game, ids } = dotsFixture();
    expect(buildGame(draftFromGame(game), ids)).toEqual(game);
    for (const [stake, stakeMinor] of [['', null], ['0', 0], ['.50', 50], ['1.25', 125]] as const) {
      expect(buildGame({ ...draftFromGame(game), stake }, ids)).toMatchObject({ stakeMinor });
    }
    for (const stake of ['no', '-1', '1.001', '$1']) expect(buildGame({ ...draftFromGame(game), stake }, ids)).toBeNull();
    const fixed = { ...game, mode: 'fixed' as const, partnerIds: [...ids].reverse() };
    expect(buildGame(draftFromGame(fixed), ids)).toEqual(fixed);
    const linked = { id: game.id, name: game.name, kind: 'dots' as const, version: 1 as const, playerIds: ids,
      groupNumber: 1, mode: 'linked' as const, linkedGameId: strokeGameId(981), specials: game.specials };
    expect(buildGame(draftFromGame(linked), ids)).toEqual(linked);
  });

  it('defaults new Wolf to earned version 2 without converting saved legacy games', () => {
    const { ids } = dotsFixture();
    const draft = { ...setGameKind(newGameDraft(), 'wolf', 4), groupNumber: 1, wolfPlayers: ids, stake: '.50' };
    expect(buildGame(draft, ids)).toMatchObject({ version: 2, stakeMinor: 50 });
    const legacy: WolfGameDefinition = { id: draft.id, name: 'Fictional legacy', kind: 'wolf', version: 1,
      basis: 'gross', playerIds: ids, groupNumber: 1, allowPig: false };
    expect(buildGame(draftFromGame(legacy), ids)).toEqual(legacy);
    expect(buildGame({ ...draft, stake: 'invalid' }, ids)).toBeNull();
  });

  it('uses dollars for Churchy setup without changing saved minor-unit semantics', () => {
    const { ids } = dotsFixture();
    const draft = { ...setGameKind(newGameDraft(), 'churchy', 4), churchyGroup: 1, churchyPlayers: ids, amountPerDotMinor: '.50' };
    const game = buildGame(draft, ids);
    expect(game).toMatchObject({ amountPerDotMinor: 50 });
    if (!game) throw new Error('Missing fictional game');
    expect(draftFromGame(game).amountPerDotMinor).toBe('0.50');
    expect(buildGame({ ...draft, amountPerDotMinor: '0.001' }, ids)).toBeNull();
  });

  it('provides standalone and linked configuration, automatic-unit selection and no duplicate linked rate', () => {
    const { game, round, ids } = dotsFixture();
    const wolf: WolfGameDefinition = { id: strokeGameId(981), name: 'Fictional earned Wolf', kind: 'wolf', version: 2,
      basis: 'gross', playerIds: ids, groupNumber: 1, allowPig: false, stakeMinor: 50 };
    function Editor() {
      const [draft, setDraft] = useState(draftFromGame(game));
      return <GameSettings draft={draft} groups={round.groups} roster={round.cards} games={[wolf]}
        disabled={false} saveDisabled={false} cancelDisabled={false} retry={false} onChange={setDraft}
        onSave={vi.fn()} onCancel={vi.fn()} supportedGameKinds={round.supportedGameKinds} wolfV2Supported />;
    }
    render(<Editor />);
    expect(screen.getByLabelText('USD per dot difference')).toHaveValue('1.00');
    expect(screen.queryByLabelText('Game format')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Score basis')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Handicap allowance (%)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Eagle · Automatic'));
    expect(screen.getByLabelText('Eagle units')).toHaveValue(5);
    fireEvent.change(screen.getByLabelText('Dots mode'), { target: { value: 'linked' } });
    fireEvent.change(screen.getByLabelText('Linked game'), { target: { value: wolf.id } });
    expect(screen.queryByLabelText('USD per dot difference')).not.toBeInTheDocument();
    expect(screen.getByText(/Shared rate: USD\s+0.50 per dot difference/)).toBeVisible();
    expect(screen.queryByLabelText(/Thief/)).not.toBeInTheDocument();
  });

  it('grants ordinary public only explicit prescoring internal editing and preserves protected peers on retry', async () => {
    const { round, game, f } = dotsFixture();
    if (!round.games) throw new Error('Missing fictional configuration');
    const publicRound = { ...round, permissions: { role: 'public' as const, writePlayerIds: game.playerIds,
      canManageGames: false, canManageInternalGames: true }, games: {
      ...round.games, configuration: { ...round.games.configuration, games: [f.skins, game] },
    } };
    expect(canManageRoundGames(publicRound)).toBe(true);
    expect(canManageGame(publicRound, f.skins)).toBe(false);
    expect(canManageRoundGames({ ...publicRound, internalGamesSupported: false })).toBe(false);
    expect(canManageRoundGames({ ...publicRound, setupLocked: true })).toBe(false);
    const onSave = vi.fn().mockResolvedValue(null);
    render(<RoundGamesPanel round={publicRound} busy={false} onDirtyChange={vi.fn()} onSave={onSave} onRefresh={vi.fn()} />);
    expect(screen.queryByRole('button', { name: `Edit ${f.skins.name}` })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `Edit ${game.name}` }));
    expect(screen.getByLabelText('Game type')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('USD per dot difference'), { target: { value: '.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save game' }));
    await screen.findByText(/Save is not confirmed/);
    expect(onSave.mock.calls[0]?.[0]).toEqual([f.skins, { ...game, stakeMinor: 50 }]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(2); });
    expect(onSave.mock.calls[1]).toEqual(onSave.mock.calls[0]);
  });

  it('uses authoritative V2 Wolf selection, not the legacy rotation, and fails closed on missing V2 support', () => {
    const { round, ids } = dotsFixture();
    if (!round.games) throw new Error('Missing fictional configuration');
    const wolf: WolfGameDefinition = { id: strokeGameId(981), name: 'Fictional earned Wolf', kind: 'wolf', version: 2,
      basis: 'gross', playerIds: ids, groupNumber: 1, allowPig: true, stakeMinor: null };
    const selected = ids[2] ?? '';
    const changed = { ...round, games: { ...round.games, configuration: { ...round.games.configuration, games: [wolf] },
      results: [{ gameId: wolf.id, kind: 'wolf' as const, players: [], wolf: { status: 'in-progress' as const, rulesVersion: 2 as const,
        players: [], holes: [{ number: 1, wolfId: selected, mode: null, wolfSide: [], opponents: [], status: 'pending' as const,
          source: 'scores' as const, winner: null, wolfScore: null, opponentScore: null, stake: null, transfers: [] }] } }] } };
    const props = { round: changed, groupNumber: 1, holeNumber: 1, saved: { kind: 'unplayed' as const },
      disabled: false, onNassauChange: vi.fn(), onWolfChange: vi.fn() };
    const view = render(<RoundGameHoleControls {...props} />);
    expect(screen.getByText(`Wolf: ${round.cards.find((card) => card.playerId === selected)?.displayName ?? ''} · Wolf tees last. Timing is honor-system.`)).toBeVisible();
    expect(screen.queryByLabelText('Wolf match outcome')).not.toBeInTheDocument();
    expect(canManageGame({ ...changed, wolfRulesVersions: [1] }, wolf)).toBe(false);
    view.rerender(<RoundGameHoleControls {...props} round={{ ...changed, wolfRulesVersions: [1] }} />);
    expect(screen.getByLabelText('Wolf declaration')).toBeDisabled();
  });
});
