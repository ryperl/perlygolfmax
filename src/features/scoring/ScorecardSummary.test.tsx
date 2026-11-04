import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { fictionalRoundScores, scoreResult } from '../../client/scoring.test-support';
import { SavedScoreLayout, ScorecardSummary } from './ScorecardSummary';

describe('pure saved score presentation', () => {
  it('uses a dash rather than a fabricated zero score when no strokes were recorded', () => {
    const card = fictionalRoundScores.cards[0];
    if (!card) throw new Error('Missing fictional card');
    render(<ScorecardSummary card={card} />);
    expect(screen.getByText(/Recorded strokes: — across 0\/9/)).toHaveTextContent('Incomplete');
  });
  it('renders persisted-only summary without promoting an incomplete card to a final result', () => {
    const card = scoreResult().round.cards[0];
    if (!card) throw new Error('Missing fictional card');
    render(<ScorecardSummary card={card} />);
    expect(screen.getByText(/Recorded strokes: 4 across 1\/9 recorded holes; 1 completed/)).toHaveTextContent('Unplayed: 8');
    expect(screen.getByText(/Incomplete — no final gross/)).toBeVisible();
    expect(screen.queryByText(/Complete gross:/)).not.toBeInTheDocument();
  });
  it('includes X7 in recorded strokes but never calls it a completed numeric hole or final total', () => {
    const card = scoreResult().round.cards[0];
    if (!card) throw new Error('Missing fictional card');
    render(<ScorecardSummary card={{ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: hole.number === 2 ? { kind: 'picked-up', reportedStrokes: 7 } : hole.score,
    })) }} />);
    expect(screen.getByText(/Recorded strokes: 11 across 2\/9 recorded holes; 1 completed/)).toHaveTextContent('picked up: 1');
    expect(screen.getByText(/Incomplete — no final gross/)).toBeVisible();
    expect(screen.queryByText(/Complete gross:/)).not.toBeInTheDocument();
  });
  it('reports complete gross only when all saved holes are completed numeric strokes', () => {
    const card = scoreResult().round.cards[0];
    if (!card) throw new Error('Missing fictional card');
    render(<ScorecardSummary card={{ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'strokes', strokes: 4 },
    })) }} />);
    expect(screen.getByText(/Complete gross: 36/)).toBeVisible();
    expect(screen.queryByText(/Incomplete — no final gross/)).not.toBeInTheDocument();
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
