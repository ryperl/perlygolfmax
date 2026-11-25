import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { RoundGameDefinition, RoundGameKind } from '../../domain/games';
import { roundGameKinds } from '../../domain/games';
import { strokeGameFixture } from '../../domain/stroke-games.test-support';
import { GameSettings } from './GameSettings';
import { buildGame, defaultGameGroup, draftFromGame, newGameDraft, setGameKind } from './game-draft';
import { gameScoringLabel } from './game-presentation';

/** Nines needs a saved group of exactly three; every other game here uses a foursome. */
function fixture(kind: RoundGameKind = 'stableford') {
  const f = strokeGameFixture(18, kind === 'nines' ? 3 : 4);
  return { ...f, groups: f.snapshot.groups.map((group) => ({ ...group, startingHole: 10 })) };
}

function Harness({ kind = 'stableford', game, supported = true, locked = false, save = vi.fn() }: {
  readonly kind?: RoundGameKind;
  readonly game?: RoundGameDefinition;
  readonly supported?: boolean;
  readonly locked?: boolean;
  readonly save?: (game: RoundGameDefinition | null) => void;
}) {
  const f = fixture(game?.kind ?? kind);
  const [draft, change] = useState(() => game ? draftFromGame(game)
    : defaultGameGroup(setGameKind(newGameDraft(supported), kind, f.cards.length), f.groups));
  return <GameSettings draft={draft} roster={f.cards} groups={f.groups}
    holeNumbers={f.snapshot.teeProfile.holes.map((hole) => hole.number)} supportedGameKinds={roundGameKinds}
    gameHandicapsSupported={supported} churchyEnabled churchyV3Supported churchyCustomNamesSupported
    wolfV2Supported dotsV2Supported dotsIndividualPlayerCounts={[1, 2, 3, 4]}
    setupLocked={locked} disabled={false} saveDisabled={false} cancelDisabled={false} retry={false}
    existing={game !== undefined} onChange={change} onSave={() => { save(buildGame(draft, f.cards.map((card) => card.playerId))); }}
    onCancel={vi.fn()} />;
}

describe('explicit game handicap and shared-start setup', () => {
  it.each(roundGameKinds)('shows the saved shared start for %s without granting setup writes', (kind) => {
    render(<Harness kind={kind} />);
    expect(screen.getByRole('region', { name: 'Shared starting holes' })).toHaveTextContent('Group 1 starts at hole 10.');
    expect(screen.getByRole('region', { name: 'Shared starting holes' })).toHaveTextContent('Shared by every game');
    expect(screen.queryByLabelText('Group 1 starting hole')).not.toBeInTheDocument();
    if (kind === 'dots') {
      expect(screen.queryByLabelText('Net handicap rule')).not.toBeInTheDocument();
      expect(screen.getByText(/No net ball comparison in standalone Dots/)).toHaveTextContent('personal gross');
    } else {
      if (screen.queryByLabelText('Score basis') && screen.getByLabelText('Score basis').getAttribute('disabled') === null) {
        fireEvent.change(screen.getByLabelText('Score basis'), { target: { value: 'net' } });
      }
      expect(screen.getByLabelText('Net handicap rule')).toHaveValue('full-course-v1');
    }
    if (kind === 'nassau') expect(screen.getByLabelText('Starting-hole order')).toHaveValue('shared-group-v1');
  });

  it('uses SO only after an explicit choice, hides allowance without deleting its draft and saves an exact marker', () => {
    const save = vi.fn();
    render(<Harness save={save} />);
    fireEvent.change(screen.getByLabelText('Score basis'), { target: { value: 'net' } });
    expect(screen.getByLabelText('Handicap allowance (%)')).toHaveValue('95');
    fireEvent.change(screen.getByLabelText('Handicap allowance (%)'), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText('Net handicap rule'), { target: { value: 'group-low-v1' } });
    expect(screen.queryByLabelText('Handicap allowance (%)')).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByRole('form', { name: 'Game settings' }));
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ handicapRule: 'group-low-v1', handicapAllowancePercent: 80 }));
    fireEvent.change(screen.getByLabelText('Net handicap rule'), { target: { value: 'full-course-v1' } });
    expect(screen.getByLabelText('Handicap allowance (%)')).toHaveValue('80');
  });

  it('preserves unmarked saved rules until explicit adoption and disables changes on old APIs or scored rounds', () => {
    const f = fixture(), save = vi.fn();
    const props = { game: { ...f.ballDrop }, save };
    const view = render(<Harness {...props} supported={false} />);
    expect(screen.getByLabelText('Net handicap rule')).toHaveValue('legacy');
    expect(screen.getByLabelText('Net handicap rule')).toBeDisabled();
    view.rerender(<Harness {...props} supported />);
    expect(screen.getByLabelText('Net handicap rule')).toHaveValue('legacy');
    fireEvent.submit(screen.getByRole('form', { name: 'Game settings' }));
    expect(save.mock.calls[0]?.[0]).not.toHaveProperty('handicapRule');
    fireEvent.change(screen.getByLabelText('Net handicap rule'), { target: { value: 'group-low-v1' } });
    view.rerender(<Harness {...props} supported locked />);
    expect(screen.getByLabelText('Net handicap rule')).toHaveValue('group-low-v1');
    expect(screen.getByLabelText('Net handicap rule')).toBeDisabled();
    expect(screen.getByRole('region', { name: 'Shared starting holes' })).toHaveTextContent('Locked by saved scoring');
  });

  it('requires explicit shared-circuit adoption for legacy carryovers and shows the one-foursome scope', () => {
    const f = fixture(), save = vi.fn();
    render(<Harness game={f.skins} save={save} />);
    expect(screen.getByLabelText('Skins carry order')).toHaveValue('legacy');
    fireEvent.change(screen.getByLabelText('Skins carry order'), { target: { value: 'shared-group-v1' } });
    expect(screen.getByText(/New or changed carryovers/)).toHaveTextContent('exactly one saved foursome');
    fireEvent.submit(screen.getByRole('form', { name: 'Game settings' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ carryovers: true, carryOrder: 'shared-group-v1' }));
  });

  it('labels selected SO rather than full handicap or a configured Stableford allowance', () => {
    const f = fixture();
    expect(gameScoringLabel({ ...f.ballDrop, handicapRule: 'group-low-v1' })).toContain('SO off lowest in saved group');
    const game = buildGame({ ...newGameDraft(true), basis: 'net', handicapRule: 'group-low-v1' });
    if (!game) throw new Error('Missing fictional Stableford');
    expect(gameScoringLabel(game)).toContain('SO off lowest in saved group');
    expect(gameScoringLabel(game)).not.toContain('95%');
  });
});
