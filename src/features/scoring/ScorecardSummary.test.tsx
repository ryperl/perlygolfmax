import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { fictionalRoundScores, scoreResult } from '../../client/scoring.test-support';
import { SavedScoreLayout, ScorecardSummary } from './ScorecardSummary';

describe('pure saved score presentation', () => {
  it('renders persisted-only summary without promoting an incomplete card to a final result', () => {
    const card = scoreResult().round.cards[0];
    if (!card) throw new Error('Missing fictional card');
    render(<ScorecardSummary card={card} />);
    expect(screen.getByText(/Saved numeric strokes: 4 across 1\/9/)).toHaveTextContent('Unplayed: 8');
    expect(screen.getByText(/Incomplete — no final gross/)).toBeVisible();
    expect(screen.queryByText(/Complete gross:/)).not.toBeInTheDocument();
  });
  it('supports SSR and a focusable horizontally scrollable source table without browser adapters', () => {
    const markup = renderToStaticMarkup(<SavedScoreLayout round={fictionalRoundScores} />);
    expect(markup).toContain('9000');
    render(<SavedScoreLayout round={fictionalRoundScores} />);
    expect(screen.getByRole('region', { name: /horizontally scrollable/ })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('table')).toHaveTextContent('Stroke index');
    expect(screen.getAllByRole('row')).toHaveLength(10);
  });
});
