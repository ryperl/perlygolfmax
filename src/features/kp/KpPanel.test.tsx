import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KpPanel } from './KpPanel';
import { fictionalKpRound } from './kp.test-support';
import type { RoundScores } from '../../domain/scoring';
import { calculateKp } from '../../domain/kp';
import { fictionalId } from '../../client/catalog.test-support';

function panel(round: RoundScores, manage = vi.fn().mockResolvedValue(undefined)) {
  return render(<KpPanel round={round} busy={false} dirty={false} groupNumber={1} holeNumber={1}
    onGroup={vi.fn()} onHole={vi.fn()} onEdit={vi.fn()} draftFor={() => ({ value: undefined, savedValue: undefined, dirty: false, conflict: false, canReview: false })}
    onSave={vi.fn()} onDiscard={vi.fn()} onManage={manage} onPendingChange={vi.fn()} onReview={vi.fn()} onUseSaved={vi.fn()} />);
}
describe('round KP review', () => {
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
