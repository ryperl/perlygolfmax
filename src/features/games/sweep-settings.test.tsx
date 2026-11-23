import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DotsGameDefinition } from '../../domain/dots';
import type { WolfGameDefinition } from '../../domain/wolf';
import type { RoundScores } from '../../domain/scoring';
import { matchGamesFixture } from '../../domain/match-games.test-support';
import { strokeGameId } from '../../domain/stroke-games.test-support';
import { DotsSettings } from '../dots';
import { buildGame, draftFromGame } from './game-draft';
import type { GameDraft } from './game-draft';
import { GameSettings } from './GameSettings';
import { RoundGamesPanel } from './RoundGamesPanel';

function fixture() {
  const f = matchGamesFixture();
  const wolf: WolfGameDefinition = { ...f.wolf, version: 2, stakeMinor: null };
  const legacy: DotsGameDefinition = { id: strokeGameId(979), name: 'Fictional legacy Dots', kind: 'dots', version: 1,
    groupNumber: 1, playerIds: f.ids, mode: 'linked', linkedGameId: wolf.id, specials: [{ kind: 'sweep', units: 2 }] };
  const manual: DotsGameDefinition = { id: legacy.id, name: 'Fictional manual Dots', kind: 'dots', version: 1,
    groupNumber: 1, playerIds: f.ids, mode: 'individual', stakeMinor: null, specials: legacy.specials, sweepRule: 'manual-v1' };
  return { ...f, wolf, legacy, manual };
}

describe('independent Sweep setup and manual entry', () => {
  it('round-trips old and new Sweep rules without converting legacy games or leaking flags when a selection is cleared', () => {
    const f = fixture();
    expect(buildGame(draftFromGame(f.legacy), f.ids)).toEqual(f.legacy);
    expect(buildGame(draftFromGame(f.manual), f.ids)).toEqual(f.manual);
    const cleared = buildGame({ ...draftFromGame(f.manual), dotsSpecials: [] }, f.ids);
    expect(cleared).not.toHaveProperty('sweepRule');
    const wolf = { ...f.wolf, highLowSweep: true as const };
    expect(buildGame(draftFromGame(wolf), f.ids)).toEqual(wolf);
    expect(buildGame(draftFromGame(f.wolf), f.ids)).toEqual(f.wolf);
    expect(buildGame({ ...draftFromGame(f.wolf), wolfVersion: 1, wolfHighLowSweep: true }, f.ids)).toBeNull();
  });

  it('requires an explicit before-scoring choice to turn a saved linked automatic Sweep into a manual dot', () => {
    const f = fixture(), changed = vi.fn<(patch: Partial<GameDraft>) => void>();
    function Editor() {
      const [draft, setDraft] = useState<GameDraft>(draftFromGame(f.legacy));
      return <DotsSettings draft={draft} groups={f.snapshot.groups} players={f.cards} wolves={[f.wolf]}
        manualSweepSupported onChange={(patch) => { setDraft((value) => ({ ...value, ...patch })); changed(patch); }} />;
    }
    render(<Editor />);
    expect(screen.getByLabelText('Sweep · Automatic')).toBeChecked();
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use manual Sweep' }));
    expect(changed).toHaveBeenLastCalledWith({ dotsSweepRule: 'manual-v1', dotsLegacySweep: false });
    expect(screen.getByLabelText('Manual Sweep')).toBeChecked();
    expect(screen.getByLabelText('Manual Sweep units')).toHaveValue(2);
    expect(screen.queryByLabelText('Sweep · Automatic')).not.toBeInTheDocument();
  });

  it('makes the common preset select manual Sweep for a new individual game with API support', () => {
    const f = fixture(), changed = vi.fn<(patch: Partial<GameDraft>) => void>();
    render(<DotsSettings draft={{ ...draftFromGame(f.manual), dotsSpecials: [] }} groups={f.snapshot.groups}
      players={f.cards} wolves={[]} manualSweepSupported onChange={changed} />);
    fireEvent.change(screen.getByLabelText('Specials preset'), { target: { value: 'built-in:dots-common' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply preset' }));
    expect(changed.mock.lastCall?.[0]).toMatchObject({ dotsSweepRule: 'manual-v1' });
    expect(changed.mock.lastCall?.[0].dotsSpecials).toContainEqual({ kind: 'sweep', units: 1 });
    expect(changed.mock.lastCall?.[0].dotsSpecials?.some((special) => special.kind === 'assassin')).toBe(false);
  });

  it('keeps a manual Sweep draft but refuses publication if the capability disappears', () => {
    const f = fixture();
    const cards = f.cards.map((card) => ({ ...card, etag: null, updatedAt: null,
      holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'unplayed' as const } })) }));
    const round: RoundScores = { ...f.round(cards, [f.manual]), dotsManualSweep: true, sweepRulesVersion: 2,
      permissions: { role: 'owner', canManageGames: true, writePlayerIds: f.ids } };
    const props = { busy: false, onDirtyChange: vi.fn(), onSave: vi.fn(), onRefresh: vi.fn() };
    const view = render(<RoundGamesPanel {...props} round={round} />);
    fireEvent.click(screen.getByRole('button', { name: `Edit ${f.manual.name}` }));
    fireEvent.change(screen.getByLabelText('Game name'), { target: { value: 'Fictional retained name' } });
    const { dotsManualSweep: omitted, ...older } = round;
    void omitted;
    view.rerender(<RoundGamesPanel {...props} round={older} />);
    expect(screen.getByLabelText('Game name')).toHaveValue('Fictional retained name');
    expect(screen.getByRole('button', { name: 'Save game' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Game settings' }));
    expect(props.onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Manual Sweep is temporarily unavailable in this app version. Your draft is retained/)).toBeVisible();
  });

  it('defaults Wolf High/Low Sweep off and does not enable duplicate legacy linked awards', () => {
    const f = fixture(), changed = vi.fn<(draft: GameDraft) => void>();
    const props = { draft: draftFromGame(f.wolf), groups: f.snapshot.groups, roster: f.cards, games: [f.wolf, f.legacy],
      disabled: false, saveDisabled: false, cancelDisabled: false, retry: false, wolfV2Supported: true,
      wolfHighLowSweepSupported: true, onChange: changed, onSave: vi.fn(), onCancel: vi.fn() };
    const view = render(<GameSettings {...props} />);
    const sweep = screen.getByLabelText('High/Low Sweep · +1 dot per winning teammate');
    expect(sweep).not.toBeChecked();
    expect(sweep).toBeDisabled();
    view.rerender(<GameSettings {...props} games={[f.wolf, f.manual]} />);
    expect(sweep).toBeEnabled();
    fireEvent.click(sweep);
    expect(changed.mock.lastCall?.[0].wolfHighLowSweep).toBe(true);
    expect(changed.mock.lastCall?.[0].wolfPlayers).toEqual(f.wolf.playerIds);
  });

});
