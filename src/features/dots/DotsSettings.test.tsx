import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DotsSettings } from './DotsSettings';
import type { DotsSetupDraft } from './DotsSettings';
import { dotsFixture } from './dots.test-support';
import { dotsSpecialCatalog } from '../../domain/dots';

describe('Dots special mode compatibility', () => {
  it('explains the selected draft without saving or changing its special values', () => {
    const f = dotsFixture();
    const onChange = vi.fn();
    render(<DotsSettings draft={{ dotsMode: 'fixed', dotsSweepRule: 'manual-v1',
      dotsSpecials: [{ kind: 'sweep', units: 3 }, { kind: 'birdie', units: 2 }] }}
      groups={f.round.groups} players={f.round.cards} wolves={[]} manualSweepSupported onChange={onChange} />);
    fireEvent.click(screen.getByText('How Dots works'));
    const help = screen.getByRole('region', { name: 'Dots game description' });
    const lists = within(help).getAllByRole('list');
    expect(lists[0]).toHaveTextContent('Manual Sweep:');
    expect(lists[1]).toHaveTextContent('Birdie:');
    expect(screen.getByLabelText('Manual Sweep units')).toHaveValue(3);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('forwards advertised special kinds without changing unsupported loaded selections', () => {
    const f = dotsFixture(), onChange = vi.fn<(draft: DotsSetupDraft) => void>();
    const draft: DotsSetupDraft = { dotsMode: 'individual', dotsSpecials: [{ kind: 'other', units: 3 }] };
    const props = { draft, groups: f.round.groups, players: f.round.cards, wolves: [], onChange };
    const view = render(<DotsSettings {...props} />);
    expect(screen.getByLabelText('Other')).toBeChecked();
    expect(screen.getByLabelText('Other units')).toBeDisabled();
    expect(screen.getByLabelText('Other units')).toHaveValue(3);
    expect(onChange).not.toHaveBeenCalled();
    view.rerender(<DotsSettings {...props} supportedKinds={dotsSpecialCatalog.map((entry) => entry.kind)} />);
    expect(screen.getByLabelText('Other units')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Other units'), { target: { value: '5' } });
    expect(onChange).toHaveBeenLastCalledWith({ dotsSpecials: [{ kind: 'other', units: 5 }] });
  });

  it.each([1, 2, 3])('offers %i-player individual groups without enabling any partner mode', (count) => {
    const f = dotsFixture(), ids = f.ids.slice(0, count), onChange = vi.fn<(draft: DotsSetupDraft) => void>();
    function Editor() {
      const [draft, setDraft] = useState<DotsSetupDraft>({ dotsMode: 'individual', stake: '.50' });
      return <DotsSettings draft={draft} groups={[{ number: 1, playerIds: ids }]} players={f.round.cards} wolves={[]}
        v2Supported individualPlayerCounts={[1, 2, 3, 4]}
        onChange={(patch) => { setDraft((current) => ({ ...current, ...patch })); onChange(patch); }} />;
    }
    render(<Editor />);
    fireEvent.change(screen.getByLabelText('Dots playing group'), { target: { value: '1' } });
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ groupNumber: 1, dotsPlayerIds: ids });
    for (const name of ['Fixed partners', 'Link to earned Wolf', /Modified Sixes/, /^Sixes · Change/]) {
      expect(screen.getByRole('option', { name })).toBeDisabled();
    }
    const calls = onChange.mock.calls.length;
    for (const value of ['fixed', 'linked', 'rotating-3', 'rotating-6']) {
      fireEvent.change(screen.getByLabelText('Dots mode'), { target: { value } });
    }
    expect(onChange).toHaveBeenCalledTimes(calls);
    if (count === 1) {
      expect(onChange.mock.lastCall?.[0].stake).toBe('');
      expect(screen.getByText('Solo stats only · No money or opponent payments.')).toBeVisible();
      expect(screen.queryByLabelText('USD per dot difference')).not.toBeInTheDocument();
    } else {
      expect(screen.getByLabelText('USD per dot difference')).toHaveValue('.50');
    }
    expect(screen.getByLabelText('Assassin · Automatic')).toBeDisabled();
    expect(screen.getByLabelText('Sweep · Automatic')).toBeDisabled();
  });

  it('retains a small-group draft on an old API but refuses selecting it without advertised support', () => {
    const f = dotsFixture(), ids = f.ids.slice(0, 2), onChange = vi.fn();
    render(<DotsSettings draft={{ dotsMode: 'individual', groupNumber: 1, dotsPlayerIds: ids, stake: '.50' }}
      groups={[{ number: 1, playerIds: ids }]} players={f.round.cards} wolves={[]} onChange={onChange} />);
    expect(screen.getByRole('option', { name: 'Group 1 · 2 players' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Individual Dots for this group size is temporarily unavailable in this app version');
    expect(screen.getByLabelText('USD per dot difference')).toHaveValue('.50');
    fireEvent.change(screen.getByLabelText('Dots playing group'), { target: { value: '1' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers explicit three/six-hole rotations only with API support, enabling Assassin but never standalone Sweep', () => {
    const f = dotsFixture(), onChange = vi.fn<(draft: DotsSetupDraft) => void>();
    function Editor({ supported = true }: { readonly supported?: boolean }) {
      const [draft, setDraft] = useState<DotsSetupDraft>({ dotsSpecials: [{ kind: 'sandy', units: 3 }] });
      return <DotsSettings draft={draft} groups={f.round.groups} players={f.round.cards} wolves={[]} v2Supported={supported}
        onChange={(patch) => { setDraft((previous) => ({ ...previous, ...patch })); onChange(patch); }} />;
    }
    const view = render(<Editor supported={false} />);
    expect(screen.getByRole('option', { name: /Modified Sixes/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Dots mode'), { target: { value: 'rotating-3' } });
    expect(onChange).not.toHaveBeenCalled();
    view.rerender(<Editor />);
    fireEvent.change(screen.getByLabelText('Dots mode'), { target: { value: 'rotating-3' } });
    expect(onChange).toHaveBeenLastCalledWith({ dotsMode: 'rotating', dotsRotationHoles: 3, dotsVersion: 2, dotsSpecials: [{ kind: 'sandy', units: 3 }] });
    expect(screen.getByLabelText('Assassin · Automatic')).toBeEnabled();
    expect(screen.getByLabelText('Sweep · Automatic')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByLabelText('Sandy units')).toHaveValue(3);
    expect(screen.getByLabelText('Sweep · Automatic')).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Dots mode'), { target: { value: 'rotating-6' } });
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ dotsMode: 'rotating', dotsRotationHoles: 6 });
  });

  it('does not silently upgrade existing v1 rules or downgrade existing rotating v2 rules', () => {
    const f = dotsFixture(), onChange = vi.fn();
    const common = { groups: f.round.groups, players: f.round.cards, wolves: [], v2Supported: true, onChange };
    const view = render(<DotsSettings {...common} draft={{ dotsVersion: 1, dotsMode: 'individual' }} />);
    expect(screen.getByRole('option', { name: /Modified Sixes/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Dots mode'), { target: { value: 'rotating-3' } });
    expect(onChange).not.toHaveBeenCalled();
    view.rerender(<DotsSettings {...common} draft={{ dotsVersion: 2, dotsMode: 'rotating', dotsRotationHoles: 3 }} />);
    expect(screen.getByRole('option', { name: 'Fixed partners' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Dots mode'), { target: { value: 'individual' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(['individual', 'fixed', 'linked'] as const)('selects all available %s specials once without replacing custom values', (mode) => {
    const f = dotsFixture();
    const onChange = vi.fn<(draft: DotsSetupDraft) => void>();
    function Editor() {
      const [draft, setDraft] = useState<DotsSetupDraft>({ dotsMode: mode,
        dotsSpecials: [{ kind: 'sandy', units: 3 }] });
      return <DotsSettings draft={draft} groups={f.round.groups} players={f.round.cards} wolves={[]}
        onChange={(patch) => { setDraft((previous) => ({ ...previous, ...patch })); onChange(patch); }} />;
    }
    render(<Editor />);
    const button = screen.getByRole('button', { name: 'Select all' });
    fireEvent.click(button);
    const selected = onChange.mock.lastCall?.[0].dotsSpecials;
    const expected = dotsSpecialCatalog.filter((special) => special.kind !== 'other'
      && (special.kind !== 'sweep' || mode === 'linked')
      && (special.kind !== 'assassin' || mode !== 'individual')).map((special) => special.kind);
    expect(selected?.map((special) => special.kind).sort()).toEqual([...expected].sort());
    expect(screen.getByLabelText('Sandy units')).toHaveValue(3);
    expect(screen.getByLabelText('Eagle units')).toHaveValue(5);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('reveals one rule description on demand without changing selections or values', () => {
    const f = dotsFixture(), onChange = vi.fn();
    render(<DotsSettings draft={{ dotsSpecials: [{ kind: 'sandy', units: 2 }] }}
      groups={f.round.groups} players={f.round.cards} wolves={[]} onChange={onChange} />);
    const hogan = dotsSpecialCatalog.find((special) => special.kind === 'hogan');
    const seve = dotsSpecialCatalog.find((special) => special.kind === 'seve');
    if (!hogan || !seve) throw new Error('Missing fictional test specials.');
    expect(screen.queryByText(hogan.description)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'About Hogan' }));
    expect(screen.getByText(hogan.description)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'About Seve' }));
    expect(screen.queryByText(hogan.description)).not.toBeInTheDocument();
    expect(screen.getByText(seve.description)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'About Seve' }));
    expect(screen.queryByText(seve.description)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Sandy units')).toHaveValue(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables incompatible specials and removes them only on an explicit change to an incompatible mode', () => {
    const f = dotsFixture();
    const onChange = vi.fn<(draft: DotsSetupDraft) => void>();
    function Editor() {
      const [draft, setDraft] = useState<DotsSetupDraft>({ dotsMode: 'individual', dotsSpecials: [{ kind: 'sandy', units: 2 }] });
      return <DotsSettings draft={draft} groups={f.round.groups} players={f.round.cards} wolves={[]}
        onChange={(patch) => { setDraft((previous) => ({ ...previous, ...patch })); onChange(patch); }} />;
    }
    render(<Editor />);
    expect(screen.getByLabelText('Sweep · Automatic')).toBeDisabled();
    expect(screen.getByLabelText('Assassin · Automatic')).toBeDisabled();
    expect(screen.getByText('Sweep requires a linked game with actual High and Low results.')).toBeVisible();
    expect(screen.getByText('Assassin requires partnered 2-v-2 play, not individual mode.')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Dots mode'), { target: { value: 'fixed' } });
    expect(screen.getByLabelText('Assassin · Automatic')).toBeEnabled();
    expect(screen.getByLabelText('Sweep · Automatic')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Assassin · Automatic'));
    fireEvent.change(screen.getByLabelText('Dots mode'), { target: { value: 'linked' } });
    expect(screen.getByLabelText('Sweep · Automatic')).toBeEnabled();
    fireEvent.click(screen.getByLabelText('Sweep · Automatic'));
    fireEvent.change(screen.getByLabelText('Dots mode'), { target: { value: 'fixed' } });
    expect(onChange.mock.lastCall?.[0].dotsSpecials).toEqual([{ kind: 'sandy', units: 2 }, { kind: 'assassin', units: 1 }]);
    fireEvent.change(screen.getByLabelText('Dots mode'), { target: { value: 'individual' } });
    expect(onChange.mock.lastCall?.[0].dotsSpecials).toEqual([{ kind: 'sandy', units: 2 }]);
    expect(screen.getByLabelText('Sandy units')).toHaveValue(2);
  });

  it('retains incompatible loaded selections across rendering and unrelated edits for explicit review', () => {
    const f = dotsFixture();
    const onChange = vi.fn<(draft: DotsSetupDraft) => void>();
    const draft: DotsSetupDraft = { dotsMode: 'individual', stake: '1.00',
      dotsSpecials: [{ kind: 'sweep', units: 2 }, { kind: 'assassin', units: 3 }] };
    const props = { draft, groups: f.round.groups, players: f.round.cards, wolves: [], onChange };
    const view = render(<DotsSettings {...props} />);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Sweep · Automatic')).toBeChecked();
    expect(screen.getByLabelText('Assassin · Automatic')).toBeChecked();
    expect(screen.getByLabelText('Sweep units')).toBeDisabled();
    expect(screen.getByLabelText('Assassin units')).toHaveValue(3);
    expect(screen.getAllByText(/This saved selection is retained for review/)).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('USD per dot difference'), { target: { value: '0' } });
    expect(onChange).toHaveBeenLastCalledWith({ stake: '0' });
    view.rerender(<DotsSettings {...props} draft={{ ...draft, stake: '0' }} />);
    expect(screen.getByLabelText('Sweep · Automatic')).toBeChecked();
    expect(screen.getByLabelText('Assassin · Automatic')).toBeChecked();
    fireEvent.change(screen.getByLabelText('Dots mode'), { target: { value: 'individual' } });
    expect(onChange).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText('Dots mode'), { target: { value: 'fixed' } });
    expect(onChange).toHaveBeenLastCalledWith({ dotsMode: 'fixed', dotsSpecials: [{ kind: 'assassin', units: 3 }] });
  });
});
