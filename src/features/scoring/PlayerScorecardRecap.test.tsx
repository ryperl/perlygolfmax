import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RoundScores, Scorecard } from '../../domain/scoring';
import { fictionalRoundScores } from '../../client/scoring.test-support';
import { PlayerScorecardRecap } from './PlayerScorecardRecap';
import { scorecardGamesFixture } from './scorecard-games.test-support';

function fixture() {
  const first = fictionalRoundScores.cards[0];
  if (!first) throw new Error('Missing fictional card.');
  const layout = Array.from({ length: 18 }, (_, index) => ({
    number: index + 1, sourceId: 301 + index, length: 100, par: 4, allocation: index + 1,
  }));
  const card: Scorecard = {
    ...first, etag: 'card-v1', updatedAt: '2026-01-01T00:00:00Z',
    holes: layout.map((hole) => ({ number: hole.number, score: { kind: 'strokes', strokes: 4 } })),
  };
  const round: RoundScores = {
    ...fictionalRoundScores, layout,
    teeRatings: [
      { type: 'Total', course: 70, slope: 120, bogey: 90 },
      { type: 'Front', course: 35, slope: 120, bogey: 45 },
      { type: 'Back', course: 35, slope: 120, bogey: 45 },
    ],
  };
  return { round, card };
}

describe('individual traditional scorecard recap', () => {
  it('shows the saved game alongside strokes by default and respects an explicit game or strokes-only selection', () => {
    const { round, games } = scorecardGamesFixture();
    const card = round.cards[0];
    if (!card) throw new Error('Missing fictional player.');
    const { rerender } = render(<PlayerScorecardRecap round={round} card={card} />);
    expect(screen.getAllByRole('row', { name: 'Fictional Player 1 · Fictional standard points' })).toHaveLength(2);
    expect(screen.getByText('72', { selector: 'strong' })).toBeVisible();
    rerender(<PlayerScorecardRecap round={round} card={card} gameId={games[1]?.id} />);
    expect(screen.getAllByRole('row', { name: 'Fictional Player 1 · Fictional modified points' })).toHaveLength(2);
    expect(screen.getByText('Fictional modified · Gross points')).toBeVisible();
    rerender(<PlayerScorecardRecap round={round} card={card} gameId={null} />);
    expect(screen.queryByRole('row', { name: /points$/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(2);
  });
  it('shows source rows, front/back recorded subtotals and complete gross without net formulas', () => {
    const { round, card } = fixture();
    render(<PlayerScorecardRecap round={round} card={card} />);
    const front = screen.getByRole('table', { name: 'Front nine scorecard' });
    const back = screen.getByRole('table', { name: 'Back nine scorecard' });
    expect(within(front).getByRole('columnheader', { name: 'Out' })).toBeVisible();
    expect(within(back).getByRole('columnheader', { name: 'In' })).toBeVisible();
    const score = within(front).getByRole('rowheader', { name: card.displayName }).closest('tr');
    if (!score) throw new Error('Missing score row.');
    expect(within(score).getAllByRole('cell').at(-1)).toHaveTextContent('36');
    expect(screen.getByText('72', { selector: 'strong' })).toBeVisible();
    expect(screen.getByText('Gross total:')).toBeVisible();
    expect(screen.queryByText(/Incomplete|Recorded strokes:|Saved card updated|History for|No net or Stableford|unplayed · X/)).not.toBeInTheDocument();
    expect(screen.getByText(/Course rating 70 · Slope 120/)).toBeVisible();
    expect(screen.queryByRole('columnheader', { name: 'Net' })).not.toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: 'Stableford' })).not.toBeInTheDocument();
  });

  it('preserves X7 and marks pickup subtotals and overall recorded totals incomplete', () => {
    const { round, card } = fixture();
    render(<PlayerScorecardRecap round={round} card={{
      ...card, holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score: { kind: 'picked-up', reportedStrokes: 7 } } : hole),
    }} />);
    expect(screen.getByLabelText('Hole 1: X7')).toBeVisible();
    expect(screen.getByRole('cell', { name: '39*' })).toBeVisible();
    expect(screen.getByText('75', { selector: 'strong' })).toBeVisible();
    expect(screen.getByText('Incomplete')).toBeVisible();
    expect(screen.getByText('* Incomplete recorded total.')).toBeVisible();
  });

  it('does not turn blank, bare X or DNF into zero or a completed result', () => {
    const { round, card } = fixture();
    render(<PlayerScorecardRecap round={round} card={{
      ...card, holes: card.holes.map((hole) => ({
        ...hole, score: hole.number === 1 ? { kind: 'picked-up' } : hole.number === 2 ? { kind: 'did-not-finish' } : { kind: 'unplayed' },
      })),
    }} />);
    expect(screen.getByLabelText('Hole 1: X')).toBeVisible();
    expect(screen.getByLabelText('Hole 2: DNF')).toBeVisible();
    expect(screen.getByText('—', { selector: 'strong' })).toBeVisible();
    expect(screen.getByText('Incomplete')).toBeVisible();
    expect(screen.queryByText('0', { selector: 'strong' })).not.toBeInTheDocument();
  });

  it('supports a nine-hole source without inventing back-nine data or source ratings', () => {
    const { round, card } = fixture();
    const { teeRatings: _unused, ...withoutRatings } = round;
    void _unused;
    render(<PlayerScorecardRecap round={{ ...withoutRatings, layout: round.layout.slice(0, 9) }} card={{ ...card, holes: card.holes.slice(0, 9) }} />);
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Back nine' })).not.toBeInTheDocument();
    expect(screen.getByText('36', { selector: 'strong' })).toBeVisible();
    expect(screen.queryByText(/Course rating/)).not.toBeInTheDocument();
  });
});
