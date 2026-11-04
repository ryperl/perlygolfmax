import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { GameSettings } from './GameSettings';
import { newGameDraft } from './game-draft';

function SettingsHarness() {
  const [draft, setDraft] = useState(newGameDraft);
  return <GameSettings draft={draft} onChange={setDraft} onSave={vi.fn()} onCancel={vi.fn()}
    disabled={false} saveDisabled={false} cancelDisabled={false} retry={false} />;
}

describe('GameSettings', () => {
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
    expect(screen.getByLabelText('Points preset')).toHaveFocus();
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
});
