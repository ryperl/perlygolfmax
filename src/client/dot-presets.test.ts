import { describe, expect, it, vi } from 'vitest';
import { createLocalDotPresetStore, DotPresetStorageError } from './dot-presets';
import type { DotPreset } from './dot-presets';

const key = 'perlygolfmax.dot-presets.v1';
function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: vi.fn((requestedKey: string) => { expect(requestedKey).toBe(key); return value; }),
    setItem: vi.fn((_key: string, next: string) => { value = next; }),
  };
}
const preset: DotPreset = { id: 'practice', name: 'Practice', specials: [{ kind: 'dime', units: 3 }, { kind: 'other', units: 2 }] };

describe('device-local dot preset store', () => {
  it('requires a successful read, saves only preset fields and reloads independent snapshots', () => {
    const storage = memoryStorage(), store = createLocalDotPresetStore(storage);
    expect(() => { store.save(preset); }).toThrow('Read device presets successfully');
    expect(store.load()).toEqual([]);
    store.save(preset);
    expect(storage.setItem).toHaveBeenCalledWith(key, JSON.stringify({ version: 1, entries: [preset] }));
    const reloaded = createLocalDotPresetStore(storage).load();
    expect(reloaded).toEqual([preset]);
    expect(reloaded[0]).not.toBe(preset);
    expect(reloaded[0]?.specials).not.toBe(preset.specials);
    expect(reloaded[0]?.specials[0]).not.toBe(preset.specials[0]);
    expect(store.load()[0]?.specials).not.toBe(reloaded[0]?.specials);
  });

  it('copies caller arrays at save and rejects duplicate names and identifiers without overwriting', () => {
    const storage = memoryStorage(), store = createLocalDotPresetStore(storage);
    const sandy: { kind: 'sandy'; units: number } = { kind: 'sandy', units: 7 };
    const specials = [sandy];
    store.load();
    store.save({ id: 'first', name: 'Weekend', specials });
    sandy.units = 9;
    expect(store.load()[0]?.specials).toEqual([{ kind: 'sandy', units: 7 }]);
    for (const duplicate of [{ ...preset, name: 'weekend' }, { ...preset, id: 'first' }]) {
      expect(() => { store.save(duplicate); }).toThrow('already uses this name or identifier');
    }
    expect(storage.setItem).toHaveBeenCalledOnce();
  });

  it.each([
    '{',
    JSON.stringify({ version: 2, entries: [] }),
    JSON.stringify({ version: 1, entries: [], scores: [] }),
    JSON.stringify({ version: 1, entries: [{ ...preset, playerIds: ['fictional'] }] }),
    JSON.stringify({ version: 1, entries: [{ ...preset, name: ' '.repeat(5) }] }),
    JSON.stringify({ version: 1, entries: [{ ...preset, name: 'x'.repeat(61) }] }),
    JSON.stringify({ version: 1, entries: [{ ...preset, specials: [{ kind: 'unknown', units: 1 }] }] }),
    JSON.stringify({ version: 1, entries: [{ ...preset, specials: [{ kind: 'dime', units: 0 }] }] }),
    JSON.stringify({ version: 1, entries: [{ ...preset, specials: [{ kind: 'dime', units: 1.5 }] }] }),
    JSON.stringify({ version: 1, entries: [{ ...preset, specials: [{ kind: 'dime', units: Number.MAX_SAFE_INTEGER + 1 }] }] }),
    JSON.stringify({ version: 1, entries: [{ ...preset, specials: [{ kind: 'dime', units: 1, gameId: 'fictional' }] }] }),
    JSON.stringify({ version: 1, entries: [{ ...preset, specials: [preset.specials[0], preset.specials[0]] }] }),
    JSON.stringify({ version: 1, entries: [preset, { ...preset, id: 'other', name: 'PRACTICE' }] }),
    JSON.stringify({ version: 1, entries: [preset, { ...preset, name: 'Different' }] }),
  ])('does not overwrite malformed, incompatible or overbroad stored data (%#)', (raw) => {
    const storage = memoryStorage(raw), store = createLocalDotPresetStore(storage);
    expect(() => store.load()).toThrow('unreadable or use an unsupported format');
    expect(() => { store.save(preset); }).toThrow('Read device presets successfully');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.getItem(key)).toBe(raw);
  });

  it('rechecks storage on save, retaining externally corrupted records', () => {
    const storage = memoryStorage(), store = createLocalDotPresetStore(storage);
    store.load();
    storage.setItem(key, '{"version":99}');
    storage.setItem.mockClear();
    expect(() => { store.save(preset); }).toThrow('unreadable');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('rejects invalid or overbroad save payloads without changing existing records', () => {
    const storage = memoryStorage(), store = createLocalDotPresetStore(storage);
    store.load();
    const overbroad = { ...preset, gameId: 'fictional' };
    for (const invalid of [overbroad, { ...preset, specials: [{ kind: 'sandy' as const, units: -1 }] }]) {
      expect(() => { store.save(invalid); }).toThrow('positive whole-dot units');
    }
    expect(store.load()).toEqual([]);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('reports blocked reads and quota writes explicitly and can recover', () => {
    const storage = memoryStorage(), store = createLocalDotPresetStore(storage);
    storage.getItem.mockImplementationOnce(() => { throw new Error('blocked'); });
    expect(() => store.load()).toThrow('storage is blocked');
    store.load();
    storage.setItem.mockImplementationOnce(() => { throw new DOMException('full', 'QuotaExceededError'); });
    try { store.save(preset); throw new Error('Expected quota rejection.'); }
    catch (error) {
      expect(error).toBeInstanceOf(DotPresetStorageError);
      expect(error).toMatchObject({ code: 'quota' });
    }
    expect(store.load()).toEqual([]);
    store.save(preset);
    expect(store.load()).toEqual([preset]);
  });
});
