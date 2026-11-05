import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fictionalId, fictionalPlayers, fictionalWorkspace } from '../../client/catalog.test-support';
import type { PlayerProfile } from '../../domain/catalog';
import { SetupRoster } from './SetupRoster';

function renderRoster(selectedIds: readonly string[] = [], players: readonly PlayerProfile[] = fictionalPlayers) {
  const changed = vi.fn();
  function Fixture() {
    const [ids, setIds] = useState(selectedIds);
    return <SetupRoster players={players} selectedIds={ids} savedRoster={fictionalWorkspace.roster} locked={false}
      onChange={(value) => { changed(value); setIds(value); }} />;
  }
  render(<Fixture />);
  return changed;
}

describe('setup roster selection', () => {
  it('filters names case-insensitively while retaining selected players and their checkbox focus', async () => {
    const changed = renderRoster([fictionalId(3)]);
    const user = userEvent.setup();
    const search = screen.getByRole('searchbox', { name: 'Find players' });
    await user.type(search, 'PLAYER 1');
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByLabelText('Fictional Player 3 — HI Unknown')).toBeChecked();
    const first = screen.getByLabelText('Fictional Player 1 — HI Unknown');
    await user.click(first);
    expect(first).toHaveFocus();
    expect(first).toBeChecked();
    expect(changed).toHaveBeenLastCalledWith([fictionalId(3), fictionalId(1)]);
    await user.clear(search);
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
    const choices = within(screen.getByRole('group', { name: 'Player choices' })).getAllByRole('checkbox');
    expect(choices[0]).toBe(screen.getByLabelText('Fictional Player 1 — HI Unknown'));
    expect(choices[1]).toBe(screen.getByLabelText('Fictional Player 3 — HI Unknown'));
  });

  it('shows no-match results without clearing selections or inventing a zero index', async () => {
    renderRoster([fictionalId(1)]);
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox'), 'no fictional match');
    expect(screen.getByText('No other players match your search. Selected players stay above.')).toBeVisible();
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('allows a ninth player without imposing a roster cap', async () => {
    const players = Array.from({ length: 9 }, (_, i) => ({
      id: fictionalId(i + 1), displayName: `Fictional Player ${String(i + 1)}`,
      currentIndex: null, etag: 'player-v1', createdAt: '2026-01-01',
    }));
    renderRoster(players.slice(0, 8).map((player) => player.id), players);
    const user = userEvent.setup();
    const ninth = screen.getByLabelText('Fictional Player 9 — HI Unknown');
    expect(ninth).toBeEnabled();
    await user.click(ninth);
    expect(ninth).toBeChecked();
    expect(screen.getByLabelText('Fictional Player 1 — HI Unknown')).toBeEnabled();
    expect(screen.getByText('Saved player roster (9 selected)')).toBeVisible();
  });

  it('pages a large roster without losing selected players when searching or changing pages', async () => {
    const players = Array.from({ length: 40 }, (_, i) => ({
      ...fictionalPlayers[0], id: fictionalId(i + 1), displayName: `Fictional golfer ${String(i + 1).padStart(2, '0')}`,
      currentIndex: null, etag: 'player-v1', createdAt: '2026-01-01',
    }));
    const changed = renderRoster(players.slice(0, 20).map((player) => player.id), players);
    const user = userEvent.setup();
    expect(screen.getAllByRole('checkbox')).toHaveLength(24);
    await user.click(screen.getByRole('button', { name: 'Next selected players' }));
    expect(screen.getByLabelText('Fictional golfer 20 — HI Unknown')).toBeChecked();
    await user.type(screen.getByRole('searchbox'), '40');
    await user.click(screen.getByLabelText('Fictional golfer 40 — HI Unknown'));
    expect(changed).toHaveBeenLastCalledWith([...players.slice(0, 20).map((player) => player.id), fictionalId(40)]);
    await user.clear(screen.getByRole('searchbox'));
    expect(screen.getByLabelText('Fictional golfer 40 — HI Unknown')).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Previous selected players' }));
    expect(screen.getByLabelText('Fictional golfer 01 — HI Unknown')).toBeChecked();
  });

  it('keeps a locked roster read-only and shows unavailable saved selections explicitly', () => {
    const changed = vi.fn();
    render(<SetupRoster players={fictionalPlayers.slice(0, 3)} selectedIds={fictionalWorkspace.roster.map((player) => player.playerId)}
      savedRoster={fictionalWorkspace.roster} locked onChange={changed} />);
    expect(screen.getByText('Saved roster player unavailable in catalog: Fictional Player 4')).toBeVisible();
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
  });

  it('lets a locked large roster page through saved selections while keeping every checkbox disabled', async () => {
    const players = Array.from({ length: 40 }, (_, index) => ({
      id: fictionalId(index + 1), displayName: `Fictional golfer ${String(index + 1)}`,
      currentIndex: null, etag: 'player-v1', createdAt: '2026-01-01',
    }));
    render(<SetupRoster players={players} selectedIds={players.map((player) => player.id)} savedRoster={[]}
      locked onChange={vi.fn()} />);
    const user = userEvent.setup();
    expect(screen.getByRole('group', { name: 'Saved player roster (40 selected)' })).toBeDisabled();
    const next = screen.getByRole('button', { name: 'Next selected players' });
    expect(next).toBeEnabled();
    await user.click(next);
    expect(screen.getByLabelText('Fictional golfer 13 — HI Unknown')).toBeChecked();
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled();
  });

  it('does not imply a missing catalog is an empty roster and does not submit a form on search Enter', async () => {
    const submit = vi.fn();
    render(<form onSubmit={(event) => { event.preventDefault(); submit(); }}><SetupRoster players={[]} selectedIds={[fictionalId(1)]}
      savedRoster={fictionalWorkspace.roster} locked={false} onChange={vi.fn()} /><button>Save</button></form>);
    expect(screen.getByText('Saved roster player unavailable in catalog: Fictional Player 1')).toBeVisible();
    expect(screen.getByText('No saved players. Create players in the manager catalog first.')).toBeVisible();
    expect(screen.queryByText('No players selected.')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox'), 'Fictional{Enter}');
    expect(submit).not.toHaveBeenCalled();
  });
});
