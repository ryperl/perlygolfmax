import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fictionalRoundScores } from '../../client/scoring.test-support';
import { ScorecardNine } from './ScorecardNine';

const card = fictionalRoundScores.cards[0];
if (!card) throw new Error('Missing fictional card.');
describe('traditional scorecard nine', () => {
  it('marks raw gross scores relative to source par with accessible meanings, never classifying a pickup as a completed score', () => {
    const strokes = [2, 3, 4, 5, 6];
    render(<ScorecardNine label="Front nine" subtotal="Out" layout={fictionalRoundScores.layout}
      fullLayout={fictionalRoundScores.layout} cards={[{
        ...card, holes: [...card.holes].reverse().map((hole) => {
          const value = strokes[hole.number - 1];
          return { ...hole, score: value !== undefined ? { kind: 'strokes', strokes: value }
            : hole.number === 6 ? { kind: 'picked-up', reportedStrokes: 7 } : hole.score };
        }),
      }]} />);
    expect(screen.getByLabelText('Hole 1: 2, eagle or better')).toHaveClass('score-eagle');
    expect(screen.getByLabelText('Hole 2: 3, birdie')).toHaveClass('score-birdie');
    expect(screen.getByLabelText('Hole 3: 4, par')).not.toHaveClass('score-bogey');
    expect(screen.getByLabelText('Hole 4: 5, bogey')).toHaveClass('score-bogey');
    expect(screen.getByLabelText('Hole 5: 6, double bogey or more')).toHaveClass('score-double');
    expect(screen.getByLabelText('Hole 6: X7')).not.toHaveClass('score-double');
    const row = screen.getByRole('rowheader', { name: card.displayName }).closest('tr');
    if (!row) throw new Error('Missing player row.');
    expect(within(row).getAllByRole('cell').slice(0, 6).map((cell) => cell.textContent)).toEqual(['2', '3', '4', '5', '6', 'X7']);
    expect(within(row).getAllByRole('cell').at(-1)).toHaveTextContent('27*');
  });
  it('shows missing stored hole data distinctly instead of silently turning it into unplayed', () => {
    render(<ScorecardNine label="Front nine" subtotal="Out" layout={fictionalRoundScores.layout}
      fullLayout={fictionalRoundScores.layout} cards={[{ ...card, holes: card.holes.slice(1) }]} />);
    expect(screen.getByLabelText('Hole 1: score unavailable')).toHaveTextContent('?');
    expect(screen.getByLabelText('Hole 2: unplayed')).toHaveTextContent('—');
    expect(screen.getByRole('region', { name: 'Front nine scorecard' })).toHaveAttribute('tabindex', '0');
  });
});
