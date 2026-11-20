import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MatchPlayGameDefinition, NassauVariant } from '../../domain/nassau';
import type { HoleScore, Scorecard } from '../../domain/scoring';
import { matchGamesFixture } from '../../domain/match-games.test-support';
import { roundTee } from '../../domain/round-tee';
import { calculateGameResults } from '../../domain/stableford';
import { MatchPlayRows, MatchPlaySummary } from './MatchPlayScorecard';
import { SavedScorecards } from './SavedScorecards';
import { scorecardGame, scorecardGameWarnings } from './scorecard-presentation';
import type { ScorecardGame } from './scorecard-presentation';

function fixture(variant: NassauVariant = 'singles', back = false) {
  const f = matchGamesFixture();
  const tee = roundTee(f.snapshot.teeProfile, back ? 'back' : 'full');
  if (!tee) throw new Error('Missing fictional match tee');
  const order = back ? [17, 18, 10, 11] : [1, 2, 3, 4];
  const snapshot = { ...f.snapshot, teeProfile: tee,
    groups: f.snapshot.groups.map((group) => ({ ...group, startingHole: order[0] ?? 1 })) };
  const members = variant === 'three-way' ? [[0], [1], [2]]
    : variant === 'one-v-two' ? [[0], [1, 2]]
      : variant === 'singles' ? [[0], [1]] : [[0, 1], [2, 3]];
  const game: MatchPlayGameDefinition = { ...f.nassau, name: 'Fictional Match Play', kind: 'match-play', variant,
    automaticPresses: false, stakes: { ...f.nassau.stakes, frontMinor: 0, backMinor: 0 },
    sides: members.map((indexes, index) => ({ id: f.nassau.sides[index]?.id ?? `fictional-side-${String(index)}`,
      name: `Fictional side ${String(index + 1)}`, playerIds: indexes.map((index) => f.ids[index] ?? '') })) };
  const cards = f.cards.map((card, index) => ({ ...card, holes: tee.holes.map((hole) => {
    const playedIndex = order.indexOf(hole.number);
    const score: HoleScore = playedIndex === -1 ? { kind: 'unplayed' } : { kind: 'strokes',
      strokes: index === 0 ? [3, 5, 4, 3][playedIndex] ?? 4 : 4 };
    return { number: hole.number, score };
  }) }));
  const results = calculateGameResults([game], snapshot, cards);
  const base = f.round(cards, [game]);
  const round = { ...base, groups: snapshot.groups, layout: tee.holes,
    games: { configuration: { eventId: base.eventId, roundId: base.roundId, games: [game], etag: 'fictional-game-revision' }, results } };
  const view = scorecardGame(round, game.id);
  const first = cards[0], second = cards[1];
  if (!view || !first || !second) throw new Error('Missing fictional scorecard');
  return { ...f, round, game, view, first, second, order };
}

function rows(f: ReturnType<typeof fixture>, card: Scorecard = f.first, view: ScorecardGame = f.view) {
  return <table><tbody><MatchPlayRows game={view} card={card} players={f.round.cards}
    layout={f.round.layout} showTotal /></tbody></table>;
}

describe('saved Match Play scorecard positions', () => {
  it('shows opposing UP/AS/DN rows from saved outcomes and keeps future cells and final result pending', () => {
    const f = fixture();
    const before = structuredClone(f.round);
    const renderRows = render(rows(f));
    const row = screen.getByRole('row', { name: /Fictional golfer 1 .* match position vs Fictional golfer 2/ });
    expect(within(row).getAllByRole('cell').slice(0, 5).map((cell) => cell.textContent)).toEqual(['1 UP', 'AS', 'AS', '1 UP', '—']);
    expect(within(row).getByLabelText(/final match position.*pending/)).toHaveTextContent('—');
    renderRows.rerender(rows(f, f.second));
    expect(screen.getByLabelText(/after hole 1 match position.*1 down/)).toHaveTextContent('1 DN');
    expect(screen.getByLabelText(/after hole 2 match position.*all square/)).toHaveTextContent('AS');
    expect(f.round).toEqual(before);
  });

  it('uses the authoritative match outcomes even when numeric raw strokes would suggest something different', () => {
    const f = fixture();
    const result = f.view.result;
    if (!result?.nassau) throw new Error('Missing fictional match results');
    const view = { ...f.view, result: { ...result, nassau: { ...result.nassau, matches: result.nassau.matches.map((match) => ({
      ...match, holes: match.holes.map((hole) => hole.number === 1 ? { ...hole, outcome: 'side-b' as const, source: 'override' as const } : hole),
    })) } } };
    render(rows(f, f.first, view));
    expect(screen.getByLabelText(/after hole 1 match position.*1 down/)).toHaveTextContent('1 DN');
    expect(f.first.holes[0]?.score).toEqual({ kind: 'strokes', strokes: 3 });
  });

  it('shows the current position above the card and reverses the perspective on an individual opponent card', () => {
    const f = fixture();
    const rendered = render(<MatchPlaySummary game={f.view} players={f.round.cards} />);
    expect(screen.getByText('Fictional golfer 1 1 UP')).toBeVisible();
    expect(screen.getByText('Thru 4 · 14 holes to play')).toBeVisible();
    rendered.rerender(<MatchPlaySummary game={f.view} players={f.round.cards} playerId={f.second.playerId} />);
    expect(screen.getByText('1 DN', { selector: 'strong' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Fictional golfer 2 vs Fictional golfer 1' })).toBeVisible();
  });

  it('does not jump over a missing saved result or call known later outcomes a settled position', () => {
    const f = fixture();
    const result = f.view.result;
    if (!result?.nassau) throw new Error('Missing fictional results');
    const gap = { ...f.view, result: { ...result, nassau: { ...result.nassau, matches: result.nassau.matches.map((match) => ({
      ...match, holes: match.holes.map((hole) => hole.number === 2 ? { ...hole, status: 'pending' as const, outcome: null } : hole),
    })) } } };
    render(<>{rows(f, f.first, gap)}<MatchPlaySummary game={gap} players={f.round.cards} /></>);
    expect(screen.getByLabelText(/after hole 1 match position.*1 up/)).toHaveTextContent('1 UP');
    expect(screen.getByLabelText(/after hole 3 match position.*pending/)).toHaveTextContent('—');
    expect(screen.getByText('Position pending')).toBeVisible();
    expect(screen.queryByText(/Thru /)).not.toBeInTheDocument();
  });

  it('shows all square and a final position only after the whole saved circuit is complete', () => {
    const f = fixture();
    const cards = f.round.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'strokes' as const, strokes: 4 },
    })) }));
    const result = calculateGameResults([f.game], f.snapshot, cards)[0];
    const view = { ...f.view, result };
    render(<>{rows(f, f.first, view)}<MatchPlaySummary game={view} players={cards} /></>);
    expect(screen.getByText('All square')).toBeVisible();
    expect(screen.getByText('Complete saved match')).toBeVisible();
    expect(screen.getByLabelText(/final match position.*all square/)).toHaveTextContent('AS');
    expect(screen.queryByText(/holes to play/)).not.toBeInTheDocument();
  });

  it('distinguishes unavailable results from pending, and recovers after a refreshed response', () => {
    const f = fixture();
    const missing = { ...f.view, result: undefined };
    const rendered = render(<>{rows(f, f.first, missing)}<MatchPlaySummary game={missing} players={f.round.cards} /></>);
    expect(screen.getByText('Saved match positions unavailable. Refresh to retry.')).toBeVisible();
    expect(screen.getByLabelText(/after hole 1 match position: unavailable/)).toHaveTextContent('—');
    const result = f.view.result;
    if (!result?.nassau) throw new Error('Missing fictional results');
    const unavailable = { ...f.view, result: { ...result, nassau: { ...result.nassau, matches: result.nassau.matches.map((match) => ({
      ...match, holes: match.holes.map((hole) => hole.number === 2 ? { ...hole, status: 'unavailable' as const, outcome: null } : hole),
    })) } } };
    rendered.rerender(<>{rows(f, f.first, unavailable)}<MatchPlaySummary game={unavailable} players={f.round.cards} /></>);
    expect(screen.getByText('Position unavailable')).toBeVisible();
    expect(screen.getByLabelText(/after hole 3 match position.*unavailable/)).toHaveTextContent('—');
    rendered.rerender(<>{rows(f)}<MatchPlaySummary game={f.view} players={f.round.cards} /></>);
    expect(screen.getByText('Fictional golfer 1 1 UP')).toBeVisible();
  });

  it.each(['three-way', 'one-v-two', 'two-v-two-best-ball', 'two-v-two-aggregate'] as const)(
    'keeps %s pairings and teammate perspectives distinct', (variant) => {
      const f = fixture(variant);
      render(rows(f));
      expect(screen.getAllByRole('row')).toHaveLength(variant === 'three-way' ? 2 : 1);
      expect(screen.getAllByRole('rowheader')[0]).toHaveTextContent('vs Fictional golfer');
      expect(scorecardGameWarnings(f.view, f.round.cards)).toEqual([]);
    },
  );

  it('does not show unrelated group matches or create a Match Play row for a nonparticipant', () => {
    const f = fixture();
    const other = f.round.cards[3];
    if (!other) throw new Error('Missing fictional nonparticipant');
    render(<>{rows(f, other)}<MatchPlaySummary game={f.view} players={f.round.cards} playerId={other.playerId} /></>);
    expect(screen.queryByRole('row')).not.toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(scorecardGame(f.round, f.game.id, [other.playerId])).toBeUndefined();
  });

  it('uses actual wrapped back-nine order in group and individual cards without inventing front-nine holes', () => {
    const f = fixture('singles', true);
    render(<SavedScorecards round={f.round} groupNumber={1} busy={false} onGroupChange={vi.fn()} onEnterScores={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Game' })).toHaveValue(f.game.id);
    expect(screen.queryByRole('table', { name: 'Front nine scorecard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Holes to display' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/golfer 1, after hole 17 match position.*1 up/)).toHaveTextContent('1 UP');
    expect(screen.getByLabelText(/golfer 1, after hole 18 match position.*all square/)).toHaveTextContent('AS');
    expect(screen.getByLabelText(/golfer 1, after hole 10 match position.*all square/)).toHaveTextContent('AS');
    expect(screen.getByLabelText(/golfer 1, after hole 11 match position.*1 up/)).toHaveTextContent('1 UP');
    expect(screen.getByText('Thru 4 · 5 holes to play')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open scorecard for Fictional golfer 2' }));
    expect(screen.getByText('1 DN', { selector: 'strong' })).toBeVisible();
    expect(screen.queryByRole('table', { name: 'Front nine scorecard' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Game' }), { target: { value: '' } });
    expect(screen.queryByRole('row', { name: /match position vs/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /match positions/ })).not.toBeInTheDocument();
  });
});
