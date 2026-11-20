import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createLocalDotPresetStore } from '../../client/dot-presets';
import type { DotPresetStore } from '../../client/dot-presets';
import { defaultChurchySpecialSelections } from '../../domain/churchy';
import { dotsSpecialCatalog } from '../../domain/dots';
import type { DotsSpecialSelection } from '../../domain/dots';
import { DotSpecialsSettings } from './DotSpecialsSettings';
import type { DotSpecialsSettingsProps } from './DotSpecialsSettings';

const allKinds = dotsSpecialCatalog.map((special) => special.kind);
function Editor({ onChange, ...props }: Omit<DotSpecialsSettingsProps, 'specials'>) {
  const [specials, setSpecials] = useState<readonly DotsSpecialSelection[]>([{ kind: 'sandy', units: 7 }]);
  return <DotSpecialsSettings {...props} specials={specials} onChange={(next) => {
    setSpecials(next); onChange(next);
  }} />;
}

describe('shared specials setup and presets', () => {
  it('makes Dots common select every available dot, preserving custom units and skipping incompatible choices', () => {
    const onChange = vi.fn();
    render(<Editor mode="individual" supportedKinds={allKinds} manualSweep onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Specials preset'), { target: { value: 'built-in:dots-common' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply preset' }));
    const checkboxes = screen.getAllByRole('checkbox');
    for (const checkbox of checkboxes.filter((input) => !input.hasAttribute('disabled'))) expect(checkbox).toBeChecked();
    expect(screen.getByLabelText('Assassin · Automatic')).not.toBeChecked();
    expect(screen.getByLabelText('Sweep')).toBeChecked();
    expect(screen.queryByLabelText('Sweep · Automatic')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Sandy units')).toHaveValue(7);
    expect(screen.getByLabelText('Other')).toBeChecked();
    expect(onChange.mock.lastCall?.[0]).toHaveLength(allKinds.length - 1);
  });

  it('applies all supported common choices on an older API without trying to select unavailable Sweep or Other', () => {
    const onChange = vi.fn();
    render(<Editor mode="fixed" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Specials preset'), { target: { value: 'built-in:dots-common' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply preset' }));
    expect(screen.getByLabelText('Sweep · Automatic')).toBeDisabled();
    expect(screen.getByLabelText('Sweep · Automatic')).not.toBeChecked();
    expect(screen.getByLabelText('Other')).not.toBeChecked();
    expect(screen.getByLabelText('Assassin · Automatic')).toBeChecked();
    expect(screen.getByLabelText('Blue Plate')).toBeChecked();
    expect(screen.getByLabelText('Sandy units')).toHaveValue(7);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('explains automatic same-golfer category sweeps only for ordinary Dots, without a new setting or changed High/Low selection', () => {
    const onChange = vi.fn();
    const specials: readonly DotsSpecialSelection[] = [{ kind: 'long-drive', units: 4 }, { kind: 'blue-plate', units: 2 }];
    const view = render(<DotSpecialsSettings mode="individual" specials={specials} onChange={onChange} />);
    expect(screen.getByText(/Category sweep: the same golfer/)).toHaveTextContent('Carries do not increase this bonus');
    expect(screen.queryByLabelText('Category Sweep')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Sweep · Automatic')).not.toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
    view.rerender(<DotSpecialsSettings mode="linked" specials={specials} context="churcie" onChange={onChange} />);
    expect(screen.queryByText(/Category sweep: the same golfer/)).not.toBeInTheDocument();
    view.rerender(<DotSpecialsSettings mode="individual" specials={specials.slice(0, 1)} onChange={onChange} />);
    expect(screen.queryByText(/Category sweep: the same golfer/)).not.toBeInTheDocument();
  });
  it('aliases only canonical Dime as Sticky in Churchie and retains custom units while selecting all compatible specials', () => {
    const onChange = vi.fn<DotSpecialsSettingsProps['onChange']>();
    render(<Editor mode="linked" context="churcie" supportedKinds={allKinds} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Dime')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Sticky'));
    expect(onChange.mock.lastCall?.[0]).toContainEqual({ kind: 'dime', units: 1 });
    fireEvent.change(screen.getByLabelText('Sticky units'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(onChange.mock.lastCall?.[0]).toHaveLength(allKinds.length);
    expect(screen.getByLabelText('Sticky units')).toHaveValue(4);
    expect(screen.getByLabelText('Sandy units')).toHaveValue(7);
    expect(screen.getByLabelText('Eagle units')).toHaveValue(4);
    expect(screen.getByLabelText('Assassin · Automatic')).toBeChecked();
    expect(screen.getByLabelText('Sweep · Automatic')).toBeChecked();
    expect(screen.getByLabelText('Other')).toBeChecked();
  });

  it('copies the explicitly applied preset without implicit changes or live bindings', () => {
    const onChange = vi.fn<DotSpecialsSettingsProps['onChange']>();
    render(<Editor mode="linked" context="churcie" supportedKinds={allKinds} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Specials preset'), { target: { value: 'built-in:churcie-default' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Sandy units')).toHaveValue(7);
    expect(screen.getByLabelText('KP')).not.toBeChecked();
    expect(screen.getByLabelText('Blue Plate')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Apply preset' }));
    expect(screen.getByLabelText('KP')).toBeChecked();
    expect(screen.getByLabelText('Blue Plate')).toBeChecked();
    expect(screen.getByLabelText('KP units')).toHaveValue(1);
    expect(screen.getByLabelText('Blue Plate units')).toHaveValue(1);
    const first = onChange.mock.lastCall?.[0];
    expect(first).toEqual(defaultChurchySpecialSelections);
    expect(first).not.toBe(defaultChurchySpecialSelections);
    expect(first?.[0]).not.toBe(defaultChurchySpecialSelections[0]);
    fireEvent.change(screen.getByLabelText('Eagle units'), { target: { value: '9' } });
    expect(defaultChurchySpecialSelections.find((entry) => entry.kind === 'eagle')?.units).toBe(4);
    fireEvent.click(screen.getByRole('button', { name: 'Apply preset' }));
    expect(onChange.mock.lastCall?.[0]).toEqual(defaultChurchySpecialSelections);
    expect(onChange.mock.lastCall?.[0]).not.toBe(first);
    fireEvent.change(screen.getByLabelText('Specials preset'), { target: { value: 'built-in:dots-common' } });
    expect(screen.getByLabelText('Eagle units')).toHaveValue(4);
    fireEvent.click(screen.getByRole('button', { name: 'Apply preset' }));
    expect(screen.getByLabelText('Eagle units')).toHaveValue(4);
    expect(screen.getByLabelText('Birdie units')).toHaveValue(2);
  });

  it('refuses incompatible presets without dropping awards, and defaults old APIs to no Other', () => {
    const onChange = vi.fn();
    const view = render(<Editor mode="individual" onChange={onChange} />);
    expect(screen.getByLabelText('Other')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Specials preset'), { target: { value: 'built-in:churcie-default' } });
    expect(screen.getByRole('button', { name: 'Apply preset' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Sweep (not available in this mode)');
    expect(screen.getByRole('status')).toHaveTextContent('Other (not supported by this API)');
    fireEvent.click(screen.getByRole('button', { name: 'Apply preset' }));
    expect(onChange).not.toHaveBeenCalled();
    view.rerender(<Editor mode="linked" supportedKinds={allKinds} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Apply preset' })).toBeEnabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('saves device-only snapshots and reuses them after remount without applying during reads', () => {
    let value: string | null = null;
    const store = createLocalDotPresetStore({ getItem: () => value, setItem: (_key, next) => { value = next; } });
    const onChange = vi.fn();
    const view = render(<Editor mode="individual" presetStore={store} onChange={onChange} />);
    fireEvent.click(screen.getByText('Save a device preset'));
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'Practice set' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new preset' }));
    expect(screen.getByRole('status')).toHaveTextContent('Preset saved on this device');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Sandy units'), { target: { value: '9' } });
    view.unmount();
    onChange.mockClear();
    render(<Editor mode="individual" presetStore={store} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Specials preset'), { target: { value: 'device:custom-practice set' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply preset' }));
    expect(onChange).toHaveBeenCalledWith([{ kind: 'sandy', units: 7 }]);
  });

  it('retains the editor and name after storage failure, blocks saving until retry, and keeps built-ins usable', () => {
    const store: DotPresetStore = { load: vi.fn(() => []), save: vi.fn(() => { throw new Error('Device storage is full.'); }) };
    const onChange = vi.fn();
    render(<Editor mode="linked" supportedKinds={allKinds} presetStore={store} onChange={onChange} />);
    fireEvent.click(screen.getByText('Save a device preset'));
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'My set' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new preset' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Device storage is full.');
    expect(screen.getByRole('button', { name: 'Save new preset' })).toBeDisabled();
    expect(screen.getByLabelText('Preset name')).toHaveValue('My set');
    expect(screen.getByLabelText('Sandy units')).toHaveValue(7);
    fireEvent.change(screen.getByLabelText('Specials preset'), { target: { value: 'built-in:dots-common' } });
    expect(screen.getByRole('button', { name: 'Apply preset' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry reading presets' }));
    expect(screen.getByRole('button', { name: 'Save new preset' })).toBeEnabled();
    expect(screen.getByLabelText('Preset name')).toHaveValue('My set');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('surfaces corrupt/blocked initial reads, retries without changing drafts, and explains an absent store', () => {
    const load = vi.fn<DotPresetStore['load']>(() => { throw new Error('Device presets are unreadable.'); });
    const store: DotPresetStore = { load, save: vi.fn() }, onChange = vi.fn();
    const view = render(<Editor mode="linked" supportedKinds={allKinds} presetStore={store} onChange={onChange} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Device presets are unreadable.');
    fireEvent.click(screen.getByText('Save a device preset'));
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'Retained' } });
    expect(screen.getByRole('button', { name: 'Save new preset' })).toBeDisabled();
    load.mockReturnValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry reading presets' }));
    expect(screen.getByLabelText('Preset name')).toHaveValue('Retained');
    expect(screen.getByLabelText('Sandy units')).toHaveValue(7);
    expect(screen.getByRole('button', { name: 'Save new preset' })).toBeEnabled();
    view.rerender(<Editor mode="linked" onChange={onChange} />);
    expect(screen.getByText('Custom presets unavailable here. Built-in presets still work.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save new preset' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
