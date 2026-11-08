import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChurchyResults } from './ChurchyResults';
import { churchyFixture } from '../../domain/churchy.test-support';
import { strokeGameCards } from '../../domain/stroke-games.test-support';

describe('Churchy saved receipts and separate settlement', () => {
  it('ranks only selected four, equal dots share rank, receipts show full partner dots and planned shared-pot amounts', () => {
    const f = churchyFixture();
    const round = f.round(strokeGameCards(f.cards, 1, [{ kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 3 }]));
    render(<ChurchyResults game={f.game} result={round.games?.results[0]} />);
    const standings = within(screen.getByRole('list', { name: 'Churchy standings' }));
    expect(standings.getAllByRole('listitem')).toHaveLength(4);
    expect(standings.getAllByText(/T1.*5 earned dots/)).toHaveLength(2);
    expect(screen.queryByText(/Fictional golfer 5/)).toBeNull();
    expect(screen.getAllByText(/Pays into pot: \$5.00/)).toHaveLength(2);
    expect(screen.getAllByText(/Collects from pot: \$5.00/)).toHaveLength(2);
    expect(screen.getByText(/Nothing collected or paid/)).toBeVisible();
    expect(screen.getByText(/High:.*earn 1 each/)).toBeInTheDocument();
  });
  it('keeps unavailable and pending settlements distinct from zero and final totals', () => {
    const f = churchyFixture();
    const round = f.round(strokeGameCards(f.cards, 1, [{ kind: 'unplayed' }]));
    render(<ChurchyResults game={f.game} result={round.games?.results[0]} />);
    expect(screen.getByRole('list', { name: 'Churchy standings' })).toBeEmptyDOMElement();
    expect(screen.getAllByText(/Pays into pot: Unavailable/)).toHaveLength(4);
    expect(screen.getByText(/Unawarded High carry: uncertain/)).toBeVisible();
    expect(screen.getByText(/pending holes are not ties/)).toBeVisible();
  });
});
