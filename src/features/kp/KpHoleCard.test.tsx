import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { KpHoleCard } from './KpHoleCard';
import { fictionalKpRound } from './kp.test-support';
import { calculateKp, calculateKpPayout } from '../../domain/kp';
import type { RoundScores } from '../../domain/scoring';
import { fictionalId } from '../../client/catalog.test-support';

function measured(distances: readonly (number | null | undefined)[], status: 'open' | 'closed' = 'closed', amountMinor = 10001): RoundScores {
  const source = fictionalKpRound();
  if (!source.kp) throw new Error('Missing fixture');
  return { ...source, kp: { ...source.kp, status }, kpPot: { amountMinor, currency: 'USD' },
    cards: source.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => {
      const inches = distances[index];
      return hole.number !== 1 || inches === undefined ? hole : { ...hole, score: { ...hole.score,
        kp: inches === null ? { kind: 'no-measurement' } : { kind: 'measured', inches, onGreen: true, measurementId: fictionalId(900 + index) },
      } };
    }) })) };
}
function card(round: RoundScores) {
  const hole = calculateKp(round).holes[0];
  if (!hole) throw new Error('Missing fixture hole');
  return <KpHoleCard round={round} hole={hole} payout={round.kpPot ? calculateKpPayout(round, round.kpPot.amountMinor) : null} />;
}
function resolved(kind: 'winner' | 'split'): RoundScores {
  const round = measured([62, 62, 90]);
  const hole = calculateKp(round).holes[0];
  if (!hole || !round.kp) throw new Error('Missing fixture');
  return { ...round, kp: { ...round.kp, decisions: [{
    holeNumber: 1, proof: hole.proof, kind, playerIds: kind === 'winner' ? [hole.closestPlayerIds[1] ?? ''] : hole.closestPlayerIds,
    holeAmountMinor: 10001, extraCentPlayerIds: kind === 'winner' ? [] : [hole.closestPlayerIds[0] ?? ''],
  }] } };
}
describe('compact KP ticket', () => {
  it('features the closest golfer once and expands all contenders in numeric distance order with a plain count', async () => {
    const round = measured([118, 88, 136]);
    render(card(round));
    expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent(round.cards[1]?.displayName ?? '');
    expect(screen.getByLabelText('7 feet 4 inches')).toBeVisible();
    expect(screen.getByText('Allocated award')).toBeVisible();
    const table = screen.getByRole('table', { name: 'Hole 1 measured contenders', hidden: true });
    expect(table).not.toBeVisible();
    await userEvent.click(screen.getByText('View contenders'));
    expect(await screen.findByText('Hide contenders')).toBeVisible();
    expect(table).toBeVisible();
    expect(within(table).getAllByRole('rowheader').map((row) => row.textContent))
      .toEqual([`1${round.cards[1]?.displayName ?? ''}`, `2${round.cards[0]?.displayName ?? ''}`, `3${round.cards[2]?.displayName ?? ''}`]);
    expect(screen.getByText('(3)')).toBeVisible();
    await userEvent.click(screen.getByText('Hide contenders'));
    expect(table).not.toBeVisible();
  });
  it('shows a live leader without claiming a settled award, and preserves a zero-inch ace', () => {
    render(card(measured([0, 100], 'open')));
    expect(screen.getByText('Leading')).toBeVisible();
    expect(screen.getByText('Hole-in-one')).toBeVisible();
    expect(screen.getByLabelText('0 feet 0 inches')).toBeVisible();
    expect(screen.queryByText('Allocated award')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Hole 1 awards')).not.toBeInTheDocument();
  });
  it.each(['open', 'closed'] as const)('does not turn blank or No measurement into a zero-inch result (%s)', (status) => {
    render(card(measured([undefined, null], status)));
    expect(screen.getByText(status === 'open' ? 'No measurement yet' : 'No qualifying measurement')).toBeVisible();
    expect(screen.queryByText('View contenders')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('0 feet 0 inches')).not.toBeInTheDocument();
    expect(screen.getByText('No measurement (1)')).toBeVisible();
  });
  it('keeps unresolved ties explicit without claiming either golfer won money', () => {
    render(card(measured([62, 62, 90])));
    expect(screen.getByText('Tie · Review needed')).toBeVisible();
    expect(screen.getByText('Resolve the closest-distance tie.')).toBeVisible();
    expect(screen.queryByLabelText('Hole 1 awards')).not.toBeInTheDocument();
  });
  it('shows exact split allocations and invalidates their display after a measurement proof changes', () => {
    const round = resolved('split');
    const view = render(card(round));
    expect(screen.getByText('Tie resolved · Split')).toBeVisible();
    const awards = within(screen.getByLabelText('Hole 1 awards'));
    expect(awards.getByText(/USD\s+50\.01/)).toBeVisible();
    expect(awards.getByText(/USD\s+50\.00/)).toBeVisible();
    const changed = { ...round, cards: round.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { ...hole.score, ...(hole.score.kp?.kind === 'measured'
        ? { kp: { ...hole.score.kp, measurementId: fictionalId(980) } } : {}) },
    })) })) };
    view.rerender(card(changed));
    expect(screen.getByText('Tie · Review needed')).toBeVisible();
    expect(screen.queryByLabelText('Hole 1 awards')).not.toBeInTheDocument();
  });
  it('keeps already-resolved owner management available on demand without filling the compact card with its form', async () => {
    const round = resolved('split');
    const hole = calculateKp(round).holes[0];
    if (!hole || !round.kpPot) throw new Error('Missing fixture');
    render(<KpHoleCard round={round} hole={hole} payout={calculateKpPayout(round, round.kpPot.amountMinor)}>
      <button>Review saved tie selection</button>
    </KpHoleCard>);
    expect(screen.getByText('Tie resolved · Split')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Review saved tie selection', hidden: true })).not.toBeVisible();
    await userEvent.click(screen.getByText('Change tie resolution'));
    expect(screen.getByRole('button', { name: 'Review saved tie selection' })).toBeVisible();
  });
  it('features the authoritative selected tied winner, not an arbitrary minimum, and retains zero-value awards', () => {
    const chosen = resolved('winner');
    const view = render(card(chosen));
    expect(screen.getByText('Tie resolved · Selected')).toBeVisible();
    expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent(chosen.cards[1]?.displayName ?? '');
    expect(screen.getByText(/USD\s+100\.01/)).toBeVisible();
    view.rerender(card(measured([12, 24], 'closed', 0)));
    expect(screen.getByText('Allocated award')).toBeVisible();
    expect(screen.getByText(/USD\s+0\.00/)).toBeVisible();
  });
  it('keeps known shares projected while another hole needs review, and invents no award without a configured pot', () => {
    const source = measured([12, 24]);
    const round = { ...source, cards: source.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { ...hole.score, ...(hole.number === 2 && index < 2 ? {
        kp: { kind: 'measured' as const, inches: 62, onGreen: true as const, measurementId: fictionalId(950 + index) },
      } : {}) },
    })) })) };
    const view = render(card(round));
    expect(screen.getByText('Projected award')).toBeVisible();
    expect(screen.queryByText('Allocated award')).not.toBeInTheDocument();
    const { kpPot, ...withoutPot } = source;
    expect(kpPot).toBeDefined();
    view.rerender(card(withoutPot));
    expect(screen.queryByLabelText('Hole 1 awards')).not.toBeInTheDocument();
    expect(screen.getByText('Closest')).toBeVisible();
  });
});
