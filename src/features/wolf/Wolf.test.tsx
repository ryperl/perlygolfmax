import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WolfGameDefinition, WolfHoleRecord } from '../../domain/wolf';
import { calculateWolf } from '../../domain/wolf';
import { strokeGameFixture, strokeGameId } from '../../domain/stroke-games.test-support';
import { WolfHoleControls } from './WolfHoleControls';
import { WolfResults } from './WolfResults';
import { WolfSoloProgress } from './WolfSoloProgress';

function fixture() {
  const f = strokeGameFixture();
  const game: WolfGameDefinition = { id: strokeGameId(950), name: 'Fictional Wolf', kind: 'wolf', version: 1,
    basis: 'gross', groupNumber: 1, playerIds: f.cards.map((card) => card.playerId), allowPig: true };
  const wolfId = game.playerIds[0] ?? '';
  return { f, game, wolfId };
}

describe('Wolf declarations and ledger', () => {
  it('chooses a first-tee order before declaring, retains partial drafts and renders acknowledged order read-only', () => {
    const { f, game: legacy } = fixture();
    const game: WolfGameDefinition = { ...legacy, version: 2, stakeMinor: null, orderMode: 'first-tee-v1' };
    const onChange = vi.fn<(record: WolfHoleRecord) => void>();
    const props = { game, wolfId: null, holeNumber: 5, firstHole: 5, etag: 'current',
      saved: undefined, draft: undefined, players: f.cards, disabled: false, orderSupported: true, onChange };
    const view = render(<WolfHoleControls {...props} />);
    expect(screen.getByLabelText('Wolf declaration')).toBeDisabled();
    let draft: WolfHoleRecord | undefined;
    const labels = ['First Wolf', 'Second Wolf', 'Third Wolf', 'Fourth Wolf'];
    for (const [index, id] of [...game.playerIds].reverse().entries()) {
      fireEvent.change(screen.getByLabelText(labels[index] ?? ''), { target: { value: id } });
      draft = onChange.mock.lastCall?.[0];
      view.rerender(<WolfHoleControls {...props} draft={draft} />);
      expect(screen.getByLabelText(labels[index] ?? '')).toHaveValue(id);
    }
    expect(draft?.choice.mode).toBe('order');
    view.rerender(<WolfHoleControls {...props} draft={draft} wolfId={game.playerIds[3] ?? null} />);
    fireEvent.change(screen.getByLabelText('Wolf declaration'), { target: { value: 'pig' } });
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ choice: { mode: 'pig' }, order: draft?.order });
    view.rerender(<WolfHoleControls {...props} saved={draft} savedOrder={draft?.order}
      wolfId={game.playerIds[3] ?? null} />);
    expect(screen.queryByLabelText('First Wolf')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Wolf declaration')).toBeEnabled();
    view.rerender(<WolfHoleControls {...props} holeNumber={6} />);
    expect(screen.queryByLabelText('First Wolf')).not.toBeInTheDocument();
    expect(screen.getByText(/Choose the order at this group/)).toBeVisible();
    view.rerender(<WolfHoleControls {...props} orderSupported={false} />);
    expect(screen.getByLabelText('First Wolf')).toBeDisabled();
  });
  it('uses names only for partners and tracks acknowledged solo turns without counting a draft or blocking choices', () => {
    const { f, game: legacy, wolfId } = fixture();
    const game: WolfGameDefinition = { ...legacy, version: 2, stakeMinor: null };
    const records: WolfHoleRecord[] = [{ number: 1, choice: { gameId: game.id, gameEtag: 'current', mode: 'pig' } }];
    const result = calculateWolf(game, { layout: f.snapshot.teeProfile.holes, groups: f.snapshot.groups,
      players: f.cards.map((card) => ({ playerId: card.playerId, displayName: card.displayName,
        layout: f.snapshot.teeProfile.holes, strokeAllocation: true, handicap: 0 })) }, f.cards, records);
    const props = { game, wolfId, holeNumber: 1, etag: 'current', saved: undefined, draft: records[0], players: f.cards,
      disabled: false, onChange: vi.fn() };
    const view = render(<WolfHoleControls {...props} holes={[]} />);
    expect(screen.getByLabelText('Saved solo Wolf turns')).toHaveTextContent(f.cards[0]?.displayName ?? '');
    expect(screen.getByRole('option', { name: f.cards[1]?.displayName ?? '' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Partner:|immediately after/ })).not.toBeInTheDocument();
    view.rerender(<WolfHoleControls {...props} holes={result.holes} />);
    expect(screen.getByLabelText('Saved solo Wolf turns')).not.toHaveTextContent(f.cards[0]?.displayName ?? '');
    expect(screen.getByLabelText('Saved solo Wolf turns')).toHaveTextContent('Reminder only; play is not blocked.');
    expect(screen.getByLabelText('Wolf declaration')).toBeEnabled();
    const first = result.holes[0];
    if (!first) throw new Error('Missing fictional Wolf hole');
    view.rerender(<WolfSoloProgress game={game} players={f.cards} holes={game.playerIds.map((id, index) => ({
      ...first, number: index + 1, wolfId: id, mode: index % 2 ? 'blind' : 'pig',
    }))} />);
    expect(screen.getByLabelText('Saved solo Wolf turns')).toHaveTextContent('Everyone has a saved solo Wolf or PIG turn.');
  });

  it('stages an authoritative available comeback receipt for earned Wolf without exposing proof or legacy conceded outcomes', () => {
    const { f, game: legacy, wolfId } = fixture();
    const game: WolfGameDefinition = { ...legacy, version: 2, stakeMinor: null };
    const onChange = vi.fn<(record: WolfHoleRecord) => void>();
    const receipt = { wolfId, afterHoles: [1, 2, 3, 4, 5, 6, 7],
      totals: game.playerIds.map((playerId) => ({ playerId, dots: 1 })), proof: 'private-proof-not-player-copy' };
    const props = { game, wolfId, holeNumber: 8, etag: 'current', saved: undefined, draft: undefined,
      players: f.cards, disabled: false, onChange,
      comeback: { status: 'available' as const, receipt, changed: false } };
    const view = render(<WolfHoleControls {...props} />);
    expect(screen.queryByLabelText('Wolf match outcome')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Wolf declaration'), { target: { value: 'blind' } });
    expect(onChange.mock.lastCall?.[0]).toEqual({ number: 8, choice: { gameId: game.id, gameEtag: 'current', mode: 'blind' }, comeback: receipt });
    expect(view.container).not.toHaveTextContent(receipt.proof);
    view.rerender(<WolfHoleControls {...props} holeNumber={9} comeback={{ status: 'saved', receipt, changed: true }} />);
    fireEvent.change(screen.getByLabelText('Wolf declaration'), { target: { value: 'pig' } });
    expect(onChange.mock.lastCall?.[0].comeback).toBeUndefined();
    expect(screen.getByRole('status')).toHaveTextContent('chosen Wolf remains unchanged');
    view.rerender(<WolfHoleControls {...props} wolfId={null} comeback={{ status: 'pending', receipt: null, changed: false }} />);
    expect(screen.getByLabelText('Wolf declaration')).toBeDisabled();
    expect(screen.getByText(/Wolf selection is pending authoritative/)).toBeVisible();
  });

  it('shows V2 nonnegative earned totals without mounting hole-by-hole award evidence', () => {
    const { f, game: legacy } = fixture();
    const game: WolfGameDefinition = { ...legacy, version: 2, stakeMinor: 50 };
    const result = calculateWolf(game, { layout: f.snapshot.teeProfile.holes, groups: f.snapshot.groups,
      players: f.cards.map((card) => ({ playerId: card.playerId, displayName: card.displayName,
        layout: f.snapshot.teeProfile.holes, strokeAllocation: true, handicap: 0 })) }, f.cards,
    [{ number: 1, choice: { gameId: game.id, gameEtag: 'fictional-game-revision', mode: 'partner', partnerId: game.playerIds[1] ?? '' } }]);
    const view = render(<WolfResults game={game} result={result} />);
    expect(screen.getByRole('columnheader', { name: 'Earned dots' })).toBeVisible();
    expect(screen.queryByRole('columnheader', { name: 'Lost' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Dot balance' })).not.toBeInTheDocument();
    expect(view.container).not.toHaveTextContent('No dollar settlement');
    expect(screen.queryByText('Saved hole choices and winners')).not.toBeInTheDocument();
    expect(view.container).not.toHaveTextContent('wolf-high');
    expect(view.container).not.toHaveTextContent('fictional-game-revision');
  });
  it('records honor-system PIG/partner choices and explicit outcomes without independent saves', () => {
    const { f, game, wolfId } = fixture();
    const onChange = vi.fn<(record: WolfHoleRecord) => void>();
    const props = { game, wolfId, holeNumber: 1, etag: 'current', saved: undefined, draft: undefined,
      players: f.cards, disabled: false, onChange };
    const view = render(<WolfHoleControls {...props} />);
    expect(screen.getByLabelText('Wolf match outcome')).toBeDisabled();
    fireEvent.click(screen.getByText('Timing & rules'));
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

  it('keeps legacy authoritative won/lost/balance, zeros and negatives without detailed winner receipts or dollars', () => {
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
    expect(screen.queryByText('Saved hole choices and winners')).not.toBeInTheDocument();
    expect(view.container).not.toHaveTextContent('Fictional golfer 1 won');
    expect(view.container).not.toHaveTextContent('private-etag');
    expect(screen.queryByText('Earned dots')).not.toBeInTheDocument();
    expect(view.container).toHaveTextContent('No dollar settlement');
  });
});
