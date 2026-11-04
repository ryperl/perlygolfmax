import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fictionalRoundScores } from '../../client/scoring.test-support';
import { ScorecardNine } from './ScorecardNine';
import { scorecardGame } from './scorecard-presentation';
import { scorecardGamesFixture } from './scorecard-games.test-support';
import { withGameResults } from '../../client/scoring.test-support';

const card = fictionalRoundScores.cards[0];
if (!card) throw new Error('Missing fictional card.');
describe('traditional scorecard nine', () => {
  it('shows server-derived points immediately beneath strokes, with front/back/game totals and valid zero/negative points', () => {
    const { round, games } = scorecardGamesFixture();
    const game = scorecardGame(round, games[1]?.id);
    render(<ScorecardNine label="Back nine" subtotal="In" layout={round.layout.slice(9)} fullLayout={round.layout} cards={round.cards} game={game} />);
    const zero = screen.getByRole('row', { name: 'Fictional Player 1 · Fictional modified points' });
    expect(within(zero).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([...Array<string>(9).fill('0'), '0', '0']);
    const negative = screen.getByRole('row', { name: 'Fictional Player 2 · Fictional modified points' });
    expect(within(negative).getAllByRole('cell').slice(-2).map((cell) => cell.textContent)).toEqual(['-9', '-18']);
    const strokes = screen.getByRole('rowheader', { name: 'Fictional Player 1' }).closest('tr');
    if (!strokes) throw new Error('Missing fictional stroke row.');
    expect(within(strokes).getByLabelText('Hole 10: 4, par')).toBeVisible();
    const pickup = screen.getByRole('row', { name: 'Fictional Player 3 · Fictional modified points' });
    expect(within(pickup).getAllByRole('cell').at(-1)).toHaveTextContent('-2');
  });

  it('displays a known zero-point pickup and partial totals without treating unplayed holes as zero', () => {
    const { round, games } = scorecardGamesFixture(9);
    const standard = games[0];
    if (!standard) throw new Error('Missing fictional game.');
    const updated = withGameResults({ ...round, cards: round.cards.map((card, index) => index !== 2 ? card : {
      ...card, holes: card.holes.map((hole) => hole.number === 1 ? hole : { ...hole, score: { kind: 'unplayed' } }),
    }) }, [standard], 'games-v2');
    const pickup = updated.cards[2];
    if (!pickup) throw new Error('Missing fictional pickup card.');
    render(<ScorecardNine label="Front nine" subtotal="Out" layout={updated.layout} fullLayout={updated.layout} cards={[pickup]}
      game={scorecardGame(updated)} />);
    const points = screen.getByRole('row', { name: 'Fictional Player 3 · Fictional standard points' });
    expect(within(points).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['0', ...Array<string>(8).fill('—'), '0*', '0*']);
    expect(screen.getByLabelText('Hole 1: X7')).toBeVisible();
  });

  it('keeps unplayed points pending and unavailable net points distinct from zero', () => {
    const { round, games } = scorecardGamesFixture(9);
    render(<ScorecardNine label="Front nine" subtotal="Out" layout={round.layout} fullLayout={round.layout} cards={round.cards}
      game={scorecardGame(round, games[2]?.id)} />);
    const missing = screen.getByRole('row', { name: 'Fictional Player 3 · Fictional net points' });
    expect(missing).toHaveTextContent('Unavailable');
    expect(within(missing).getAllByRole('cell').every((cell) => cell.textContent === '—')).toBe(true);
    const pending = screen.getByRole('row', { name: 'Fictional Player 4 · Fictional net points' });
    expect(pending).not.toHaveTextContent('Unavailable');
    expect(within(pending).getAllByRole('cell').every((cell) => cell.textContent === '—')).toBe(true);
    const available = screen.getByRole('row', { name: 'Fictional Player 1 · Fictional net points' });
    expect(within(available).getAllByRole('cell').slice(-2).map((cell) => cell.textContent)).toEqual(['27', '27']);
  });
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
