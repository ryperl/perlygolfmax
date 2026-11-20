import { defaultChurchySpecialSelections } from '../../domain/churchy';
import { dotsSpecialCatalog } from '../../domain/dots';
import type { DotsGameDefinition, DotsSpecialKind, DotsSpecialSelection } from '../../domain/dots';
import type { DotPreset } from '../../client/dot-presets';

export const legacyDotsSpecialKinds: readonly DotsSpecialKind[] = dotsSpecialCatalog
  .filter((special) => special.kind !== 'other').map((special) => special.kind);

export const builtInDotPresets: readonly DotPreset[] = [
  { id: 'dots-common', name: 'Dots common', specials: dotsSpecialCatalog
    .map((special) => ({ kind: special.kind, units: special.defaultUnits })) },
  { id: 'churcie-default', name: 'Churchie familiar', specials: defaultChurchySpecialSelections
    .map((special) => ({ ...special })) },
];

export const dotSpecialModeCompatible = (kind: DotsSpecialKind, mode: DotsGameDefinition['mode'], manualSweep = false): boolean =>
  (kind !== 'sweep' || manualSweep || mode === 'linked') && (kind !== 'assassin' || mode !== 'individual');

export function allDotSelections(
  specials: readonly DotsSpecialSelection[], mode: DotsGameDefinition['mode'], supportedKinds: readonly DotsSpecialKind[],
  context: 'dots' | 'churcie', manualSweep = false,
): readonly DotsSpecialSelection[] {
  const defaults = context === 'churcie' ? new Map(defaultChurchySpecialSelections.map((special) => [special.kind, special.units])) : undefined;
  return [...specials.map((special) => ({ ...special })), ...dotsSpecialCatalog.filter((special) =>
    supportedKinds.includes(special.kind) && dotSpecialModeCompatible(special.kind, mode, manualSweep)
      && !specials.some((entry) => entry.kind === special.kind)).map((special) => ({
    kind: special.kind, units: defaults?.get(special.kind) ?? special.defaultUnits,
  }))];
}

export function dotSpecialLabel(kind: DotsSpecialKind, context: 'dots' | 'churcie'): string {
  return context === 'churcie' && kind === 'dime' ? 'Sticky'
    : dotsSpecialCatalog.find((special) => special.kind === kind)?.label ?? kind;
}
