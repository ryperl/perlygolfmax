import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { GameSettings } from './GameSettings';
import { newGameDraft, setFormat } from './game-draft';
import { draftFromGame } from './game-draft';
import { teamLeaderboardGame, teamLeaderboardRound } from '../../client/leaderboard.test-support';
import { fictionalId } from '../../client/catalog.test-support';

function SettingsHarness({ team = false }: { readonly team?: boolean }) {
  const [draft, setDraft] = useState(() => team ? draftFromGame(teamLeaderboardGame) : newGameDraft());
  return <GameSettings draft={draft} onChange={setDraft} onSave={vi.fn()} onCancel={vi.fn()}
    roster={teamLeaderboardRound.cards}
    disabled={false} saveDisabled={false} cancelDisabled={false} retry={false} />;
}

describe('GameSettings', () => {
  it('pages and searches forty-golfer manual team assignments without losing selections or selected choices', async () => {
    const roster = Array.from({ length: 40 }, (_, index) => ({
      playerId: fictionalId(index + 1), displayName: `Fictional golfer ${String(index + 1).padStart(2, '0')}`,
    }));
    function Fixture() {
      const [draft, setDraft] = useState(() => setFormat(newGameDraft(), 'two-net-better-ball', roster.length));
      return <GameSettings draft={draft} roster={roster} disabled={false} saveDisabled={false} cancelDisabled={false}
        retry={false} onChange={setDraft} onSave={vi.fn()} onCancel={vi.fn()} />;
    }
    render(<Fixture />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Team 1 member 1'), fictionalId(1));
    await user.click(screen.getByRole('button', { name: 'Next teams' }));
    await user.selectOptions(screen.getByLabelText('Team 7 member 1'), fictionalId(14));
    await user.type(screen.getByLabelText('Find golfers for member choices'), '40');
    expect(screen.getByLabelText('Team 7 member 1')).toHaveValue(fictionalId(14));
    await user.selectOptions(screen.getByLabelText('Team 7 member 2'), fictionalId(40));
    await user.type(screen.getByLabelText('Find teams or assigned golfers'), 'Team 1');
    expect(screen.getByLabelText('Team 1 member 1')).toHaveValue(fictionalId(1));
    await user.clear(screen.getByLabelText('Find teams or assigned golfers'));
    await user.type(screen.getByLabelText('Find teams or assigned golfers'), 'golfer 14');
    expect(screen.getByLabelText('Team 7 member 1')).toHaveValue(fictionalId(14));
    expect(screen.getByLabelText('Team 7 member 2')).toHaveValue(fictionalId(40));
    expect(screen.getByRole('button', { name: 'Save game' })).toBeDisabled();
    expect(screen.getByText('20 teams · 3/40 golfers assigned')).toBeVisible();
  });
  it('edits name, gross/net, preset, points, and explicit tails using native controls', () => {
    render(<SettingsHarness />);
    expect(screen.getByRole('option', { name: 'Modified Stableford' })).toHaveValue('modified');
    expect(screen.queryByRole('option', { name: /GolfLink/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Handicap allowance (%)')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Score basis'), { target: { value: 'net' } });
    expect(screen.getByLabelText('Handicap allowance (%)')).toHaveValue('95');
    fireEvent.change(screen.getByLabelText('Handicap allowance (%)'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('Game name'), { target: { value: 'Fictional net game' } });
    expect(screen.getByLabelText('Game name')).toHaveValue('Fictional net game');
    fireEvent.change(screen.getByLabelText('Points preset'), { target: { value: 'modified' } });
    expect(screen.getByLabelText('Points at 0 relative to par')).toHaveValue('0');
    expect(screen.getByLabelText('Worse than listed points')).toHaveValue('-2');
    fireEvent.change(screen.getByLabelText('Better than listed points'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add better band' }));
    expect(screen.getByLabelText('Points at -4 relative to par')).toHaveValue('15');
    fireEvent.change(screen.getByLabelText('Points at -4 relative to par'), { target: { value: '-3' } });
    expect(screen.getByLabelText('Points at -4 relative to par')).toHaveValue('-3');
    fireEvent.change(screen.getByLabelText('Worse than listed points'), { target: { value: '-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add worse band' }));
    expect(screen.getByLabelText('Points at 3 relative to par')).toHaveValue('-9');
    expect(screen.getByLabelText('Handicap allowance (%)')).toHaveValue('90');
    expect(screen.getByLabelText('Game name')).toHaveAttribute('maxlength', '100');
  });

  it('supports keyboard focus and horizontal-region access and disables archived/busy inputs', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const view = render(<GameSettings draft={newGameDraft()} onChange={vi.fn()} onSave={vi.fn()} onCancel={onCancel}
      disabled={false} saveDisabled={false} cancelDisabled={false} retry={false} />);
    await user.tab();
    expect(screen.getByLabelText('Game name')).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('Game type')).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('Points preset')).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('Game format')).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('Score basis')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('region', { name: 'Editable points table' })).toHaveFocus();
    view.rerender(<GameSettings draft={newGameDraft()} onChange={vi.fn()} onSave={vi.fn()} onCancel={onCancel}
      disabled saveDisabled cancelDisabled={false} retry />);
    expect(screen.getByLabelText('Game name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel editing' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('requires explicit complete teams, disables assigned choices, and retains partners on preset/same-size changes', () => {
    render(<SettingsHarness />);
    fireEvent.change(screen.getByLabelText('Game format'), { target: { value: 'two-net-better-ball' } });
    expect(screen.getByLabelText('Handicap allowance (%)')).toHaveValue('100');
    expect(screen.getByLabelText('Score basis')).toBeDisabled();
    expect(screen.getByText(/separate from playing groups/)).toBeVisible();
    expect(screen.getByText(/until every teammate/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save game' })).toBeDisabled();
    const roster = teamLeaderboardRound.cards;
    for (let index = 0; index < roster.length; index++) {
      fireEvent.change(screen.getByLabelText(`Team ${String(Math.floor(index / 2) + 1)} member ${String(index % 2 + 1)}`), {
        target: { value: roster[index]?.playerId },
      });
    }
    expect(screen.getByRole('button', { name: 'Save game' })).toBeEnabled();
    const selected = screen.getByLabelText('Team 1 member 1');
    expect(selected).toHaveValue(roster[0]?.playerId);
    expect(screen.getByLabelText('Team 2 member 1').querySelector(`option[value="${roster[0]?.playerId ?? ''}"]`)).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Handicap allowance (%)'), { target: { value: '88' } });
    fireEvent.change(screen.getByLabelText('Game format'), { target: { value: 'two-net-aggregate' } });
    fireEvent.change(screen.getByLabelText('Points preset'), { target: { value: 'modified' } });
    expect(selected).toHaveValue(roster[0]?.playerId);
    expect(screen.getByLabelText('Handicap allowance (%)')).toHaveValue('88');
    fireEvent.change(screen.getByLabelText('Game format'), { target: { value: 'four-two-net' } });
    expect(screen.getByText(/6 golfers cannot form full 4-person teams/)).toBeVisible();
    expect(screen.getByText(/Previous assignments were cleared/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save game' })).toBeDisabled();
    expect(screen.queryByLabelText('Team 1 member 1')).not.toBeInTheDocument();
  });

  it('shows stale selections without IDs and permits replacing an unknown member', () => {
    const old = teamLeaderboardRound.cards[0];
    if (!old) throw new Error('Missing fictional card.');
    const roster = teamLeaderboardRound.cards.map((card, index) => index === 0 ? { ...card, playerId: fictionalId(950), displayName: 'Fictional replacement' } : card);
    function RepairHarness() {
      const [draft, setDraft] = useState(() => draftFromGame(teamLeaderboardGame));
      return <GameSettings draft={draft} roster={roster} disabled={false} saveDisabled={false} cancelDisabled={false}
        retry={false} onChange={setDraft} onSave={vi.fn()} onCancel={vi.fn()} />;
    }
    const { container } = render(<RepairHarness />);
    expect(screen.getByText(/A selected golfer is no longer/)).toBeVisible();
    expect(container.textContent).not.toContain(old.playerId);
    expect(screen.getByRole('button', { name: 'Save game' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Team 1 member 1'), { target: { value: fictionalId(950) } });
    expect(screen.queryByText(/A selected golfer is no longer/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save game' })).toBeEnabled();
  });

  it('repairs roster-size changes by explicitly resetting empty slots, never auto-pairing golfers', () => {
    function ResizedHarness() {
      const [draft, setDraft] = useState(() => draftFromGame(teamLeaderboardGame));
      return <GameSettings draft={draft} roster={teamLeaderboardRound.cards.slice(0, 4)} disabled={false}
        saveDisabled={false} cancelDisabled={false} retry={false} onChange={setDraft} onSave={vi.fn()} onCancel={vi.fn()} />;
    }
    render(<ResizedHarness />);
    expect(screen.getByLabelText('Team 3 member 1')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save game' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset team assignments' }));
    expect(screen.queryByLabelText('Team 3 member 1')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Team 1 member 1')).toHaveValue('');
    expect(screen.getByLabelText('Team 2 member 2')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save game' })).toBeDisabled();
  });
});
