import type { DotsGameDefinition, DotsSpecialKind } from '../../domain/dots';
import type { DotsSetupDraft } from './DotsSettings';

export interface DotsModeChangeOptions {
  /** Editing a saved game rather than creating one. */
  readonly existing: boolean;
  /** The selected playing group does not have exactly four golfers. */
  readonly smallGroup: boolean;
  readonly v2Supported: boolean;
  readonly v3Supported: boolean;
  readonly compatible: (kind: DotsSpecialKind, mode: DotsGameDefinition['mode']) => boolean;
}

/**
 * The draft patch for choosing a Dots mode option, or null when the choice is not allowed.
 * Saved games keep their rules version; new rotating games use version 3 when supported, otherwise 2.
 */
export function dotsModeChange(draft: DotsSetupDraft, selectedMode: string, options: DotsModeChangeOptions): DotsSetupDraft | null {
  const { existing, smallGroup, v2Supported, v3Supported, compatible } = options;
  const mode = draft.dotsMode ?? 'individual';
  const specials = draft.dotsSpecials ?? [];
  const updated = draft.dotsVersion === 3;
  if (smallGroup && selectedMode !== 'individual') return null;
  if (selectedMode === 'rotating-3' || selectedMode === 'rotating-6') {
    if (!v2Supported || existing && draft.dotsVersion === 1 || updated && !v3Supported) return null;
    const nextVersion = v3Supported && (!existing || draft.dotsVersion !== 2) ? 3 : 2;
    return { dotsMode: 'rotating', dotsRotationHoles: selectedMode === 'rotating-3' ? 3 : 6,
      ...(nextVersion === 3 ? { dotsVersion: 3, dotsOrderMode: draft.dotsOrderMode ?? 'tee-flip' } : { dotsVersion: 2 }),
      ...(nextVersion !== 3 && selectedMode === 'rotating-6' && draft.dotsHighLow ? { dotsHighLow: false } : {}),
      dotsSpecials: specials.filter((special) => compatible(special.kind, 'rotating')) };
  }
  if ((selectedMode === 'individual' || selectedMode === 'fixed' || selectedMode === 'linked') && selectedMode !== mode) {
    if (existing && (draft.dotsVersion === 2 || updated)) return null;
    return { dotsMode: selectedMode, ...(!existing ? { dotsVersion: 1 } : {}), ...(draft.dotsHighLow ? { dotsHighLow: false } : {}),
      dotsSpecials: specials.filter((special) => compatible(special.kind, selectedMode)) };
  }
  return null;
}
