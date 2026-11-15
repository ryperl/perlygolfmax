import type { KpEntry } from '../../domain/kp';

export function kpEntryLabel(value?: KpEntry | null): string {
  return value?.kind === 'measured'
    ? value.inches === 0 ? 'Hole-in-one · 0 ft 0 in' : `${String(Math.floor(value.inches / 12))} ft ${String(value.inches % 12)} in`
    : value?.kind === 'no-measurement' ? 'No measurement' : 'Not entered';
}
