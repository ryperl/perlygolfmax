import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fictionalRoundScores } from '../../client/scoring.test-support';
import { ScorecardNine } from './ScorecardNine';
import { scorecardGame } from './scorecard-presentation';
import { scorecardGamesFixture } from './scorecard-games.test-support';
import { withGameResults } from '../../client/scoring.test-support';
import { mixedTeeRound } from './tees.test-support';
import { ballDropFormat, strokeGameCards, strokeGameFixture, strokeGamesRound } from '../../domain/stroke-games.test-support';

const card = fictionalRoundScores.cards[0];
if (!card) throw new Error('Missing fictional card.');
describe('traditional scorecard nine', () => {
  it('places one Ball Drop line after the foursome and marks the saved combination per hole', () => {
    const f = strokeGameFixture();
    let cards = strokeGameCards(f.cards, 1, [{ kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 4 },
      { kind: 'strokes', strokes: 6 }, { kind: 'strokes', strokes: 7 }]);
    cards = strokeGameCards(cards, 2, [{ kind: 'strokes', strokes: 6 }, { kind: 'strokes', strokes: 7 },
      { kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 5 }]);
    const round = strokeGamesRound({ ...f, cards });
    const before = structuredClone(round);
    render(<ScorecardNine label="Front nine" subtotal="Out" layout={round.layout} fullLayout={round.layout}
      cards={round.cards} game={scorecardGame(round)} />);
    const team = screen.getByRole('row', { name: 'Fictional team 1 · Fictional Ball Drop team to par' });
    expect(within(team).getAllByRole('cell').slice(0, 3).map((cell) => cell.textContent)).toEqual(['-1', '+1', '0']);
    expect(team).toBe(team.parentElement?.lastElementChild);
    expect(screen.getAllByRole('row', { name: /team to par$/ })).toHaveLength(1);
    const first = screen.getByRole('rowheader', { name: 'Fictional golfer 1' }).closest('tr');
    const second = screen.getByRole('rowheader', { name: 'Fictional golfer 2' }).closest('tr');
    const third = screen.getByRole('rowheader', { name: 'Fictional golfer 3' }).closest('tr');
    if (!first || !second || !third) throw new Error('Missing fictional score rows.');
    expect(within(within(first).getAllByRole('cell')[0] ?? first).getByLabelText('Fictional team 1: counting net ball')).toHaveTextContent('N');
    expect(within(within(second).getAllByRole('cell')[0] ?? second).getByLabelText('Fictional team 1: counting gross ball')).toHaveTextContent('G');
    expect(within(first).getAllByRole('cell')[0]).toHaveClass('recap-counting-score');
    expect(within(first).getByLabelText('Hole 1: 3, birdie')).toHaveClass('score-birdie');
    expect(within(third).getAllByRole('cell')[0]).not.toHaveClass('recap-counting-score');
    expect(within(third).getAllByRole('cell')[1]).toHaveClass('recap-counting-score');
    expect(round).toEqual(before);
  });
  it.each(['ball-drop-two-net', 'ball-drop-two-gross'] as const)('marks both counting balls correctly for %s', (format) => {
    const f = strokeGameFixture();
    const round = strokeGamesRound({ ...f, ballDrop: ballDropFormat(f.ballDrop, format) });
    render(<ScorecardNine label="Front nine" subtotal="Out" layout={round.layout} fullLayout={round.layout}
      cards={round.cards} game={scorecardGame(round)} />);
    const basis = format === 'ball-drop-two-net' ? 'net' : 'gross';
    expect(screen.getAllByLabelText(`Fictional team 1: counting ${basis} ball`)).toHaveLength(18);
    expect(screen.queryByLabelText(`Fictional team 1: counting ${basis === 'net' ? 'gross' : 'net'} ball`)).not.toBeInTheDocument();
  });
  it('updates back-nine scores, totals and highlighted golfers from a fresh saved projection', () => {
    const f = strokeGameFixture(18);
    let cards = strokeGameCards(f.cards, 10, [{ kind: 'strokes', strokes: 6 }, { kind: 'strokes', strokes: 7 },
      { kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 5 }]);
    let round = strokeGamesRound({ ...f, cards });
    const input = { label: 'Back nine', subtotal: 'In' as const, layout: round.layout.slice(9), fullLayout: round.layout };
    const view = render(<ScorecardNine {...input} cards={cards} game={scorecardGame(round)} />);
    const team = screen.getByRole('row', { name: 'Fictional team 1 · Fictional Ball Drop team to par' });
    expect(within(team).getAllByRole('cell').slice(-2).map((cell) => cell.textContent)).toEqual(['+1', '+1']);
    const third = screen.getByRole('rowheader', { name: 'Fictional golfer 3' }).closest('tr');
    if (!third) throw new Error('Missing fictional score row.');
    expect(within(third).getAllByRole('cell')[0]).toHaveClass('recap-counting-score');
    cards = strokeGameCards(cards, 10, [{ kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 4 },
      { kind: 'strokes', strokes: 6 }, { kind: 'strokes', strokes: 7 }]);
    round = strokeGamesRound({ ...f, cards });
    view.rerender(<ScorecardNine {...input} cards={cards} game={scorecardGame(round)} />);
    expect(within(team).getAllByRole('cell').slice(-2).map((cell) => cell.textContent)).toEqual(['-1', '-1']);
    expect(within(third).getAllByRole('cell')[0]).not.toHaveClass('recap-counting-score');
    expect(screen.getAllByRole('row', { name: /team to par$/ })).toHaveLength(1);
  });
  it('does not highlight unresolved or unavailable combinations or fabricate their team scores', () => {
    const f = strokeGameFixture();
    const cards = strokeGameCards(f.cards, 2, [{ kind: 'unplayed' }]);
    const round = strokeGamesRound({ ...f, cards });
    const input = { label: 'Front nine', subtotal: 'Out' as const, layout: round.layout, fullLayout: round.layout, cards };
    const view = render(<ScorecardNine {...input} game={scorecardGame(round)} />);
    const team = screen.getByRole('row', { name: 'Fictional team 1 · Fictional Ball Drop team to par' });
    expect(within(team).getAllByRole('cell')[1]).toHaveTextContent('—');
    expect(within(team).getAllByRole('cell').at(-1)).toHaveTextContent('0*');
    expect(screen.getAllByLabelText('Fictional team 1: counting net ball')).toHaveLength(8);
    const unavailable = strokeGamesRound({ ...f, snapshot: { ...f.snapshot,
      players: f.snapshot.players.map((player, index) => index === 0 ? { ...player, handicapIndex: null } : player),
    } });
    view.rerender(<ScorecardNine {...input} game={scorecardGame(unavailable)} />);
    expect(team).toHaveTextContent('Unavailable');
    expect(within(team).getAllByRole('cell').every((cell) => cell.textContent === '—')).toBe(true);
    expect(screen.queryByLabelText('Fictional team 1: counting net ball')).not.toBeInTheDocument();
  });
  it('keeps mixed-tee source rows and raw gross marks golfer-specific without recalculating saved points', () => {
    const mixed = mixedTeeRound();
    const { round } = scorecardGamesFixture(9);
    const tee = mixed.playerTees?.[0];
    if (!tee) throw new Error('Missing fictional personal tee.');
    render(<ScorecardNine label="Front nine" subtotal="Out" layout={round.layout} fullLayout={round.layout}
      cards={mixed.cards} game={scorecardGame(round)} playerTees={[tee]} defaultTeeLabel="Fictional default / Fictional category" />);
    const first = screen.getByRole('rowheader', { name: 'Fictional Player 1' }).closest('tr');
    const second = screen.getByRole('rowheader', { name: 'Fictional Player 2' }).closest('tr');
    if (!first || !second) throw new Error('Missing fictional stroke rows.');
    expect(within(first).getByLabelText('Hole 1: 4, birdie')).toHaveClass('score-birdie');
    expect(within(second).getByLabelText('Hole 1: 4, par')).not.toHaveClass('score-birdie');
    expect(screen.getByRole('row', { name: 'Fictional Player 1 · Fictional standard points' })).toHaveTextContent('18');
    const par = screen.getByRole('rowheader', { name: 'Fictional Player 1 · Par' }).closest('tr');
    if (!par) throw new Error('Missing fictional par row.');
    expect(within(par).getAllByRole('cell').at(-1)).toHaveTextContent('45');
  });
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
