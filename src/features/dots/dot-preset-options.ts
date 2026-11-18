import { defaultChurchySpecialSelections } from '../../domain/churchy';
import { dotsSpecialCatalog } from '../../domain/dots';
import type { DotsGameDefinition, DotsSpecialKind } from '../../domain/dots';
import type { DotPreset } from '../../client/dot-presets';

export const legacyDotsSpecialKinds: readonly DotsSpecialKind[] = dotsSpecialCatalog
  .filter((special) => special.kind !== 'other').map((special) => special.kind);

export const builtInDotPresets: readonly DotPreset[] = [
  { id: 'dots-common', name: 'Dots common', specials: dotsSpecialCatalog
    .filter((special) => ['hogan', 'seve', 'long-drive', 'paree', 'sandy', 'pully', 'dime', 'kp',
      'murphy', 'haz-par', 'gorilla', 'birdie', 'eagle', 'chippy'].includes(special.kind))
    .map((special) => ({ kind: special.kind, units: special.defaultUnits })) },
  { id: 'churcie-default', name: 'Churchie familiar', specials: defaultChurchySpecialSelections
    .map((special) => ({ ...special })) },
];

export const dotSpecialModeCompatible = (kind: DotsSpecialKind, mode: DotsGameDefinition['mode']): boolean =>
  (kind !== 'sweep' || mode === 'linked') && (kind !== 'assassin' || mode !== 'individual');

export function dotSpecialLabel(kind: DotsSpecialKind, context: 'dots' | 'churcie'): string {
  return context === 'churcie' && kind === 'dime' ? 'Sticky'
    : dotsSpecialCatalog.find((special) => special.kind === kind)?.label ?? kind;
}
