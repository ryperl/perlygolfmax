import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KpPanel } from './KpPanel';
import { fictionalKpRound } from './kp.test-support';
import type { RoundScores } from '../../domain/scoring';
import { calculateKp } from '../../domain/kp';
import { fictionalId } from '../../client/catalog.test-support';
import type { ComponentProps } from 'react';

function panel(round: RoundScores, manage = vi.fn().mockResolvedValue(undefined), groupNumber = 1, props: Partial<ComponentProps<typeof KpPanel>> = {}) {
  return render(<KpPanel round={round} busy={false} dirty={false} groupNumber={groupNumber} holeNumber={1}
    onGroup={vi.fn()} onHole={vi.fn()} onEdit={vi.fn()} draftFor={() => ({ value: undefined, savedValue: undefined, dirty: false, conflict: false, canReview: false })}
    onSave={vi.fn()} onDiscard={vi.fn()} onManage={manage} onPendingChange={vi.fn()} onReview={vi.fn()} onUseSaved={vi.fn()} {...props} />);
}
describe('round KP review', () => {
  it('keeps only compact closure state without routine rule or round-pot paragraphs', () => {
    const round = fictionalKpRound();
    if (!round.kp) throw new Error('Missing fixture');
    panel({ ...round, kp: { ...round.kp, status: 'closed' } });
    expect(screen.getByRole('status')).toHaveTextContent(/^Entries closed$/);
    expect(screen.queryByText(/Closest on-green ball on each|ordinary golf scoring remains open|Round pot:|Fully allocated planned awards/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen KP entries' })).toBeVisible();
    const entry = within(screen.getByRole('article', { name: 'KP entry group' }));
    expect(entry.queryByRole('button')).not.toBeInTheDocument();
    expect(entry.getAllByText('Not entered')).toHaveLength(round.cards.length);
    expect(entry.queryByText(/Save KP entries|Discard all round drafts/)).not.toBeInTheDocument();
  });
  it.each([1, 2])('visibly identifies each entry for group %s using golfer IDs, not card order', (groupNumber) => {
    const source = fictionalKpRound();
    const groups = [
      { number: 1, playerIds: source.cards.slice(0, 2).map((card) => card.playerId) },
      { number: 2, playerIds: source.cards.slice(2).map((card) => card.playerId) },
    ];
    panel({ ...source, groups, cards: [...source.cards].reverse() }, undefined, groupNumber);
    const entry = within(screen.getByRole('article', { name: 'KP entry group' }));
    const selected = groups.find((group) => group.number === groupNumber);
    if (!selected) throw new Error('Missing fictional group.');
    const names = selected.playerIds.map((id) => source.cards.find((card) => card.playerId === id)?.displayName);
    expect(entry.getAllByRole('rowheader').map((heading) => heading.textContent)).toEqual(names);
    for (const card of source.cards) {
      if (selected.playerIds.includes(card.playerId)) {
        const row = within(entry.getByRole('row', { name: new RegExp(card.displayName) }));
        expect(row.getByRole('rowheader', { name: card.displayName })).toBeVisible();
        expect(row.getByRole('button', { name: `KP for ${card.displayName}` })).toBeVisible();
      } else {
        expect(entry.queryByRole('rowheader', { name: card.displayName })).not.toBeInTheDocument();
      }
    }
  });
  it('distinguishes a saved ace, explicit no measurement and unknown values in a read-only roster', () => {
    const round = fictionalKpRound();
    if (!round.kp) throw new Error('Missing fixture');
    panel({ ...round, kp: { ...round.kp, status: 'closed' } }, undefined, 1, {
      draftFor: (id) => ({ value: id === round.cards[0]?.playerId
        ? { kind: 'measured', inches: 0, onGreen: true, measurementId: fictionalId(9100) }
        : id === round.cards[1]?.playerId ? { kind: 'no-measurement' } : undefined,
      savedValue: undefined, dirty: false, conflict: false, canReview: false }),
    });
    const entry = within(screen.getByRole('article', { name: 'KP entry group' }));
    expect(entry.getByText('Hole-in-one · 0 ft 0 in')).toBeVisible();
    expect(entry.getByText('No measurement')).toBeVisible();
    expect(entry.getAllByText('Not entered')).toHaveLength(round.cards.length - 2);
    expect(entry.queryByRole('button')).not.toBeInTheDocument();
  });
  it('keeps unauthorized rows read-only and shows round save/discard only while drafts exist', () => {
    const source = fictionalKpRound();
    const writable = source.cards[0];
    if (!writable) throw new Error('Missing golfer');
    const round = { ...source, permissions: { role: 'public' as const, writePlayerIds: [writable.playerId], canManageGames: false } };
    const view = panel(round);
    const entry = within(screen.getByRole('article', { name: 'KP entry group' }));
    expect(entry.getAllByRole('button')).toHaveLength(1);
    expect(entry.getByRole('button', { name: `KP for ${writable.displayName}` })).toBeEnabled();
    expect(entry.queryByRole('button', { name: 'Save KP entries' })).not.toBeInTheDocument();
    view.unmount();
    const save = vi.fn(), discard = vi.fn();
    panel(round, undefined, 1, { dirty: true, onSave: save, onDiscard: discard });
    fireEvent.click(screen.getByRole('button', { name: 'Save KP entries' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard all round drafts' }));
    expect(save).toHaveBeenCalledOnce();
    expect(discard).toHaveBeenCalledOnce();
    expect(screen.getByRole('combobox', { name: 'KP group' })).toBeDisabled();
  });
  it('retains closed-round dirty and conflict recovery without allowing a measurement save', () => {
    const round = fictionalKpRound();
    if (!round.kp) throw new Error('Missing fixture');
    const review = vi.fn(), useSaved = vi.fn(), discard = vi.fn();
    panel({ ...round, kp: { ...round.kp, status: 'closed' } }, undefined, 1, {
      dirty: true, onReview: review, onUseSaved: useSaved, onDiscard: discard,
      draftFor: () => ({ value: { kind: 'no-measurement' }, savedValue: undefined, dirty: true, conflict: true, canReview: true }),
    });
    const first = round.cards[0];
    if (!first) throw new Error('Missing golfer');
    expect(screen.getByRole('button', { name: 'Save KP entries' })).toBeDisabled();
    expect(screen.getAllByText('unsaved')).toHaveLength(round.cards.length);
    fireEvent.click(screen.getByRole('button', { name: `Review KP for ${first.displayName}` }));
    fireEvent.click(screen.getByRole('button', { name: `Use saved hole for ${first.displayName}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard all round drafts' }));
    expect(review).toHaveBeenCalledWith(first.playerId);
    expect(useSaved).toHaveBeenCalledWith(first.playerId);
    expect(discard).toHaveBeenCalledOnce();
  });
  it('exposes owner closure independently of scoring and keeps public/old API management unavailable', () => {
    const round = fictionalKpRound();
    const manage = vi.fn().mockResolvedValue(undefined);
    const view = panel(round, manage);
    fireEvent.click(screen.getByRole('button', { name: 'Close KP entries' }));
    expect(manage).toHaveBeenCalledWith(expect.objectContaining({ status: 'closed', decisions: [] }), 'kp-current', expect.any(String));
    view.unmount();
    panel({ ...round, permissions: { role: 'public', writePlayerIds: round.cards.map((card) => card.playerId), canManageGames: false } });
    expect(screen.queryByRole('button', { name: 'Close KP entries' })).toBeNull();
    expect(screen.getByText(/Entries open/)).toBeVisible();
  });
  it('requires explicit extra-cent recipients and binds split decisions to exact current contenders and hole amount', () => {
    const source = fictionalKpRound();
    const cards = source.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { ...hole.score, ...(hole.number <= 3 && index < 2 ? {
        kp: { kind: 'measured' as const, inches: index === 1 && hole.number !== 2 ? 24 : 12, onGreen: true as const, measurementId: fictionalId(900 + hole.number * 4 + index) },
      } : {}) },
    })) }));
    const round = { ...source, cards, kp: source.kp ? { ...source.kp, status: 'closed' as const } : undefined };
    if (!round.kp) throw new Error('Missing fixture');
    const manage = vi.fn().mockResolvedValue(undefined);
    panel({ ...round, kp: round.kp }, manage);
    const hole = within(screen.getByRole('article', { name: 'KP hole 2 results' }));
    const split = hole.getByRole('button', { name: 'Split tied hole prize' });
    expect(split).toBeDisabled();
    const first = source.cards[0];
    if (!first) throw new Error('Missing fixture');
    fireEvent.click(hole.getByRole('checkbox', { name: `Extra cent: ${first.displayName}` }));
    expect(split).toBeEnabled();
    fireEvent.click(split);
    expect(manage).toHaveBeenCalledWith(expect.objectContaining({ decisions: [expect.objectContaining({
      kind: 'split', holeAmountMinor: 3333, extraCentPlayerIds: [first.playerId],
      proof: calculateKp({ ...round, kp: round.kp }).holes.find((entry) => entry.number === 2)?.proof,
    })] }), 'kp-current', expect.any(String));
  });
  it('shows no-par3 unavailability rather than inventing holes', () => {
    const source = fictionalKpRound();
    panel({ ...source, layout: source.layout.map((hole) => ({ ...hole, par: 4 })) });
    expect(screen.getByText(/No par 3 holes/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Configure KP Competition' })).toBeNull();
  });
});
