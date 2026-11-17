import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WolfGameDefinition, WolfHoleRecord } from '../../domain/wolf';
import { calculateWolf } from '../../domain/wolf';
import { strokeGameFixture, strokeGameId } from '../../domain/stroke-games.test-support';
import { WolfHoleControls } from './WolfHoleControls';
import { WolfResults } from './WolfResults';

function fixture() {
  const f = strokeGameFixture();
  const game: WolfGameDefinition = { id: strokeGameId(950), name: 'Fictional Wolf', kind: 'wolf', version: 1,
    basis: 'gross', groupNumber: 1, playerIds: f.cards.map((card) => card.playerId), allowPig: true };
  const wolfId = game.playerIds[0] ?? '';
  return { f, game, wolfId };
}

describe('Wolf declarations and ledger', () => {
  it('records honor-system PIG/partner choices and explicit outcomes without independent saves', () => {
    const { f, game, wolfId } = fixture();
    const onChange = vi.fn<(record: WolfHoleRecord) => void>();
    const props = { game, wolfId, holeNumber: 1, etag: 'current', saved: undefined, draft: undefined,
      players: f.cards, disabled: false, onChange };
    const view = render(<WolfHoleControls {...props} />);
    expect(screen.getByLabelText('Wolf match outcome')).toBeDisabled();
    expect(screen.getByText(/before anyone tees off/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Wolf declaration'), { target: { value: 'pig' } });
    const staged = onChange.mock.calls[0]?.[0];
    expect(staged).toEqual({ number: 1, choice: { gameId: game.id, gameEtag: 'current', mode: 'pig' } });
    view.rerender(<WolfHoleControls {...props} draft={staged} />);
    fireEvent.change(screen.getByLabelText('Wolf match outcome'), { target: { value: 'halved' } });
    expect(onChange.mock.calls[1]?.[0]).toEqual({ ...staged, outcome: 'halved' });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('locks saved choices while allowing outcome correction, disables PIG when absent, and disables all edits while saving', () => {
    const { f, game, wolfId } = fixture();
    const saved: WolfHoleRecord = { number: 1, choice: { gameId: game.id, gameEtag: 'saved-etag', mode: 'partner',
      partnerId: game.playerIds[1] ?? '' }, outcome: 'wolf' };
    const onChange = vi.fn();
    const props = { game: { ...game, allowPig: false }, wolfId, holeNumber: 1, etag: 'current',
      saved, draft: undefined, players: f.cards, disabled: false, onChange };
    const view = render(<WolfHoleControls {...props} />);
    expect(screen.getByLabelText('Wolf declaration')).toBeDisabled();
    expect(screen.queryByRole('option', { name: /PIG/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Wolf match outcome')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Wolf match outcome'), { target: { value: 'scores' } });
    expect(onChange).toHaveBeenCalledWith({ ...saved, choice: { ...saved.choice, gameEtag: 'current' }, outcome: 'scores' });
    view.rerender(<WolfHoleControls {...props} disabled />);
    expect(screen.getByLabelText('Wolf match outcome')).toBeDisabled();
  });

  it('uses the current shared revision for late saved-decision outcomes without claiming tee-shot timing or erasing server metadata', () => {
    const { f, game, wolfId } = fixture();
    const saved: WolfHoleRecord = { number: 1, choice: { gameId: game.id, gameEtag: 'before-peer-game-change', mode: 'blind' },
      recordedLate: true };
    const onChange = vi.fn<(record: WolfHoleRecord) => void>();
    const props = { game, wolfId, holeNumber: 1, etag: 'after-peer-game-change', saved, draft: undefined,
      players: f.cards, disabled: false, onChange };
    const view = render(<WolfHoleControls {...props} />);
    expect(screen.getByLabelText('Wolf declaration')).toBeDisabled();
    expect(screen.getByText('Choice recorded after scores were saved. Tee-shot timing was not verified.')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Wolf match outcome'), { target: { value: 'halved' } });
    expect(onChange.mock.calls[0]?.[0]).toEqual({ number: 1, choice: { ...saved.choice, gameEtag: 'after-peer-game-change' }, outcome: 'halved' });
    view.rerender(<WolfHoleControls {...props} draft={onChange.mock.calls[0]?.[0]} />);
    expect(screen.getByText('Choice recorded after scores were saved. Tee-shot timing was not verified.')).toBeVisible();
    expect(screen.getByLabelText('Wolf declaration')).toHaveValue('blind');
    expect(saved.recordedLate).toBe(true);
  });

  it('shows authoritative won/lost/balance including zeros and negatives and saved hole winners, never dollars or earned dots', () => {
    const { f, game } = fixture();
    const records: readonly WolfHoleRecord[] = [{ number: 1, choice: { gameId: game.id, gameEtag: 'private-etag', mode: 'pig' }, outcome: 'wolf' }];
    const result = calculateWolf(game, { layout: f.snapshot.teeProfile.holes, groups: f.snapshot.groups,
      players: f.cards.map((card) => ({ playerId: card.playerId, displayName: card.displayName,
        layout: f.snapshot.teeProfile.holes, strokeAllocation: true, handicap: 0 })) }, f.cards, records);
    const view = render(<WolfResults game={game} result={result} />);
    expect(screen.getByRole('columnheader', { name: 'Won' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Lost' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Dot balance' })).toBeVisible();
    expect(screen.getAllByRole('cell', { name: '-3' })).toHaveLength(3);
    expect(screen.getAllByRole('cell', { name: '0' }).length).toBeGreaterThan(0);
    expect(view.container).toHaveTextContent('PIG');
    expect(view.container).toHaveTextContent('Fictional golfer 1 won');
    expect(view.container).not.toHaveTextContent('private-etag');
    expect(screen.queryByText('Earned dots')).not.toBeInTheDocument();
    expect(view.container).toHaveTextContent('No dollar settlement');
  });
});
