import { useId, useState } from 'react';
import type { DotPreset, DotPresetStore } from '../../client/dot-presets';
import { DotPresetStorageError } from '../../client/dot-presets';
import type { DotsGameDefinition, DotsSpecialKind, DotsSpecialSelection } from '../../domain/dots';
import { allDotSelections, builtInDotPresets, dotSpecialLabel, dotSpecialModeCompatible } from './dot-preset-options';

interface LoadedPresets {
  readonly store: DotPresetStore | undefined;
  readonly entries: readonly DotPreset[];
  readonly error: string | null;
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Device presets could not be read. Retry reading.';
function readPresets(store: DotPresetStore | undefined): LoadedPresets {
  try { return { store, entries: store?.load() ?? [], error: null }; }
  catch (error) { return { store, entries: [], error: errorMessage(error) }; }
}

export function DotPresetControls({ specials, mode, supportedKinds, context, onChange, store, manualSweep = false }: {
  readonly specials: readonly DotsSpecialSelection[];
  readonly mode: DotsGameDefinition['mode'];
  readonly supportedKinds: readonly DotsSpecialKind[];
  readonly context: 'dots' | 'churcie';
  readonly onChange: (specials: readonly DotsSpecialSelection[]) => void;
  readonly store: DotPresetStore | undefined;
  readonly manualSweep?: boolean;
}) {
  const [loaded, setLoaded] = useState(() => readPresets(store));
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [writeBlocked, setWriteBlocked] = useState(false);
  const [saved, setSaved] = useState(false);
  const id = useId();
  if (loaded.store !== store) setLoaded(readPresets(store));
  const custom = loaded.store === store ? loaded.entries : [];
  const selectedPreset = selected.startsWith('built-in:')
    ? builtInDotPresets.find((preset) => `built-in:${preset.id}` === selected)
    : custom.find((preset) => `device:${preset.id}` === selected);
  const common = selected === 'built-in:dots-common';
  const incompatible = common ? [] : selectedPreset?.specials.filter((special) => !supportedKinds.includes(special.kind)
    || !dotSpecialModeCompatible(special.kind, mode, manualSweep)) ?? [];
  return <div className="dot-presets">
    <div className="dot-preset-apply">
      <label>Specials preset<select value={selected} onChange={(event) => { setSelected(event.target.value); }}>
        <option value="">Choose preset</option>
        <optgroup label="Built-in">{builtInDotPresets.map((preset) =>
          <option key={preset.id} value={`built-in:${preset.id}`}>{preset.name}</option>)}</optgroup>
        {custom.length > 0 && <optgroup label="This device">{custom.map((preset) =>
          <option key={preset.id} value={`device:${preset.id}`}>{preset.name}</option>)}</optgroup>}
      </select></label>
      <button type="button" disabled={!selectedPreset || incompatible.length > 0} onClick={() => {
        if (selectedPreset && incompatible.length === 0) onChange(common
          ? allDotSelections(specials, mode, supportedKinds, context, manualSweep)
          : selectedPreset.specials.map((special) => ({ ...special })));
      }}>Apply preset</button>
    </div>
    {incompatible.length > 0 && <small role="status">Cannot apply: {incompatible.map((special) =>
      `${dotSpecialLabel(special.kind, context)} (${supportedKinds.includes(special.kind) ? 'not available in this mode' : 'not supported by this API'})`).join(', ')}.
      {' '}No specials have been removed.</small>}
    <details className="dot-preset-custom">
      <summary>Save a device preset</summary>
      <small>Only enabled specials and units. Stored on this device, not shared or linked to games.</small>
      <div className="dot-preset-save">
        <label htmlFor={`${id}-name`}>Preset name</label>
        <input id={`${id}-name`} maxLength={60} value={name} onChange={(event) => {
          setName(event.target.value); setSaved(false);
        }} />
        <button type="button" disabled={!store || loaded.error !== null || writeBlocked || !name.trim()} onClick={() => {
          if (!store || loaded.error !== null || writeBlocked) return;
          setSaved(false);
          const trimmed = name.trim();
          const entry: DotPreset = { id: `custom-${trimmed.toLowerCase()}`, name: trimmed,
            specials: specials.map((special) => ({ ...special })) };
          try {
            store.save(entry);
            setLoaded({ store, entries: [...custom, entry], error: null });
            setSaveError(null);
            setSaved(true);
          } catch (error) {
            setSaveError(errorMessage(error));
            setWriteBlocked(!(error instanceof DotPresetStorageError) || !['duplicate', 'invalid'].includes(error.code));
          }
        }}>Save new preset</button>
      </div>
      {saved && <small role="status">Preset saved on this device.</small>}
    </details>
    {!store && <small>Custom presets unavailable here. Built-in presets still work.</small>}
    {loaded.error !== null && <small role="alert">{loaded.error}</small>}
    {saveError !== null && <small role="alert">{saveError}</small>}
    {store && (loaded.error !== null || saveError !== null) && <button type="button" onClick={() => {
      setLoaded(readPresets(store)); setSaveError(null); setSaved(false); setWriteBlocked(false);
    }}>Retry reading presets</button>}
  </div>;
}
