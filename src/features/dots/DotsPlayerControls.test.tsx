import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DotsGameDefinition, DotsPlayerDeclaration } from '../../domain/dots';
import { dotsSpecialCatalog } from '../../domain/dots';
import { DotsPlayerControls } from './DotsPlayerControls';

const game: DotsGameDefinition = {
  id: 'fictional-game', name: 'Fictional Dots', kind: 'dots', version: 1, mode: 'individual',
  groupNumber: 1, playerIds: ['a', 'b', 'c', 'd'], stakeMinor: null,
  specials: [{ kind: 'hogan', units: 1 }, { kind: 'seve', units: 1 }, { kind: 'sandy', units: 1 }, { kind: 'birdie', units: 2 }],
};
function Editor() {
  const [declaration, setDeclaration] = useState<DotsPlayerDeclaration>({ playerId: 'a', counts: {}, calls: [] });
  return <DotsPlayerControls game={game} declaration={declaration} saved={undefined}
    name="Fictional golfer" par={4} onChange={setDeclaration} />;
}

const compatibleGame: DotsGameDefinition = { ...game,
  specials: dotsSpecialCatalog.map(({ kind }) => ({ kind, units: 1 })) };

function CompatibleEditor({ initial, changed }: {
  readonly initial: DotsPlayerDeclaration;
  readonly changed?: (declaration: DotsPlayerDeclaration) => void;
}) {
  const [declaration, setDeclaration] = useState(initial);
  return <DotsPlayerControls game={compatibleGame} declaration={declaration} saved={initial}
    name="Fictional golfer" par={4} specialLabels={{ dime: 'Sticky' }} allowMurphyPresses
    onChange={(value) => { setDeclaration(value); changed?.(value); }} />;
}

describe('quick per-golfer Dots choices', () => {
  it('offers a scorer-declared Sweep checkbox and custom count without requiring High/Low or gross par', async () => {
    const user = userEvent.setup(), changed = vi.fn<(declaration: DotsPlayerDeclaration) => void>();
    const manual: DotsGameDefinition = { ...game, specials: [{ kind: 'sweep', units: 2 }], sweepRule: 'manual-v1' };
    render(<DotsPlayerControls game={manual} declaration={{ playerId: 'a', counts: {}, calls: [] }}
      saved={undefined} name="Fictional golfer" par={4} score={{ kind: 'picked-up', reportedStrokes: 7 }} onChange={changed} />);
    await user.click(screen.getByLabelText('Sweep for Fictional golfer'));
    expect(changed).toHaveBeenLastCalledWith({ playerId: 'a', counts: { sweep: 1 }, calls: [] });
    await user.click(screen.getByText('Details / edit counts'));
    const count = screen.getByLabelText('Sweep count · Fictional golfer');
    await user.clear(count);
    await user.type(count, '3');
    expect(changed.mock.lastCall?.[0].counts.sweep).toBe(3);
    expect(screen.getByText(/Scorer-declared Sweep; shared with current teammates/)).toBeVisible();
    expect(screen.queryByText(/The same partnered pair wins linked High and Low/)).not.toBeInTheDocument();
  });
  it('prevents missed calls and par-or-better choices in both directions without clearing existing input', async () => {
    const user = userEvent.setup(), changed = vi.fn();
    render(<CompatibleEditor initial={{ playerId: 'a', counts: { sandy: 1 },
      calls: [{ id: 'fictional-paree', kind: 'paree', result: 'pending' }] }} changed={changed} />);
    const paree = screen.getByRole('combobox', { name: 'Paree call 1 · Fictional golfer' });
    expect(within(paree).getByRole('option', { name: 'Failed · Opponents earn' })).toBeDisabled();
    expect(within(paree).getByRole('option', { name: 'Success' })).toBeEnabled();
    await user.selectOptions(paree, 'failure');
    expect(paree).toHaveValue('pending');
    expect(screen.getByLabelText('Sandy count · Fictional golfer')).toHaveValue(1);
    expect(changed).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Decrease Sandy for Fictional golfer' }));
    await user.selectOptions(paree, 'failure');
    expect(paree).toHaveValue('failure');
    expect(screen.getByRole('button', { name: 'Increase Sandy for Fictional golfer' })).toBeDisabled();
    for (const label of ['Hogan', 'Seve', 'Pully', 'Sticky', 'SuperDime', 'Haz Par', 'Chippy']) {
      expect(screen.getByRole('checkbox', { name: `${label} for Fictional golfer` })).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'Increase Other for Fictional golfer' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Call Murphy · Fictional golfer' }));
    const murphy = screen.getByRole('combobox', { name: 'Murphy call 1 · Fictional golfer' });
    expect(within(murphy).getByRole('option', { name: 'Success' })).toBeDisabled();
    await user.selectOptions(murphy, 'success');
    expect(murphy).toHaveValue('pending');
  });

  it('shows legacy conflicts without removing values and allows explicit count repair while preserving presses and call identities', async () => {
    const user = userEvent.setup(), changed = vi.fn();
    const calls: DotsPlayerDeclaration['calls'] = [{ id: 'fictional-murphy', kind: 'murphy', result: 'failure', murphyPresses: 2 }];
    render(<CompatibleEditor initial={{ playerId: 'a', counts: { sandy: 2, dime: 1 }, calls }} changed={changed} />);
    expect(screen.getByRole('alert')).toHaveTextContent('saved values have not been removed');
    const sticky = screen.getByRole('checkbox', { name: 'Sticky for Fictional golfer' });
    expect(sticky).toBeChecked();
    expect(sticky).toBeEnabled();
    expect(screen.getByLabelText('Sandy count · Fictional golfer')).toHaveValue(2);
    expect(screen.getByRole('button', { name: 'Increase Sandy for Fictional golfer' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Murphy press stage 1 · Fictional golfer' })).toHaveValue('2');
    await user.click(sticky);
    await user.click(screen.getByRole('button', { name: 'Decrease Sandy for Fictional golfer' }));
    await user.click(screen.getByRole('button', { name: 'Decrease Sandy for Fictional golfer' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(changed).toHaveBeenLastCalledWith({ playerId: 'a', counts: { sandy: 0, dime: 0 }, calls });
    expect(screen.getByRole('combobox', { name: 'Murphy press stage 1 · Fictional golfer' })).toHaveValue('2');
  });

  it('lets the scorer correct a failed outcome to made without clearing the compatible special', async () => {
    const user = userEvent.setup();
    render(<CompatibleEditor initial={{ playerId: 'a', counts: { sandy: 1 },
      calls: [{ id: 'fictional-paree', kind: 'paree', result: 'failure' }] }} />);
    expect(screen.getByRole('alert')).toBeVisible();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Paree call 1 · Fictional golfer' }), 'success');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Sandy count · Fictional golfer')).toHaveValue(1);
    expect(screen.getByRole('button', { name: 'Increase Sandy for Fictional golfer' })).toBeEnabled();
  });

  it('uses the Sticky alias without emitting a disabled SuperDime claim, but still clears a selected unsaved alternative', async () => {
    const user = userEvent.setup(), onChange = vi.fn<(value: DotsPlayerDeclaration) => void>();
    const props = { game: { ...game, specials: [{ kind: 'dime' as const, units: 1 }] },
      declaration: { playerId: 'a', counts: {}, calls: [] }, saved: undefined,
      name: 'Fictional golfer', par: 4, specialLabels: { dime: 'Sticky' }, onChange };
    const view = render(<DotsPlayerControls {...props} />);
    await user.click(screen.getByRole('checkbox', { name: 'Sticky for Fictional golfer' }));
    expect(onChange).toHaveBeenLastCalledWith({ playerId: 'a', counts: { dime: 1 }, calls: [] });
    expect(screen.queryByRole('checkbox', { name: 'Dime for Fictional golfer' })).not.toBeInTheDocument();
    view.rerender(<DotsPlayerControls {...props}
      game={{ ...game, specials: [{ kind: 'dime', units: 1 }, { kind: 'super-dime', units: 1 }] }}
      declaration={{ playerId: 'a', counts: { 'super-dime': 1 }, calls: [] }} />);
    await user.click(screen.getByRole('checkbox', { name: 'Sticky for Fictional golfer' }));
    expect(onChange).toHaveBeenLastCalledWith({ playerId: 'a', counts: { 'super-dime': 0, dime: 1 }, calls: [] });
  });

  it('keeps common choices and the Sandy counter visible while optional count editing stays collapsed', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    const hogan = screen.getByRole('checkbox', { name: 'Hogan for Fictional golfer' });
    expect(hogan).toBeVisible();
    expect(screen.getByLabelText('Hogan count · Fictional golfer')).not.toBeVisible();
    expect(screen.queryByRole('checkbox', { name: /Birdie/ })).not.toBeInTheDocument();
    await user.click(hogan);
    expect(hogan).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Seve for Fictional golfer' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Increase Sandy for Fictional golfer' }));
    expect(screen.getByLabelText('Sandy count · Fictional golfer')).toHaveValue(1);
    await user.click(screen.getByText('Details / edit counts', { selector: 'summary' }));
    const count = screen.getByLabelText('Hogan count · Fictional golfer');
    expect(count).toBeVisible();
    await user.clear(count);
    await user.type(count, '2');
    expect(count).toHaveValue(2);
    expect(hogan).toBeChecked();
    await user.click(screen.getByText('Details / edit counts', { selector: 'summary' }));
    expect(count).not.toBeVisible();
    expect(screen.getByLabelText('Sandy count · Fictional golfer')).toHaveValue(1);
  });
});
