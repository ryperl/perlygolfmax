import { dotsSpecialCatalog } from '../domain/dots';
import type { DotsSpecialSelection } from '../domain/dots';

export interface DotPreset {
  readonly id: string;
  readonly name: string;
  readonly specials: readonly DotsSpecialSelection[];
}

export interface DotPresetStore {
  load(): readonly DotPreset[];
  save(preset: DotPreset): void;
}

export class DotPresetStorageError extends Error {
  constructor(readonly code: 'blocked' | 'quota' | 'corrupt' | 'invalid' | 'duplicate' | 'unread', message: string) {
    super(message);
    this.name = 'DotPresetStorageError';
  }
}

const storageKey = 'perlygolfmax.dot-presets.v1';
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const fields = (value: Record<string, unknown>, names: readonly string[]) =>
  Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim()
  && !/\p{Cc}/u.test(value);

function parsePreset(value: unknown): DotPreset | null {
  if (!record(value) || !fields(value, ['id', 'name', 'specials'])
    || !text(value.id, 80) || !text(value.name, 60) || !Array.isArray(value.specials)
    || value.specials.length > dotsSpecialCatalog.length) return null;
  const specials: DotsSpecialSelection[] = [];
  for (const candidate of value.specials) {
    if (!record(candidate) || !fields(candidate, ['kind', 'units'])
      || typeof candidate.units !== 'number' || !Number.isSafeInteger(candidate.units) || candidate.units < 1) return null;
    const definition = dotsSpecialCatalog.find((entry) => entry.kind === candidate.kind);
    if (!definition || specials.some((entry) => entry.kind === definition.kind)) return null;
    specials.push({ kind: definition.kind, units: candidate.units });
  }
  return { id: value.id, name: value.name, specials };
}

function parsePresets(value: unknown): readonly DotPreset[] | null {
  if (!record(value) || !fields(value, ['version', 'entries']) || value.version !== 1
    || !Array.isArray(value.entries) || value.entries.length > 100) return null;
  const entries: DotPreset[] = [];
  for (const candidate of value.entries) {
    const preset = parsePreset(candidate);
    if (!preset || entries.some((entry) => entry.id === preset.id
      || entry.name.toLowerCase() === preset.name.toLowerCase())) return null;
    entries.push(preset);
  }
  return entries;
}

export function createLocalDotPresetStore(storage: Pick<Storage, 'getItem' | 'setItem'>): DotPresetStore {
  let readable = false;
  const load = (): readonly DotPreset[] => {
    readable = false;
    let raw: string | null;
    try { raw = storage.getItem(storageKey); }
    catch { throw new DotPresetStorageError('blocked', 'Device preset storage is blocked. Allow storage and retry reading.'); }
    let entries: readonly DotPreset[] | null;
    try { entries = raw === null ? [] : parsePresets(JSON.parse(raw)); }
    catch { entries = null; }
    if (entries === null) throw new DotPresetStorageError('corrupt', 'Device presets are unreadable or use an unsupported format. Stored data was not changed.');
    readable = true;
    return entries;
  };
  return {
    load,
    save(preset) {
      if (!readable) throw new DotPresetStorageError('unread', 'Read device presets successfully before saving. Retry reading.');
      const copy = parsePreset(preset);
      if (!copy) throw new DotPresetStorageError('invalid', 'Use a name of 1–60 characters and unique specials with positive whole-dot units.');
      const entries = load();
      if (entries.some((entry) => entry.id === copy.id || entry.name.toLowerCase() === copy.name.toLowerCase())) {
        throw new DotPresetStorageError('duplicate', 'A device preset already uses this name or identifier. Choose a new name.');
      }
      if (entries.length >= 100) throw new DotPresetStorageError('invalid', 'This device has reached its limit of 100 custom presets.');
      try { storage.setItem(storageKey, JSON.stringify({ version: 1, entries: [...entries, copy] })); }
      catch (error) {
        const quota = record(error) && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
        throw new DotPresetStorageError(quota ? 'quota' : 'blocked', quota
          ? 'Device preset storage is full. Free storage and retry saving; your settings are retained.'
          : 'Device preset storage is blocked. Allow storage and retry; your settings are retained.');
      }
    },
  };
}
