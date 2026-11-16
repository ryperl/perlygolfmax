import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EventSkinsBoard } from './index';
import { eventSkinsFixture, withoutEventSkins } from '../../domain/event-skins.test-support';
import { calculateEventSkins } from '../../domain/event-skins';
import { calculateEventStandings } from '../../domain/event-leaderboard';
import type { RoundScores } from '../../domain/scoring';

function fixture() {
  const f = eventSkinsFixture();
  const value = (rounds: readonly RoundScores[] = f.rounds) => ({ workspace: f.workspace, roundScores: rounds,
    standings: calculateEventStandings(f.workspace, rounds), eventSkins: calculateEventSkins(f.workspace, rounds) });
  return { ...f, value };
}
describe('saved event skins board', () => {
  it('shows won holes only and expandable rules, hides known zero winners and reveals a refreshed winner without hidden search state', async () => {
    const f = fixture();
    const view = render(<EventSkinsBoard value={f.value()} />);
    expect(screen.getByText(/Only when net ties, actual gross birdie or better/)).not.toBeVisible();
    await userEvent.click(screen.getByText('Skins rules'));
    expect(screen.getByText(/Only when net ties, actual gross birdie or better/)).toBeVisible();
    expect(screen.getByText(/Gross par ties stay tied/)).toBeVisible();
    const board = screen.getByRole('list', { name: 'Event skins standings' });
    expect(within(board).getByRole('heading', { name: /Fictional golfer 1/ })).toBeVisible();
    expect(within(board).queryByRole('heading', { name: /Fictional golfer 2/ })).not.toBeInTheDocument();
    const rounds = f.rounds.map((round) => ({ ...round, cards: round.cards.map((card, index) => ({
      ...card, holes: card.holes.map((hole) => hole.number === 1
        ? { ...hole, score: { kind: 'strokes' as const, strokes: index === 1 ? 2 : 5 } } : hole),
    })) }));
    view.rerender(<EventSkinsBoard value={f.value(rounds)} />);
    expect(within(board).getByRole('heading', { name: /Fictional golfer 2/ })).toBeVisible();
    expect(within(board).queryByRole('heading', { name: /Fictional golfer 1/ })).not.toBeInTheDocument();
    expect(f.value().eventSkins.players).toHaveLength(2);
  });
  it('keeps pending and unavailable zero-win players visible without inventing final totals, and no purse navigation without an authoritative hint', () => {
    const f = eventSkinsFixture([{ kind: 'unplayed' }, { kind: 'strokes', strokes: 4 }], ['0', '18']);
    const value = { workspace: f.workspace, roundScores: f.rounds, standings: calculateEventStandings(f.workspace, f.rounds),
      eventSkins: calculateEventSkins(f.workspace, f.rounds) };
    const view = render(<EventSkinsBoard value={value} />);
    expect(screen.getByRole('status')).toHaveTextContent('Provisional');
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
    expect(screen.queryByRole('link', { name: /purse/ })).not.toBeInTheDocument();
    view.rerender(<EventSkinsBoard value={{ ...value, workspace: { ...value.workspace, purseConfigured: true } }} />);
    expect(screen.getByRole('link', { name: /purse/ })).toHaveAttribute('href', expect.stringContaining('#purse?event='));
    const unavailable = eventSkinsFixture([{ kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 4 }], ['0', null]);
    view.rerender(<EventSkinsBoard value={{ ...value, workspace: unavailable.workspace,
      eventSkins: calculateEventSkins(unavailable.workspace, unavailable.rounds) }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Unavailable inputs');
    expect(screen.getAllByText(/0 known skins · complete total unavailable/)).toHaveLength(2);
  });
  it('distinguishes unsupported, unconfigured, unavailable and all-no-winners states', () => {
    const f = fixture();
    const value = f.value();
    const view = render(<EventSkinsBoard value={{ ...value, workspace: withoutEventSkins(value.workspace) }} />);
    expect(screen.getByText(/not supported by this API/)).toBeVisible();
    view.rerender(<EventSkinsBoard value={{ ...value, workspace: { ...withoutEventSkins(value.workspace), eventSkinsSupported: true } }} />);
    expect(screen.getByText('Event skins is not configured.')).toBeVisible();
    const { eventSkins, ...missing } = value;
    void eventSkins;
    view.rerender(<EventSkinsBoard value={missing} />);
    expect(screen.getByRole('alert')).toHaveTextContent('unavailable');
    const allTied = eventSkinsFixture([{ kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 4 }], ['0', '0']);
    view.rerender(<EventSkinsBoard value={{ ...value, workspace: allTied.workspace,
      eventSkins: calculateEventSkins(allTied.workspace, allTied.rounds) }} />);
    expect(screen.getByText(/No skins won/)).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('not round finalization');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
