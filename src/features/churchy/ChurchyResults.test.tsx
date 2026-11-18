import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChurchyResults } from './ChurchyResults';
import { churchyFixture } from '../../domain/churchy.test-support';
import { strokeGameCards } from '../../domain/stroke-games.test-support';
import { calculateGameResults } from '../../domain/stableford';
import { defaultChurchySpecials } from '../../domain/churchy';

describe('Churchy saved receipts and separate settlement', () => {
  it('uses the server-produced v2 per-opponent summary and labels group identity without a second legacy settlement', () => {
    const f = churchyFixture(9);
    const game = { ...f.game, version: 2 as const, enabledSpecials: defaultChurchySpecials };
    const cards = strokeGameCards(f.cards, 1, [{ kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 3 }]);
    const result = calculateGameResults([game], f.snapshot, cards)[0];
    if (!result?.churchy?.internalSettlement) throw new Error('Missing fictional v2 settlement.');
    render(<ChurchyResults game={game} result={result} />);
    expect(screen.getByRole('region', { name: 'Churchie · Group 1 results' })).toBeVisible();
    const summary = within(screen.getByRole('region', { name: 'Group 1 Churchie internal settlement' }));
    fireEvent.click(summary.getByText('Rate and settlement method'));
    expect(summary.getByText(/Total to settle: USD\s+28.00/)).toBeVisible();
    const amounts = [...summary.getByRole('list', { name: 'Combined standings' }).querySelectorAll('summary .internal-settlement-money')]
      .map((element) => element.textContent);
    expect(amounts.filter((value) => /Due USD\s+14.00/.test(value))).toHaveLength(2);
    expect(amounts.filter((value) => /Owes USD\s+14.00/.test(value))).toHaveLength(2);
    expect(screen.queryByText('Saved hole receipts')).not.toBeInTheDocument();
    expect(screen.queryByText(/Pays into pot/)).toBeNull();
    expect(screen.queryByText(/Experimental/i)).toBeNull();
  });
  it('ranks only selected four, equal dots share rank and legacy planned shared-pot amounts remain without audit receipts', () => {
    const f = churchyFixture();
    const round = f.round(strokeGameCards(f.cards, 1, [{ kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 3 }]));
    render(<ChurchyResults game={f.game} result={round.games?.results[0]} />);
    const standings = within(screen.getByRole('list', { name: 'Churchie standings' }));
    expect(standings.getAllByRole('listitem')).toHaveLength(4);
    expect(standings.getAllByText(/T1.*5 earned dots/)).toHaveLength(2);
    expect(screen.queryByText(/Fictional golfer 5/)).toBeNull();
    expect(screen.getAllByText(/Pays into pot: \$5.00/)).toHaveLength(2);
    expect(screen.getAllByText(/Collects from pot: \$5.00/)).toHaveLength(2);
    expect(screen.getByText(/Nothing collected or paid/)).toBeVisible();
    expect(screen.queryByText('Saved hole receipts')).not.toBeInTheDocument();
    expect(screen.queryByText(/High:.*earn 1 each/)).not.toBeInTheDocument();
  });
  it('keeps unavailable and pending settlements distinct from zero and final totals', () => {
    const f = churchyFixture();
    const round = f.round(strokeGameCards(f.cards, 1, [{ kind: 'unplayed' }]));
    render(<ChurchyResults game={f.game} result={round.games?.results[0]} />);
    expect(screen.getByRole('list', { name: 'Churchie standings' })).toBeEmptyDOMElement();
    expect(screen.getAllByText(/Pays into pot: Unavailable/)).toHaveLength(4);
    expect(screen.getByText(/Unawarded High carry: uncertain/)).toBeVisible();
    expect(screen.getByText(/pending holes are not ties/)).toBeVisible();
  });
});
