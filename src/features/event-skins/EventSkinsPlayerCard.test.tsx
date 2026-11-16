import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EventSkinsBoard } from './EventSkinsBoard';
import { eventSkinsFixture } from '../../domain/event-skins.test-support';
import { calculateEventSkins } from '../../domain/event-skins';

describe('compact golfer skins tickets', () => {
  it('expands only saved wins by configured round, preserves round accents and retains expansion through refreshed totals', async () => {
    const f = eventSkinsFixture(undefined, undefined, 3);
    const results = calculateEventSkins(f.workspace, f.rounds);
    const value = { workspace: f.workspace, eventSkins: results };
    const before = JSON.stringify(value);
    const view = render(<EventSkinsBoard value={value} />);
    const player = results.players[0];
    if (!player) throw new Error('Missing fixture');
    const card = within(screen.getByRole('article', { name: `Skins for ${player.displayName}` }));
    expect(card.getByLabelText('Position 1')).toBeVisible();
    expect(card.getByText('3 winning rounds')).toBeVisible();
    const control = card.getByLabelText(`View winning holes for ${player.displayName} (3)`);
    const first = f.workspace.rounds[0];
    if (!first) throw new Error('Missing fixture round');
    expect(card.getByText(first.name)).not.toBeVisible();
    await userEvent.click(control);
    expect(card.getByLabelText(`Hide winning holes for ${player.displayName} (3)`)).toBeVisible();
    for (const round of f.workspace.rounds) {
      expect(card.getByText(round.name)).toBeVisible();
      expect(within(card.getByRole('list', { name: `Won holes at ${round.name}` })).getAllByRole('listitem'))
        .toHaveLength(1);
    }
    expect(card.queryByText('Hole 2')).not.toBeInTheDocument();
    expect(card.getByText(first.name).closest('[data-round-tone]')).toHaveAttribute('data-round-tone', 'sage');
    view.rerender(<EventSkinsBoard value={{ ...value, eventSkins: { ...results, players: [...results.players] } }} />);
    expect(card.getByText(first.name)).toBeVisible();
    expect(JSON.stringify(value)).toBe(before);
  });
  it('preserves tied server positions rather than using display order as a tie-break', () => {
    const f = eventSkinsFixture(undefined, undefined, 2);
    const rounds = f.rounds.map((round, index) => index === 0 ? round : { ...round, cards: round.cards.map((card, player) => ({
      ...card, holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score: { kind: 'strokes' as const, strokes: player === 1 ? 2 : 6 } } : hole),
    })) });
    const results = calculateEventSkins(f.workspace, rounds);
    render(<EventSkinsBoard value={{ workspace: f.workspace, eventSkins: results }} />);
    expect(screen.getAllByLabelText('Position T1')).toHaveLength(2);
    expect(screen.getAllByText('1 winning round')).toHaveLength(2);
  });
  it('shows known-zero provisional golfers without a fake rank or empty winning-hole control', () => {
    const f = eventSkinsFixture([{ kind: 'unplayed' }, { kind: 'strokes', strokes: 4 }], ['0', '0']);
    render(<EventSkinsBoard value={{ workspace: f.workspace, eventSkins: calculateEventSkins(f.workspace, f.rounds) }} />);
    expect(screen.getAllByText('Awaiting remaining holes')).toHaveLength(2);
    expect(screen.queryByLabelText(/Position/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/View winning holes/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });
});
