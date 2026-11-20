import { useId, useState } from 'react';
import { dotsSpecialCatalog } from '../../domain/dots';
import { defaultChurchySpecialSelections } from '../../domain/churchy';
import type { DotsGameDefinition, DotsSpecialKind, DotsSpecialSelection } from '../../domain/dots';
import type { DotPresetStore } from '../../client/dot-presets';
import { DotPresetControls } from './DotPresetControls';
import { allDotSelections, dotSpecialLabel, dotSpecialModeCompatible, legacyDotsSpecialKinds } from './dot-preset-options';
import './dots-settings.css';

export interface DotSpecialsSettingsProps {
  readonly specials: readonly DotsSpecialSelection[];
  readonly mode: DotsGameDefinition['mode'];
  readonly onChange: (specials: readonly DotsSpecialSelection[]) => void;
  readonly supportedKinds?: readonly DotsSpecialKind[];
  readonly context?: 'dots' | 'churcie';
  readonly presetStore?: DotPresetStore;
  readonly manualSweep?: boolean;
}

export function DotSpecialsSettings({ specials, mode, onChange, supportedKinds = legacyDotsSpecialKinds,
  context = 'dots', presetStore, manualSweep = false }: DotSpecialsSettingsProps) {
  const [expanded, setExpanded] = useState<DotsSpecialKind | null>(null);
  const helpId = useId();
  const defaults = context === 'churcie' ? builtInDefaultUnits : undefined;
  const available = dotsSpecialCatalog.filter((special) => supportedKinds.includes(special.kind)
    && dotSpecialModeCompatible(special.kind, mode, manualSweep));
  const allSelected = available.every((special) => specials.some((entry) => entry.kind === special.kind));
  return <fieldset className="dots-specials" aria-label="Enabled specials and whole-dot units">
    <legend>Specials</legend>
    {context === 'dots' && specials.some((special) => special.kind === 'long-drive')
      && specials.some((special) => special.kind === 'blue-plate') && <p>
        Category sweep: the same golfer winning Long Drive and Blue Plate on a hole earns 1 extra dot,
        shared with current teammates. Carries do not increase this bonus. Separate from linked High/Low Sweep.
      </p>}
    <DotPresetControls specials={specials} mode={mode} supportedKinds={supportedKinds} context={context} manualSweep={manualSweep}
      onChange={onChange} store={presetStore} />
    <div className="dots-specials-toolbar">
      <small>{specials.length} selected · Whole-dot values</small>
      <button type="button" disabled={allSelected} onClick={() => {
        onChange(allDotSelections(specials, mode, supportedKinds, context, manualSweep));
      }}>Select all</button>
    </div>
    <div className="dots-specials-grid">{dotsSpecialCatalog.map((special) => {
      const selected = specials.find((entry) => entry.kind === special.kind);
      const unsupported = !supportedKinds.includes(special.kind);
      const incompatible = unsupported || !dotSpecialModeCompatible(special.kind, mode, manualSweep);
      const label = dotSpecialLabel(special.kind, context);
      const automatic = special.automatic && !(context === 'dots' && manualSweep && special.kind === 'sweep');
      const descriptionId = `${helpId}-${special.kind}`;
      return <div className="dots-special" key={special.kind}>
        <div className="dots-special-row">
          <label className="dots-special-toggle"><input type="checkbox" checked={selected !== undefined}
            aria-label={`${label}${automatic ? ' · Automatic' : ''}`} disabled={incompatible}
            onChange={(event) => { onChange(event.target.checked
              ? [...specials, { kind: special.kind, units: defaults?.get(special.kind) ?? special.defaultUnits }]
              : specials.filter((entry) => entry.kind !== special.kind)); }} />
            <span>{label}{automatic && <span className="dots-special-auto" aria-hidden="true">Auto</span>}</span>
          </label>
          {selected && <input className="dots-special-units" aria-label={`${label} units`} type="number" min="1" step="1"
            value={selected.units} disabled={incompatible} onChange={(event) => {
              onChange(specials.map((entry) => entry.kind === special.kind
                ? { ...entry, units: event.target.value === '' ? 0 : Number(event.target.value) } : entry));
            }} />}
          <button type="button" className="dots-special-info" aria-label={`About ${label}`}
            aria-expanded={expanded === special.kind} aria-controls={descriptionId}
            onClick={() => { setExpanded((current) => current === special.kind ? null : special.kind); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><path d="M12 11v6" />
              <circle cx="12" cy="7" r=".8" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </div>
        {expanded === special.kind && <p className="dots-special-description" id={descriptionId}>
          {context === 'dots' && manualSweep && special.kind === 'sweep'
            ? 'Scorer-declared Sweep. Shared with current teammates; independent of automatic category and High/Low sweeps.'
            : context === 'churcie' ? special.description.replace(/\bDime\b/gu, 'Sticky') : special.description}
        </p>}
        {incompatible && <small className="dots-special-reason">{unsupported ? `${label} requires advertised API support.`
          : special.kind === 'sweep' ? 'Sweep requires a linked game with actual High and Low results.'
            : 'Assassin requires partnered 2-v-2 play, not individual mode.'}
          {selected && (unsupported
            ? ' This saved selection is retained for review; refresh after an API upgrade before saving.'
            : ' This saved selection is retained for review; change mode before saving.')}</small>}
      </div>;
    })}</div>
  </fieldset>;
}

const builtInDefaultUnits = new Map(defaultChurchySpecialSelections.map((special) => [special.kind, special.units]));
