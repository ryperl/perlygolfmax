import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { NassauGameDefinition, NassauHoleRecord } from '../../domain/nassau';
import { calculateNassau } from '../../domain/nassau';
import { strokeGameFixture, strokeGameId } from '../../domain/stroke-games.test-support';
import { NassauHoleControls } from './NassauHoleControls';
import { NassauResults } from './NassauResults';

function fixture() {
  const f = strokeGameFixture(18);
  const game: NassauGameDefinition = { id: strokeGameId(950), name: 'Fictional Nassau', kind: 'nassau', version: 1,
    basis: 'gross', groupNumber: 1, variant: 'one-v-two', automaticPresses: false,
    sides: [{ id: strokeGameId(951), name: 'Fictional Red', playerIds: f.cards.slice(0, 1).map((card) => card.playerId) },
      { id: strokeGameId(952), name: 'Fictional Blue', playerIds: f.cards.slice(1, 3).map((card) => card.playerId) }],
    stakes: { currency: 'USD', frontMinor: 101, backMinor: 0, overallMinor: 100 } };
  const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole,
    score: hole.number <= 3 ? { kind: 'strokes' as const, strokes: index === 0 ? 5 : 4 } : { kind: 'unplayed' as const } })) }));
  const result = calculateNassau(game, f.snapshot, cards);
  return { f, game, cards, result };
}

describe('Nassau saved match UI', () => {
  it('stages only new next-hole presses, retains their identity across outcome edits/retry renders, and clears manual outcomes explicitly', () => {
    const { game, result } = fixture();
    const option = result.pressOptions[0];
    if (!option) throw new Error('Missing fictional press option');
    expect(option).toMatchObject({ startHole: 4, declaredAfterHole: 3 });
    const saved: NassauHoleRecord = { number: 4, gameId: game.id, gameEtag: 'old-revision',
      outcomes: [{ matchId: option.matchId, outcome: 'side-a' }],
      presses: [{ ...option, parentBetId: 'historical-bet', id: strokeGameId(980) }] };
    const onChange = vi.fn<(record: NassauHoleRecord) => void>();
    const props = { game, result, holeNumber: 4, etag: 'current-revision', saved, draft: undefined, disabled: false, onChange };
    const view = render(<NassauHoleControls {...props} />);
    const select = screen.getByLabelText('Fictional Red vs Fictional Blue · Hole 4');
    expect(select).toHaveValue('side-a');
    const button = screen.getAllByRole('button', { name: 'Stage manual press' })[0];
    if (!button) throw new Error('Missing fictional press action');
    fireEvent.click(button);
    const staged = onChange.mock.calls[0]?.[0];
    if (!staged) throw new Error('Missing fictional staged press');
    expect(staged.presses).toHaveLength(1);
    expect(staged.presses[0]).toMatchObject(option);
    expect(staged.presses[0]?.id).not.toBe(saved.presses[0]?.id);
    expect(staged.number).toBe(4);
    expect(staged.gameEtag).toBe('current-revision');
    view.rerender(<NassauHoleControls {...props} draft={staged} />);
    expect(screen.getByRole('button', { name: 'Press staged' })).toBeDisabled();
    fireEvent.change(select, { target: { value: 'scores' } });
    const cleared = onChange.mock.calls[1]?.[0];
    expect(cleared?.outcomes).toEqual([{ matchId: option.matchId, outcome: 'scores' }]);
    expect(cleared?.presses).toEqual(staged.presses);
    view.rerender(<NassauHoleControls {...props} draft={cleared} />);
    expect(screen.getByRole('button', { name: 'Press staged' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument();
  });

  it('offers no draft-calculated, wrong-hole or unavailable presses and leaves saved declarations read-only', () => {
    const { game, result } = fixture();
    const props = { game, result, holeNumber: 3, etag: 'current', saved: undefined, draft: undefined, disabled: false, onChange: vi.fn() };
    const view = render(<NassauHoleControls {...props} />);
    expect(screen.queryByRole('button', { name: 'Stage manual press' })).not.toBeInTheDocument();
    view.rerender(<NassauHoleControls {...props} result={undefined} holeNumber={4} />);
    expect(screen.getByText('Saved match results unavailable. Refresh before declaring a press.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Stage manual press' })).not.toBeInTheDocument();
  });

  it('shows independent match bets, nested lineage, exact cents and pending/stale settlement without exposing receipt identities', () => {
    const { f, game, cards, result } = fixture();
    const option = result.pressOptions[0];
    if (!option) throw new Error('Missing fictional press');
    const press = { ...option, id: strokeGameId(985) };
    const resultWithPress = calculateNassau(game, f.snapshot, cards, [
      { number: 4, gameId: game.id, gameEtag: 'internal-game-etag', outcomes: [], presses: [press] },
    ]);
    render(<NassauResults game={game} result={resultWithPress} players={cards} />);
    const board = screen.getByRole('region', { name: 'Fictional Nassau matchboard' });
    expect(within(board).getByText('Front', { exact: true })).toBeVisible();
    expect(within(board).getByText('Back', { exact: true })).toBeVisible();
    expect(within(board).getByText('Overall', { exact: true })).toBeVisible();
    expect(board).toHaveTextContent('Stake per side $1.01');
    expect(board).toHaveTextContent('Press of Front (holes 1–9)');
    expect(board).toHaveTextContent('Planned net settlement · USD');
    expect(within(screen.getByRole('region', { name: 'Nassau planned settlement' })).getAllByText('Pending', { exact: true })).toHaveLength(3);
    expect(board.querySelector('.nassau-bet details')).not.toHaveAttribute('open');
    expect(board).not.toHaveTextContent(press.id);
    expect(board).not.toHaveTextContent(press.proof);
    expect(board).not.toHaveTextContent('internal-game-etag');
    expect(board).not.toHaveTextContent('Standings');
  });
  it('distinguishes known-zero pushes from unavailable stale declarations without fabricating money', () => {
    const { f, game, result } = fixture();
    const view = render(<NassauResults game={game} result={calculateNassau(game, f.snapshot, f.cards)} players={f.cards} />);
    expect(screen.getAllByText(/Push/)).toHaveLength(3);
    expect(within(screen.getByRole('region', { name: 'Nassau planned settlement' })).getAllByText('$0.00', { exact: true })).toHaveLength(3);
    const option = result.pressOptions[0];
    if (!option) throw new Error('Missing fictional press');
    const stale = calculateNassau(game, f.snapshot, f.cards, [{
      number: 4, gameId: game.id, gameEtag: 'old', outcomes: [], presses: [{ ...option, id: strokeGameId(985) }],
    }]);
    view.rerender(<NassauResults game={game} result={stale} players={f.cards} />);
    expect(within(screen.getByRole('region', { name: 'Nassau planned settlement' })).getAllByText('Unavailable', { exact: true })).toHaveLength(3);
    expect(screen.getByText(/stale press declaration/)).toBeVisible();
  });
});
